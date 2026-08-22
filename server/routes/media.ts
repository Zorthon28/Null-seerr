import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TautulliAPI from '@server/api/tautulli';
import TheMovieDb from '@server/api/themoviedb';
import { MediaRequestStatus, MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import Season from '@server/entity/Season';
import { User } from '@server/entity/User';
import type {
  MediaResultsResponse,
  MediaWatchDataResponse,
} from '@server/interfaces/api/mediaInterfaces';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import type { FindOneOptions } from 'typeorm';
import { EntityNotFoundError, In, IsNull, Not } from 'typeorm';
import PlexAPI from '@server/api/plexapi';
import JellyfinAPI from '@server/api/jellyfin';
import { MediaServerType } from '@server/constants/server';
import { getHostname } from '@server/utils/getHostname';
import NodeCache from 'node-cache';
import { uniqWith } from 'lodash';
import { plexRecentScanner } from '@server/lib/scanners/plex';
import { jellyfinRecentScanner } from '@server/lib/scanners/jellyfin';
import { radarrScanner } from '@server/lib/scanners/radarr';
import { sonarrScanner } from '@server/lib/scanners/sonarr';
import availabilitySync from '@server/lib/availabilitySync';

const mappingCache = new NodeCache({ stdTTL: 300 }); // 5 minutes TTL

// Track active tmdbIds across queue polls to detect when downloads complete
const previouslyActiveIds = new Set<number>();
let lastScanTriggeredAt = 0;

const mediaRoutes = Router();

mediaRoutes.get('/', async (req, res, next) => {
  const mediaRepository = getRepository(Media);

  const pageSize = req.query.take ? Number(req.query.take) : 20;
  const skip = req.query.skip ? Number(req.query.skip) : 0;

  let statusFilter = undefined;

  switch (req.query.filter) {
    case 'available':
      statusFilter = MediaStatus.AVAILABLE;
      break;
    case 'partial':
      statusFilter = MediaStatus.PARTIALLY_AVAILABLE;
      break;
    case 'allavailable':
      statusFilter = In([
        MediaStatus.AVAILABLE,
        MediaStatus.PARTIALLY_AVAILABLE,
      ]);
      break;
    case 'processing':
      statusFilter = MediaStatus.PROCESSING;
      break;
    case 'pending':
      statusFilter = MediaStatus.PENDING;
      break;
  }

  let sortFilter: FindOneOptions<Media>['order'] = {
    id: 'DESC',
  };

  switch (req.query.sort) {
    case 'modified':
      sortFilter = {
        updatedAt: 'DESC',
      };
      break;
    case 'mediaAdded':
      sortFilter = {
        mediaAddedAt: 'DESC',
      };
  }

  let whereClause: FindOneOptions<Media>['where'];
  if (statusFilter || req.query.sort === 'mediaAdded') {
    whereClause = {};
    if (statusFilter) whereClause.status = statusFilter;
    if (req.query.sort === 'mediaAdded')
      whereClause.mediaAddedAt = Not(IsNull());
  }

  try {
    const [media, mediaCount] = await mediaRepository.findAndCount({
      order: sortFilter,
      where: whereClause,
      take: pageSize,
      skip,
    });
    return res.status(200).json({
      pageInfo: {
        pages: Math.ceil(mediaCount / pageSize),
        pageSize,
        results: mediaCount,
        page: Math.ceil(skip / pageSize) + 1,
      },
      results: media,
    } as MediaResultsResponse);
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

function formatBytes(bytes: number, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatTimeLeft(timeLeftStr?: string) {
  if (!timeLeftStr) return '';
  const parts = timeLeftStr.split(':');
  if (parts.length === 3) {
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    if (hours > 0) {
      return `~${hours}h ${minutes}m`;
    }
    return `~${minutes}m`;
  }
  return timeLeftStr;
}

mediaRoutes.get('/queue', async (req, res, next) => {
  try {
    const settings = getSettings();
    const rawQueueItems: any[] = [];
    const radarrHealthMap = new Map<number, any[]>();
    const sonarrHealthMap = new Map<number, any[]>();

    // Fetch all local media database rows to help map tvdbId to tmdbId
    const localMedia = await getRepository(Media).find();
    const tvdbToTmdb = new Map<number, number>();
    for (const m of localMedia) {
      if (m.tvdbId) tvdbToTmdb.set(m.tvdbId, m.tmdbId);
    }

    // 1. Process Radarr servers
    const filteredRadarr = uniqWith(settings.radarr, (a, b) => {
      return a.hostname === b.hostname && a.port === b.port && a.baseUrl === b.baseUrl;
    });

    await Promise.all(
      filteredRadarr.map(async (server) => {
        logger.debug(`[Queue API] Checking Radarr server: ${server.name} (${server.hostname}:${server.port}), syncEnabled=${server.syncEnabled}`);
        const radarrApi = new RadarrAPI({
          apiKey: server.apiKey,
          url: RadarrAPI.buildUrl(server, '/api/v3'),
        });

        try {
          const queue = await radarrApi.getQueue();
          logger.debug(`[Queue API] Radarr (${server.name}): found ${queue.length} queue items`, { serverName: server.name });
          
          // Fetch health status
          try {
            const health = await radarrApi.getHealth();
            radarrHealthMap.set(server.id, health);
          } catch (he) {
            logger.error(`[Queue API] Failed to retrieve health from Radarr: ${server.name}`, { errorMessage: he.message });
          }

          // Build movie mapping for this Radarr server
          const movieCacheKey = `radarr-${server.id}`;
          let movieMap = mappingCache.get<Record<number, number>>(movieCacheKey);
          let movies = mappingCache.get<any[]>(`radarr-movies-full-${server.id}`);
          if (!movieMap || !movies) {
            movieMap = {};
            movies = await radarrApi.getMovies();
            for (const m of movies) {
              if (m.id && m.tmdbId) {
                movieMap[m.id] = m.tmdbId;
              }
            }
            mappingCache.set(movieCacheKey, movieMap);
            mappingCache.set(`radarr-movies-full-${server.id}`, movies);
            logger.debug(`[Queue API] Radarr (${server.name}): built movie map with ${Object.keys(movieMap).length} entries`);
          }

          for (const item of queue) {
            // Find TMDB ID
            let tmdbId = (item as any).movie?.tmdbId || movieMap[item.movieId] || null;
            logger.debug(`[Queue API] Radarr item: title=${item.title}, status=${item.status}, trackedState=${item.trackedDownloadState}, tmdbId=${tmdbId}, progress=${item.size ? Math.round(((item.size - (item.sizeleft || 0)) / item.size) * 100) : 0}%, timeleft=${item.timeleft}, client=${item.downloadClient}, protocol=${item.protocol}`);
            
            // If not found in server movie map, check local DB
            if (!tmdbId) {
              const local = localMedia.find(
                (m) => m.mediaType === MediaType.MOVIE && 
                       ((m.serviceId === server.id && m.externalServiceId === item.movieId) ||
                        (m.serviceId4k === server.id && m.externalServiceId4k === item.movieId))
              );
              if (local) tmdbId = local.tmdbId;
            }

            if (tmdbId) {
              const size = item.size || 0;
              const sizeLeft = item.sizeleft || 0;
              const progress = size > 0 ? Math.round(((size - sizeLeft) / size) * 100) : 0;
              
              let currentStatus: 'downloading' | 'processing' | 'paused' | 'queued' | 'failed' = 'downloading';
              if (item.trackedDownloadState === 'importing' || item.status === 'completed') {
                currentStatus = 'processing';
              } else if (item.status === 'paused') {
                currentStatus = 'paused';
              } else if (item.status === 'queued') {
                currentStatus = 'queued';
              } else if (item.status === 'failed' || item.status === 'warning') {
                currentStatus = 'failed';
              }

              rawQueueItems.push({
                tmdbId,
                mediaType: 'movie',
                status: currentStatus,
                progress,
                timeLeft: formatTimeLeft(item.timeleft),
                estimatedCompletionTime: item.estimatedCompletionTime,
                title: item.title || '',
                size: formatBytes(size),
                sizeLeft: formatBytes(sizeLeft),
                downloadClient: item.downloadClient || 'qBittorrent',
                protocol: item.protocol || 'torrent',
                is4k: server.is4k,
                downloadId: (item as any).downloadId || null,
              });
            }
          }
        } catch (e) {
          logger.error(`[Queue API] Failed to fetch queue from Radarr server: ${server.name}`, { errorMessage: e.message });
        }
      })
    );

    // 2. Process Sonarr servers
    const filteredSonarr = uniqWith(settings.sonarr, (a, b) => {
      return a.hostname === b.hostname && a.port === b.port && a.baseUrl === b.baseUrl;
    });

    await Promise.all(
      filteredSonarr.map(async (server) => {
        logger.debug(`[Queue API] Checking Sonarr server: ${server.name} (${server.hostname}:${server.port}), syncEnabled=${server.syncEnabled}`);
        const sonarrApi = new SonarrAPI({
          apiKey: server.apiKey,
          url: SonarrAPI.buildUrl(server, '/api/v3'),
        });

        try {
          const queue = await sonarrApi.getQueue();
          logger.debug(`[Queue API] Sonarr (${server.name}): found ${queue.length} queue items`, { serverName: server.name });
          
          // Fetch health status
          try {
            const health = await sonarrApi.getHealth();
            sonarrHealthMap.set(server.id, health);
          } catch (he) {
            logger.error(`[Queue API] Failed to retrieve health from Sonarr: ${server.name}`, { errorMessage: he.message });
          }

          // Build series mapping for this Sonarr server
          const seriesCacheKey = `sonarr-${server.id}`;
          let seriesMap = mappingCache.get<Record<number, number>>(seriesCacheKey);
          let seriesList = mappingCache.get<any[]>(`sonarr-series-full-${server.id}`);
          if (!seriesMap || !seriesList) {
            seriesMap = {};
            seriesList = await sonarrApi.getSeries();
            for (const s of seriesList) {
              if (s.id && s.tvdbId) {
                const tmdbId = tvdbToTmdb.get(s.tvdbId);
                if (tmdbId) {
                  seriesMap[s.id] = tmdbId;
                }
              }
            }
            mappingCache.set(seriesCacheKey, seriesMap);
            mappingCache.set(`sonarr-series-full-${server.id}`, seriesList);
          }

          for (const item of queue) {
            let tmdbId = seriesMap[item.seriesId] || null;

            // Check if series is in the queue item itself (Sonarr v3/v4 sometimes returns series object)
            const seriesTvdbId = (item as any).series?.tvdbId;
            logger.debug(`[Queue API] Sonarr item: title=${item.title}, status=${item.status}, trackedState=${item.trackedDownloadState}, seriesId=${item.seriesId}, tvdbId=${seriesTvdbId}, tmdbId=${tmdbId}, progress=${item.size ? Math.round(((item.size - (item.sizeleft || 0)) / item.size) * 100) : 0}%, timeleft=${item.timeleft}, client=${item.downloadClient}, protocol=${item.protocol}`);
            if (!tmdbId && seriesTvdbId) {
              tmdbId = tvdbToTmdb.get(seriesTvdbId) || null;
            }

            // If still not found, check local database
            if (!tmdbId) {
              const local = localMedia.find(
                (m) => m.mediaType === MediaType.TV && 
                       ((m.serviceId === server.id && m.externalServiceId === item.seriesId) ||
                        (m.serviceId4k === server.id && m.externalServiceId4k === item.seriesId))
              );
              if (local) tmdbId = local.tmdbId;
            }

            if (tmdbId) {
              const size = item.size || 0;
              const sizeLeft = item.sizeleft || 0;
              const progress = size > 0 ? Math.round(((size - sizeLeft) / size) * 100) : 0;

              let currentStatus: 'downloading' | 'processing' | 'paused' | 'queued' | 'failed' = 'downloading';
              if (item.trackedDownloadState === 'importing' || item.status === 'completed') {
                currentStatus = 'processing';
              } else if (item.status === 'paused') {
                currentStatus = 'paused';
              } else if (item.status === 'queued') {
                currentStatus = 'queued';
              } else if (item.status === 'failed' || item.status === 'warning') {
                currentStatus = 'failed';
              }

              rawQueueItems.push({
                tmdbId,
                mediaType: 'tv',
                status: currentStatus,
                progress,
                timeLeft: formatTimeLeft(item.timeleft),
                estimatedCompletionTime: item.estimatedCompletionTime,
                title: item.title || '',
                size: formatBytes(size),
                sizeLeft: formatBytes(sizeLeft),
                downloadClient: item.downloadClient || 'qBittorrent',
                protocol: item.protocol || 'torrent',
                is4k: server.is4k,
                downloadId: (item as any).downloadId || null,
              });
            }
          }
        } catch (e) {
          logger.error(`[Queue API] Failed to fetch queue from Sonarr server: ${server.name}`, { errorMessage: e.message });
        }
      })
    );

    // 3a. Enrich active download items with direct qBittorrent data if available
    // qBittorrent Web API endpoint: GET /api/v2/torrents/info?hashes=<hash1>|<hash2>
    // We collect all downloadIds from active queue items and query qBit directly
    // for more accurate speed/ETA data.
    const qbitHashes = rawQueueItems
      .filter(i => i.downloadId)
      .map(i => i.downloadId as string);

    if (qbitHashes.length > 0) {
      // Try common qBittorrent hostnames (Docker service name or localhost)
      const qbitHosts = ['qbittorrent', 'localhost', 'host.docker.internal'];
      const qbitPort = 8080;

      for (const qbitHost of qbitHosts) {
        try {
          const qbitUrl = `http://${qbitHost}:${qbitPort}/api/v2/torrents/info?hashes=${qbitHashes.join('|')}`;
          const axios = (await import('axios')).default;
          const qbitRes = await axios.get(qbitUrl, { timeout: 3000 });
          const torrents: any[] = qbitRes.data;

          if (Array.isArray(torrents) && torrents.length > 0) {
            logger.debug(`[Queue API] qBittorrent (${qbitHost}): enriched ${torrents.length} torrents with direct data`);

            // Build a map of hash -> torrent data
            const qbitMap = new Map<string, any>();
            for (const t of torrents) {
              qbitMap.set(t.hash.toLowerCase(), t);
            }

            // Update our queue items with qBit's more accurate data
            for (const item of rawQueueItems) {
              if (!item.downloadId) continue;
              const qbt = qbitMap.get(item.downloadId.toLowerCase());
              if (!qbt) continue;

              const dlSpeed = qbt.dlspeed || 0; // bytes/sec
              const eta = qbt.eta; // seconds, 8640000 = no eta
              const progress = Math.round((qbt.progress || 0) * 100);
              const totalSize = qbt.total_size || qbt.size || 0;
              const downloaded = qbt.downloaded || 0;
              const remaining = totalSize - downloaded;

              // Format ETA from qBit's seconds value
              let etaFormatted = '';
              if (eta && eta < 8640000) {
                const h = Math.floor(eta / 3600);
                const m = Math.floor((eta % 3600) / 60);
                etaFormatted = h > 0 ? `~${h}h ${m}m` : `~${m}m`;
              }

              // Format speed
              const speedFormatted = dlSpeed > 0 ? `${formatBytes(dlSpeed)}/s` : '';

              // Map qBit state to our status
              let qbitStatus = item.status;
              if (['downloading', 'stalledDL', 'checkingDL', 'forcedDL'].includes(qbt.state)) {
                qbitStatus = 'downloading';
              } else if (['uploading', 'stalledUP', 'forcedUP', 'checkingUP'].includes(qbt.state)) {
                qbitStatus = 'processing';
              } else if (['pausedDL', 'pausedUP'].includes(qbt.state)) {
                qbitStatus = 'paused';
              } else if (qbt.state === 'error' || qbt.state === 'missingFiles') {
                qbitStatus = 'failed';
              } else if (qbt.state === 'queuedDL' || qbt.state === 'queuedUP') {
                qbitStatus = 'queued';
              }

              item.progress = progress;
              item.timeLeft = etaFormatted;
              item.status = qbitStatus;
              item.size = formatBytes(totalSize);
              item.sizeLeft = formatBytes(remaining);
              item.downloadSpeed = speedFormatted;
              item.downloadClient = `qBittorrent (${qbt.state})`;

              logger.debug(`[Queue API] qBit enriched ${item.tmdbId}: state=${qbt.state}, progress=${progress}%, eta=${etaFormatted}, speed=${speedFormatted}`);
            }
            break; // Stop trying hosts once we get a response
          }
        } catch (e) {
          // qBittorrent not reachable on this host, try next
          logger.debug(`[Queue API] qBittorrent not reachable at ${qbitHost}:${qbitPort}: ${e.message}`);
        }
      }
    }

    // 3b. Process truly-pending/searching items from Seerr local DB
    // Only include items that:
    //   (a) have an APPROVED request that hasn't been fulfilled yet
    //   (b) are NOT already available in Plex (MediaStatus.AVAILABLE)
    //   (c) are NOT already active in a download client queue above
    const activeTmdbIds = new Set(rawQueueItems.map(item => item.tmdbId));

    // Fetch pending/approved requests from DB (APPROVED = sent to arr but not complete)
    const pendingRequests = await getRepository(MediaRequest).find({
      where: { status: MediaRequestStatus.APPROVED },
      relations: ['media'],
    });

    logger.debug(`[Queue API] Found ${pendingRequests.length} APPROVED requests in Seerr DB`);

    const seenSearchTmdbIds = new Set<number>();
    for (const req of pendingRequests) {
      const m = req.media;
      if (!m) continue;

      // Skip if already in active download queue
      if (activeTmdbIds.has(m.tmdbId)) {
        logger.debug(`[Queue API] Skipping tmdbId=${m.tmdbId} (already in active queue)`);
        continue;
      }

      // Skip if already fully available in Plex (both standard and 4K if applicable)
      const isStdAvailable = m.status === MediaStatus.AVAILABLE;
      const is4kAvailable = m.status4k === MediaStatus.AVAILABLE;
      const relevantAvailable = req.is4k ? is4kAvailable : isStdAvailable;
      if (relevantAvailable) {
        logger.debug(`[Queue API] Skipping tmdbId=${m.tmdbId} (already AVAILABLE in Plex, is4k=${req.is4k})`);
        continue;
      }

      // Skip duplicates (same tmdbId with multiple requests)
      if (seenSearchTmdbIds.has(m.tmdbId)) continue;
      seenSearchTmdbIds.add(m.tmdbId);

      logger.debug(`[Queue API] Adding searching item: tmdbId=${m.tmdbId}, type=${m.mediaType}, mediaStatus=${m.status}, mediaStatus4k=${m.status4k}, is4k=${req.is4k}`);

      // Re-map details and warnings from cached servers
      let healthWarnings: string[] = [];
      let dvrDetails: any = null;

      if (m.mediaType === MediaType.MOVIE) {
        for (const server of filteredRadarr) {
          const movies = mappingCache.get<any[]>(`radarr-movies-full-${server.id}`) || [];
          const movie = movies.find(mv => mv.tmdbId === m.tmdbId);
          if (movie) {
            dvrDetails = {
              monitored: movie.monitored,
              status: movie.status,
              hasFile: movie.hasFile,
              minimumAvailability: movie.minimumAvailability,
            };
            const h = radarrHealthMap.get(server.id) || [];
            healthWarnings = h.map(hw => `[Radarr - ${server.name}] ${hw.message}`);
            break;
          }
        }
      } else {
        for (const server of filteredSonarr) {
          const seriesList = mappingCache.get<any[]>(`sonarr-series-full-${server.id}`) || [];
          const series = seriesList.find(s => {
            const cachedSeriesMap = mappingCache.get<Record<number, number>>(`sonarr-${server.id}`) || {};
            return cachedSeriesMap[s.id] === m.tmdbId;
          });
          if (series) {
            dvrDetails = {
              monitored: series.monitored,
              status: series.status,
              nextAiring: series.nextAiring,
              episodeCount: series.statistics?.episodeCount || 0,
              episodeFileCount: series.statistics?.episodeFileCount || 0,
              totalEpisodeCount: series.statistics?.totalEpisodeCount || 0,
            };
            const h = sonarrHealthMap.get(server.id) || [];
            healthWarnings = h.map(hw => `[Sonarr - ${server.name}] ${hw.message}`);
            break;
          }
        }
      }

      rawQueueItems.push({
        tmdbId: m.tmdbId,
        mediaType: m.mediaType,
        status: 'searching',
        progress: 0,
        timeLeft: '',
        estimatedCompletionTime: null,
        title: '',
        size: '',
        sizeLeft: '',
        downloadClient: '',
        protocol: '',
        is4k: req.is4k,
        details: dvrDetails,
        healthWarnings,
      });
    }

    logger.info(`[Queue API] Summary: ${rawQueueItems.filter(i => i.status !== 'searching').length} active downloads, ${rawQueueItems.filter(i => i.status === 'searching').length} searching`);

    // Aggregate queue items by TMDB ID for TitleCard overlays
    const aggregatedQueue: Record<number, {
      tmdbId: number;
      mediaType: 'movie' | 'tv';
      status: 'downloading' | 'processing' | 'paused' | 'queued' | 'failed' | 'searching';
      progress: number;
      timeLeft: string;
      estimatedCompletionTime: string | null;
      is4k: boolean;
      activeItemsCount: number;
    }> = {};

    for (const item of rawQueueItems) {
      const existing = aggregatedQueue[item.tmdbId];
      if (!existing) {
        aggregatedQueue[item.tmdbId] = {
          tmdbId: item.tmdbId,
          mediaType: item.mediaType,
          status: item.status,
          progress: item.progress,
          timeLeft: item.timeLeft,
          estimatedCompletionTime: item.estimatedCompletionTime,
          is4k: item.is4k,
          activeItemsCount: 1,
        };
      } else {
        existing.activeItemsCount += 1;
        existing.progress = Math.round((existing.progress * (existing.activeItemsCount - 1) + item.progress) / existing.activeItemsCount);
        
        // Priority status resolution for poster overlays
        if (item.status === 'downloading' && existing.status !== 'downloading') {
          existing.status = 'downloading';
        }
        if (item.estimatedCompletionTime && (!existing.estimatedCompletionTime || new Date(item.estimatedCompletionTime) > new Date(existing.estimatedCompletionTime))) {
          existing.estimatedCompletionTime = item.estimatedCompletionTime;
          existing.timeLeft = item.timeLeft;
        }
        if (item.is4k) {
          existing.is4k = true;
        }
      }
    }

    // Detect completed downloads: tmdbIds that were active last poll but aren't now
    const currentActiveIds = new Set(
      rawQueueItems.filter(i => i.status !== 'searching').map(i => i.tmdbId)
    );

    const completedIds: number[] = [];
    for (const prevId of previouslyActiveIds) {
      if (!currentActiveIds.has(prevId)) {
        completedIds.push(prevId);
      }
    }

    // Update tracking set
    previouslyActiveIds.clear();
    for (const id of currentActiveIds) previouslyActiveIds.add(id);

    if (completedIds.length > 0) {
      const now = Date.now();
      const cooldownMs = 30_000; // Don't trigger more than once per 30s
      if (now - lastScanTriggeredAt > cooldownMs) {
        lastScanTriggeredAt = now;
        logger.info(`[Queue API] Download(s) completed for tmdbIds: ${completedIds.join(', ')}. Triggering Plex scan + availability sync.`);
        // Fire-and-forget: run Plex recently-added scan and availability sync
        setImmediate(() => {
          plexRecentScanner.run().catch((e: Error) =>
            logger.warn('[Queue API] Plex scan after completion failed:', { error: e.message })
          );
          availabilitySync.run().catch((e: Error) =>
            logger.warn('[Queue API] Availability sync after completion failed:', { error: e.message })
          );
        });
      }
    }

    // Deduplicate items by downloadId so season packs show ONE card per torrent,
    // not one card per episode that Sonarr tracks inside the same download.
    const uniqueItems: any[] = [];
    const seenDownloadKeys = new Set<string>();
    for (const item of rawQueueItems) {
      const key = item.downloadId
        ? `${item.mediaType}-${item.downloadId}`
        : `${item.mediaType}-${item.tmdbId}-${item.title}`;
      if (!seenDownloadKeys.has(key)) {
        seenDownloadKeys.add(key);
        uniqueItems.push(item);
      }
    }

    return res.status(200).json({
      queue: aggregatedQueue,
      items: uniqueItems,
      completedIds,
    });
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

// POST /api/v1/media/scan-now — manually trigger Jellyfin, Plex, Radarr, Sonarr scans + availability sync
mediaRoutes.post(
  '/scan-now',
  isAuthenticated(Permission.ADMIN),
  async (_req, res, next) => {
    try {
      const now = Date.now();
      const cooldownMs = 10_000;
      if (now - lastScanTriggeredAt < cooldownMs) {
        return res.status(429).json({ message: 'Scan already triggered recently. Please wait a moment.' });
      }
      lastScanTriggeredAt = now;

      const settings = getSettings();
      logger.info('[Scan Now] Manual scan triggered from Downloads page (updating Jellyfin, Plex, Radarr, and Sonarr).');

      setImmediate(async () => {
        // 1. Tell Jellyfin server directly to refresh libraries
        if (settings.jellyfin?.apiKey) {
          try {
            const jfUrl = `${settings.jellyfin.useSsl ? 'https' : 'http'}://${settings.jellyfin.ip}:${settings.jellyfin.port}/Library/Refresh`;
            const axios = (await import('axios')).default;
            await axios.post(jfUrl, null, {
              headers: { 'X-Emby-Token': settings.jellyfin.apiKey },
              timeout: 5000,
            });
            logger.info('[Scan Now] Successfully triggered Jellyfin server library refresh.');
          } catch (e: any) {
            logger.debug('[Scan Now] Jellyfin refresh notice:', { error: e.message });
          }
        }

        // 2. Run Jellyfin scanner
        jellyfinRecentScanner.run().catch((e: Error) =>
          logger.warn('[Scan Now] Jellyfin scan failed:', { error: e.message })
        );

        // 3. Run Plex scanner
        plexRecentScanner.run().catch((e: Error) =>
          logger.warn('[Scan Now] Plex scan failed:', { error: e.message })
        );

        // 4. Run Radarr / Sonarr scanners
        radarrScanner.run().catch((e: Error) =>
          logger.warn('[Scan Now] Radarr scan failed:', { error: e.message })
        );
        sonarrScanner.run().catch((e: Error) =>
          logger.warn('[Scan Now] Sonarr scan failed:', { error: e.message })
        );

        // 5. Run Availability Sync
        availabilitySync.run().catch((e: Error) =>
          logger.warn('[Scan Now] Availability sync failed:', { error: e.message })
        );
      });

      return res.status(200).json({ message: 'Media library scans started for Jellyfin and Plex.' });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

// GET /api/v1/media/qbittorrent-seeding — query qBittorrent's global seeding preference
mediaRoutes.get(
  '/qbittorrent-seeding',
  isAuthenticated(Permission.ADMIN),
  async (_req, res, next) => {
    const qbitHosts = ['qbittorrent', 'localhost', 'host.docker.internal'];
    const qbitPort = 8080;
    for (const host of qbitHosts) {
      try {
        const url = `http://${host}:${qbitPort}/api/v2/app/preferences`;
        const axios = (await import('axios')).default;
        const response = await axios.get(url, { timeout: 2000 });
        if (response.data) {
          const onlyDownload = response.data.max_ratio === 0;
          return res.status(200).json({ onlyDownload });
        }
      } catch (e) {
        // try next host
      }
    }
    return res.status(200).json({ onlyDownload: false }); // Default fallback
  }
);

// POST /api/v1/media/qbittorrent-seeding — toggle qBittorrent's global seeding preference
mediaRoutes.post(
  '/qbittorrent-seeding',
  isAuthenticated(Permission.ADMIN),
  async (req, res, next) => {
    const { onlyDownload } = req.body;
    const qbitHosts = ['qbittorrent', 'localhost', 'host.docker.internal'];
    const qbitPort = 8080;
    const ratio = onlyDownload ? 0 : -1;
    const payload = `json=${encodeURIComponent(JSON.stringify({ max_ratio: ratio, max_seeding_time: ratio }))}`;

    for (const host of qbitHosts) {
      try {
        const url = `http://${host}:${qbitPort}/api/v2/app/setPreferences`;
        const axios = (await import('axios')).default;
        await axios.post(url, payload, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 2000,
        });
        return res.status(200).json({ onlyDownload });
      } catch (e) {
        // try next host
      }
    }
    return res.status(500).json({ message: 'Failed to update qBittorrent preferences.' });
  }
);

// GET /api/v1/media/:mediaType/:id/retention — get retention policy for a TMDB ID
mediaRoutes.get(
  '/:mediaType/:id/retention',
  isAuthenticated(Permission.ADMIN),
  async (req, res, next) => {
    const mediaType = req.params.mediaType as MediaType;
    const id = Number(req.params.id);
    const { getRetentionRule } = await import('@server/lib/retention');
    const rule = getRetentionRule(mediaType, id);
    return res.status(200).json({ policy: rule ? rule.policy : 'dont_delete' });
  }
);

// POST /api/v1/media/:mediaType/:id/retention — set retention policy for a TMDB ID
mediaRoutes.post(
  '/:mediaType/:id/retention',
  isAuthenticated(Permission.ADMIN),
  async (req, res, next) => {
    const mediaType = req.params.mediaType as MediaType;
    const id = Number(req.params.id);
    const { policy } = req.body;
    const { setRetentionRule } = await import('@server/lib/retention');
    setRetentionRule(mediaType, id, policy);
    return res.status(200).json({ policy });
  }
);

mediaRoutes.get('/:id/stream', async (req, res, next) => {
  logger.info(`[Stream API] Resolving stream for TMDB ID: ${req.params.id}`, { query: req.query });
  try {
    const tmdbId = Number(req.params.id);
    const media = await getRepository(Media).findOne({ where: { tmdbId } });

    if (!media) {
      logger.warn(`[Stream API] Media not found in local DB for TMDB ID: ${tmdbId}`);
      return res.status(404).json({ message: 'Media not found in database.' });
    }

    const is4k = req.query.is4k === 'true';
    const settings = getSettings();

    // Check if configured media server is Jellyfin or Emby
    if (
      settings.main.mediaServerType === MediaServerType.JELLYFIN ||
      settings.main.mediaServerType === MediaServerType.EMBY
    ) {
      const jellyfinMediaId = is4k ? media.jellyfinMediaId4k : media.jellyfinMediaId;

      if (!jellyfinMediaId) {
        logger.warn(`[Stream API] Jellyfin media ID not found in local DB for TMDB ID: ${tmdbId} (is4k: ${is4k})`);
        return res.status(404).json({ message: 'Jellyfin media ID not found. Please ensure libraries are synced.' });
      }

      const jellyfin = new JellyfinAPI(
        getHostname(settings.jellyfin),
        settings.jellyfin.apiKey,
        settings.clientId
      );

      let targetItemId = jellyfinMediaId;
      let itemData: any;

      if (media.mediaType === MediaType.TV) {
        const seasonNum = Number(req.query.season);
        const episodeNum = Number(req.query.episode);

        if (isNaN(seasonNum) || isNaN(episodeNum)) {
          logger.warn(`[Stream API] Missing season or episode query parameter for TV show TMDB ID: ${tmdbId}`);
          return res.status(400).json({ message: 'Season and episode parameters are required for TV shows.' });
        }

        logger.debug(`[Stream API] Querying Jellyfin seasons list for Series ID: ${jellyfinMediaId}`);
        const seasons = await jellyfin.getSeasons(jellyfinMediaId) || [];
        const matchedSeason = seasons.find((s: any) => s.IndexNumber === seasonNum);

        if (!matchedSeason) {
          logger.warn(`[Stream API] Season ${seasonNum} not found in Jellyfin for Series ID: ${jellyfinMediaId}`);
          return res.status(404).json({ message: `Season ${seasonNum} not found in Jellyfin library.` });
        }

        const episodes = await jellyfin.getEpisodes(jellyfinMediaId, matchedSeason.Id, { includeMediaInfo: true }) || [];
        const matchedEpisode = episodes.find((ep: any) => ep.IndexNumber === episodeNum);

        if (!matchedEpisode) {
          logger.warn(`[Stream API] Episode S${seasonNum}E${episodeNum} not found in Jellyfin library for Series ID: ${jellyfinMediaId}`);
          return res.status(404).json({ message: `Episode S${seasonNum}E${episodeNum} not found in Jellyfin library.` });
        }

        targetItemId = matchedEpisode.Id;
        itemData = matchedEpisode;
      } else {
        itemData = await jellyfin.getItemData(targetItemId);
      }

      const subtitleTracks: any[] = [];
      const audioTracks: any[] = [];
      const streams = itemData?.MediaSources?.[0]?.MediaStreams || [];

      for (const stream of streams) {
        if (stream.Type === 'Subtitle') {
          subtitleTracks.push({
            id: stream.Index,
            language: stream.Language || 'Unknown',
            languageCode: stream.Language || 'unk',
            codec: stream.Codec,
            title: stream.DisplayTitle || `${stream.Language || 'Unknown'} (${stream.Codec})`,
            selected: !!stream.IsDefault,
          });
        } else if (stream.Type === 'Audio') {
          audioTracks.push({
            id: stream.Index,
            language: stream.Language || 'Unknown',
            languageCode: stream.Language || 'unk',
            codec: stream.Codec,
            title: stream.DisplayTitle || `${stream.Language || 'Unknown'} (${stream.Codec})`,
            selected: !!stream.IsDefault,
          });
        }
      }

      const webHost = settings.jellyfin.externalHostname && settings.jellyfin.externalHostname.length > 0
        ? settings.jellyfin.externalHostname
        : 'http://localhost:8097';
      const apiKey = settings.jellyfin.apiKey;
      const serverId = settings.jellyfin.serverId;
      const pageName = settings.main.mediaServerType === MediaServerType.EMBY ? 'item' : 'details';
      const jellyfinWebUrl = `${webHost}/web/index.html#!/${pageName}?id=${targetItemId}&serverId=${serverId}`;
      const streamUrl = `${webHost}/Videos/${targetItemId}/stream?static=true&api_key=${apiKey}`;

      logger.info(`[Stream API] Resolved Jellyfin playback properties for TMDB ID: ${tmdbId}. Found ${subtitleTracks.length} subtitle tracks and ${audioTracks.length} audio tracks.`);

      return res.status(200).json({
        streamUrl,
        jellyfinWebUrl,
        mediaServerWebUrl: jellyfinWebUrl,
        plexWebUrl: jellyfinWebUrl,
        mediaServerName: settings.main.mediaServerType === MediaServerType.EMBY ? 'Emby' : 'Jellyfin',
        subtitleTracks,
        audioTracks,
      });
    }

    // Fallback to Plex
    const ratingKey = is4k ? media.ratingKey4k : media.ratingKey;

    if (!ratingKey) {
      logger.warn(`[Stream API] Plex ratingKey not found in local DB for TMDB ID: ${tmdbId} (is4k: ${is4k})`);
      return res.status(404).json({ message: 'Plex rating key not found.' });
    }

    logger.debug(`[Stream API] Found local DB entry. Type: ${media.mediaType}, RatingKey: ${ratingKey}`);

    const userRepository = getRepository(User);
    const admin = await userRepository.findOne({
      select: ['id', 'plexToken'],
      order: { id: 'ASC' },
      where: {}, // Empty where object is needed to fetch the first user
    });

    if (!admin || !admin.plexToken) {
      logger.error(`[Stream API] Admin Plex token not found in the database.`);
      return res.status(500).json({ message: 'Admin Plex Token not found.' });
    }

    const plex = new PlexAPI({
      plexToken: admin.plexToken,
      plexSettings: settings.plex,
    });

    let plexHost = settings.plex.ip;
    let plexPort = settings.plex.port;
    let protocol = settings.plex.useSsl ? 'https' : 'http';

    if (settings.plex.webAppUrl) {
      try {
        const urlObj = new URL(settings.plex.webAppUrl);
        if (!urlObj.hostname.includes('plex.tv')) {
          plexHost = urlObj.hostname;
          plexPort = urlObj.port ? Number(urlObj.port) : (urlObj.protocol === 'https:' ? 443 : 80);
          protocol = urlObj.protocol.replace(':', '');
        }
      } catch (e) {
        logger.warn(`[Stream API] Failed to parse custom webAppUrl: ${settings.plex.webAppUrl}, falling back to defaults`, { errorMessage: e.message });
      }
    }

    logger.debug(`[Stream API] Plex Server details resolved - Host: ${plexHost}, Port: ${plexPort}, Protocol: ${protocol}`);

    let targetRatingKey = ratingKey;

    if (media.mediaType === MediaType.TV) {
      const seasonNum = Number(req.query.season);
      const episodeNum = Number(req.query.episode);

      if (isNaN(seasonNum) || isNaN(episodeNum)) {
        logger.warn(`[Stream API] Missing season or episode query parameter for TV show TMDB ID: ${tmdbId}`);
        return res.status(400).json({ message: 'Season and episode parameters are required for TV shows.' });
      }

      logger.debug(`[Stream API] Querying Plex episodes list for TV series RatingKey: ${ratingKey}`);
      const episodes = await plex.getEpisodes(ratingKey) || [];
      const matchedEpisode = episodes.find(
        (ep: any) => ep.parentIndex === seasonNum && ep.index === episodeNum
      );

      if (!matchedEpisode) {
        logger.warn(`[Stream API] Episode S${seasonNum}E${episodeNum} not found in Plex library for TV series RatingKey: ${ratingKey}`);
        return res.status(404).json({ message: `Episode S${seasonNum}E${episodeNum} not found in Plex library.` });
      }

      targetRatingKey = matchedEpisode.ratingKey;
      logger.debug(`[Stream API] Matched episode S${seasonNum}E${episodeNum} to Plex RatingKey: ${targetRatingKey}`);
    }

    const metadata = (await plex.getMetadata(targetRatingKey)) as any;
    const subtitleTracks: any[] = [];
    const audioTracks: any[] = [];

    if (metadata && metadata.Media) {
      for (const mediaItem of metadata.Media) {
        if (mediaItem.Part) {
          for (const part of mediaItem.Part) {
            if (part.Stream) {
              for (const stream of part.Stream) {
                if (stream.streamType === 3) {
                  subtitleTracks.push({
                    id: stream.id,
                    language: stream.language || 'Unknown',
                    languageCode: stream.languageCode || 'unk',
                    codec: stream.codec,
                    title: stream.title || `${stream.language || 'Unknown'} (${stream.codec})`,
                    selected: !!stream.selected,
                  });
                } else if (stream.streamType === 2) {
                  audioTracks.push({
                    id: stream.id,
                    language: stream.language || 'Unknown',
                    languageCode: stream.languageCode || 'unk',
                    codec: stream.codec,
                    title: stream.title || `${stream.language || 'Unknown'} (${stream.codec})`,
                    selected: !!stream.selected,
                  });
                }
              }
            }
          }
        }
      }
    }

    const subtitleStreamID = req.query.subtitleStreamID ? Number(req.query.subtitleStreamID) : undefined;
    const audioStreamID = req.query.audioStreamID ? Number(req.query.audioStreamID) : undefined;

    let streamUrl = `${protocol}://${plexHost}:${plexPort}/video/:/transcode/universal/start.m3u8?path=%2Flibrary%2Fmetadata%2F${targetRatingKey}&mediaIndex=0&partIndex=0&protocol=hls&offset=0&fastSeek=1&directPlay=1&directStream=1&subtitleSize=100&audioBoost=100&location=lan&addResources=1&X-Plex-Token=${admin.plexToken}&X-Plex-Client-Identifier=${settings.clientId}&X-Plex-Product=Seerr&X-Plex-Device=Browser&X-Plex-Platform=Chrome`;

    if (subtitleStreamID !== undefined) {
      streamUrl += `&subtitleStreamID=${subtitleStreamID}`;
    }
    if (audioStreamID !== undefined) {
      streamUrl += `&audioStreamID=${audioStreamID}`;
    }

    const localHost = settings.plex.ip === 'plex' || settings.plex.ip === 'host.docker.internal' ? 'localhost' : settings.plex.ip;
    const webProtocol = settings.plex.useSsl ? 'https' : 'http';
    const plexWebUrl = `${webProtocol}://${localHost}:${settings.plex.port}/web/index.html#!/server/${settings.plex.machineId}/details?key=%2Flibrary%2Fmetadata%2F${targetRatingKey}`;

    logger.info(`[Stream API] Resolved Plex playback properties for TMDB ID: ${tmdbId}. Found ${subtitleTracks.length} subtitle tracks and ${audioTracks.length} audio tracks.`);

    return res.status(200).json({
      streamUrl,
      plexWebUrl,
      mediaServerWebUrl: plexWebUrl,
      mediaServerName: 'Plex',
      subtitleTracks,
      audioTracks,
    });
  } catch (e) {
    logger.error(`[Stream API] Failed to resolve stream URL for TMDB ID: ${req.params.id}`, { errorMessage: e.message });
    return next({ status: 500, message: 'Failed to resolve video stream.' });
  }
});

mediaRoutes.post<
  {
    id: string;
    status: 'available' | 'partial' | 'processing' | 'pending' | 'unknown';
  },
  Media
>(
  '/:id/:status',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    const mediaRepository = getRepository(Media);
    const seasonRepository = getRepository(Season);

    const media = await mediaRepository.findOne({
      where: { id: Number(req.params.id) },
    });

    if (!media) {
      return next({ status: 404, message: 'Media does not exist.' });
    }

    const is4k = String(req.body.is4k) === 'true';

    switch (req.params.status) {
      case 'available':
        media[is4k ? 'status4k' : 'status'] = MediaStatus.AVAILABLE;

        if (media.mediaType === MediaType.TV) {
          const expectedSeasons = req.body.seasons ?? [];

          for (const expectedSeason of expectedSeasons) {
            let season = media.seasons.find(
              (s) => s.seasonNumber === expectedSeason?.seasonNumber
            );

            if (!season) {
              // Create the season if it doesn't exist
              season = seasonRepository.create({
                seasonNumber: expectedSeason?.seasonNumber,
              });
              media.seasons.push(season);
            }

            season[is4k ? 'status4k' : 'status'] = MediaStatus.AVAILABLE;
          }
        }
        break;
      case 'partial':
        if (media.mediaType === MediaType.MOVIE) {
          return next({
            status: 400,
            message: 'Only series can be set to be partially available',
          });
        }
        media[is4k ? 'status4k' : 'status'] = MediaStatus.PARTIALLY_AVAILABLE;
        break;
      case 'processing':
        media[is4k ? 'status4k' : 'status'] = MediaStatus.PROCESSING;
        break;
      case 'pending':
        media[is4k ? 'status4k' : 'status'] = MediaStatus.PENDING;
        break;
      case 'unknown':
        media[is4k ? 'status4k' : 'status'] = MediaStatus.UNKNOWN;
    }

    await mediaRepository.save(media);

    return res.status(200).json(media);
  }
);

mediaRoutes.delete(
  '/:id',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    try {
      const mediaRepository = getRepository(Media);

      const media = await mediaRepository.findOneOrFail({
        where: { id: Number(req.params.id) },
      });

      if (media.status === MediaStatus.BLOCKLISTED) {
        media.resetServiceData();
        await mediaRepository.save(media);
      } else {
        await mediaRepository.remove(media);
      }

      return res.status(204).send();
    } catch (e) {
      if (e instanceof EntityNotFoundError) {
        return res.status(204).send();
      }
      logger.error('Something went wrong deleting media', {
        label: 'Media',
        mediaId: req.params.id,
        message: e.message,
      });
      next({ status: 500, message: 'Failed to delete media' });
    }
  }
);

mediaRoutes.delete(
  '/:id/file',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    try {
      const settings = getSettings();
      const mediaRepository = getRepository(Media);
      const media = await mediaRepository.findOneOrFail({
        where: { id: Number(req.params.id) },
      });

      const is4k = String(req.query.is4k) === 'true';
      const isMovie = media.mediaType === MediaType.MOVIE;

      let serviceSettings;
      if (isMovie) {
        serviceSettings = settings.radarr.find(
          (radarr) => radarr.isDefault && radarr.is4k === is4k
        );
      } else {
        serviceSettings = settings.sonarr.find(
          (sonarr) => sonarr.isDefault && sonarr.is4k === is4k
        );
      }

      const specificServiceId = is4k ? media.serviceId4k : media.serviceId;
      if (
        specificServiceId &&
        specificServiceId >= 0 &&
        serviceSettings?.id !== specificServiceId
      ) {
        if (isMovie) {
          serviceSettings = settings.radarr.find(
            (radarr) => radarr.id === specificServiceId
          );
        } else {
          serviceSettings = settings.sonarr.find(
            (sonarr) => sonarr.id === specificServiceId
          );
        }
      }

      if (!serviceSettings) {
        const arrName = `${is4k ? '4K ' : ''}${isMovie ? 'Radarr' : 'Sonarr'}`;
        logger.info(
          `There is no default ${arrName} server configured. Did you set any of your ${arrName} servers as default?`,
          {
            label: 'Media Request',
            mediaId: media.id,
          }
        );
        return next({
          status: 409,
          message: `No ${arrName} server configured to delete media files`,
        });
      }

      let service;
      if (isMovie) {
        service = new RadarrAPI({
          apiKey: serviceSettings?.apiKey,
          url: RadarrAPI.buildUrl(serviceSettings, '/api/v3'),
        });
      } else {
        service = new SonarrAPI({
          apiKey: serviceSettings?.apiKey,
          url: SonarrAPI.buildUrl(serviceSettings, '/api/v3'),
        });
      }

      if (isMovie) {
        await (service as RadarrAPI).removeMovie(media.tmdbId);
      } else {
        const tmdb = new TheMovieDb();
        const series = await tmdb.getTvShow({ tvId: media.tmdbId });
        const tvdbId = series.external_ids.tvdb_id ?? media.tvdbId;
        if (!tvdbId) {
          throw new Error('TVDB ID not found');
        }
        await (service as SonarrAPI).removeSeries(tvdbId);

        for (const season of media.seasons) {
          season[is4k ? 'status4k' : 'status'] = MediaStatus.DELETED;
        }
      }

      media[is4k ? 'status4k' : 'status'] = MediaStatus.DELETED;
      media.resetServiceData(is4k);
      await mediaRepository.save(media);

      return res.status(204).send();
    } catch (e) {
      if (e instanceof EntityNotFoundError) {
        return next({ status: 404, message: 'Media not found' });
      }
      logger.error('Something went wrong deleting media file', {
        label: 'Media',
        mediaId: req.params.id,
        message: e.message,
      });
      next({ status: 500, message: 'Failed to delete media file' });
    }
  }
);

mediaRoutes.get<{ id: string }, MediaWatchDataResponse>(
  '/:id/watch_data',
  isAuthenticated(Permission.ADMIN),
  async (req, res, next) => {
    const settings = getSettings().tautulli;

    if (!settings.hostname || !settings.port || !settings.apiKey) {
      return next({
        status: 404,
        message: 'Tautulli API not configured.',
      });
    }

    const media = await getRepository(Media).findOne({
      where: { id: Number(req.params.id) },
    });

    if (!media) {
      return next({ status: 404, message: 'Media does not exist.' });
    }

    try {
      const tautulli = new TautulliAPI(settings);
      const userRepository = getRepository(User);

      const response: MediaWatchDataResponse = {};

      if (media.ratingKey) {
        const watchStats = await tautulli.getMediaWatchStats(media.ratingKey);
        const watchUsers = await tautulli.getMediaWatchUsers(media.ratingKey);
        const plexIds = watchUsers.map((u) => u.user_id);
        if (!plexIds.length) plexIds.push(-1);

        const users = await userRepository
          .createQueryBuilder('user')
          .where('user.plexId IN (:...plexIds)', { plexIds })
          .getMany();

        const playCount =
          watchStats.find((i) => i.query_days == 0)?.total_plays ?? 0;

        const playCount7Days =
          watchStats.find((i) => i.query_days == 7)?.total_plays ?? 0;

        const playCount30Days =
          watchStats.find((i) => i.query_days == 30)?.total_plays ?? 0;

        response.data = {
          users: users,
          playCount,
          playCount7Days,
          playCount30Days,
        };
      }

      if (media.ratingKey4k) {
        const watchStats4k = await tautulli.getMediaWatchStats(
          media.ratingKey4k
        );
        const watchUsers4k = await tautulli.getMediaWatchUsers(
          media.ratingKey4k
        );
        const plexIds4k = watchUsers4k.map((u) => u.user_id);
        if (!plexIds4k.length) plexIds4k.push(-1);

        const users = await userRepository
          .createQueryBuilder('user')
          .where('user.plexId IN (:...plexIds)', { plexIds: plexIds4k })
          .getMany();

        const playCount =
          watchStats4k.find((i) => i.query_days == 0)?.total_plays ?? 0;

        const playCount7Days =
          watchStats4k.find((i) => i.query_days == 7)?.total_plays ?? 0;

        const playCount30Days =
          watchStats4k.find((i) => i.query_days == 30)?.total_plays ?? 0;

        response.data4k = {
          users,
          playCount,
          playCount7Days,
          playCount30Days,
        };
      }

      return res.status(200).json(response);
    } catch (e) {
      logger.error('Something went wrong fetching media watch data', {
        label: 'API',
        errorMessage: e.message,
        mediaId: req.params.id,
      });
      next({ status: 500, message: 'Failed to fetch watch data.' });
    }
  }
);

export default mediaRoutes;

import JellyfinAPI from '@server/api/jellyfin';
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { Watched } from '@server/entity/Watched';
import { getSettings } from '@server/lib/settings';
import { torrentManager } from '@server/lib/torrentManager';
import logger from '@server/logger';
import { getHostname } from '@server/utils/getHostname';
import axios from 'axios';
import fs from 'fs';

export interface StorageDiskInfo {
  path: string;
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
  freePercent: number;
  usedPercent: number;
}

export interface StorageBreakdown {
  moviesBytes: number;
  tvBytes: number;
  otherBytes: number;
  totalMediaBytes: number;
}

export interface StorageStatusResponse {
  disks: StorageDiskInfo[];
  primaryDisk?: StorageDiskInfo;
  breakdown: StorageBreakdown;
  isLowStorage: boolean;
  alertThresholdGb: number;
  alertThresholdPercent: number;
  alertEnabled: boolean;
  activeDownloadsCount: number;
}

export interface CleanupCandidateItem {
  id: string; // `${mediaType}-${id}`
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  radarrId?: number;
  sonarrId?: number;
  title: string;
  year?: number;
  posterPath?: string;
  sizeBytes: number;
  addedDate?: string;
  daysInactive: number;
  isWatched: boolean;
  overview?: string;
}

class StorageTracker {
  private getDiskStat(mountPath: string): StorageDiskInfo | null {
    try {
      if (fs.existsSync(mountPath) && fs.statfsSync) {
        const stats = fs.statfsSync(mountPath);
        const bsize = stats.bsize || 4096;
        const totalBytes = Number(stats.blocks) * bsize;
        const freeBytes = Number(stats.bfree || stats.bavail) * bsize;
        const usedBytes = Math.max(0, totalBytes - freeBytes);
        const freePercent = totalBytes > 0 ? (freeBytes / totalBytes) * 100 : 0;
        const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
        return {
          path: mountPath,
          totalBytes,
          freeBytes,
          usedBytes,
          freePercent: Number(freePercent.toFixed(1)),
          usedPercent: Number(usedPercent.toFixed(1)),
        };
      }
    } catch {
      // path not found or statfs failed
    }
    return null;
  }

  public async getStorageStatus(): Promise<StorageStatusResponse> {
    const settings = getSettings();
    const candidatePaths = [
      '/data/media',
      'C:\\arr-stack\\data\\media',
      '/',
      'C:\\',
    ];

    const diskMap = new Map<string, StorageDiskInfo>();
    for (const p of candidatePaths) {
      const stat = this.getDiskStat(p);
      if (stat && stat.totalBytes > 0) {
        const normalized = stat.path.replace(/\\/g, '/');
        if (!diskMap.has(normalized)) {
          diskMap.set(normalized, stat);
        }
      }
    }

    // Radarr / Sonarr diskspace fallback / complement
    let radarrMovies: any[] = [];
    let sonarrSeries: any[] = [];

    const defaultRadarr =
      settings.radarr.find((r) => r.isDefault) ?? settings.radarr[0];
    if (defaultRadarr) {
      try {
        const radarr = new RadarrAPI({
          apiKey: defaultRadarr.apiKey,
          url: RadarrAPI.buildUrl(defaultRadarr, '/api/v3'),
        });
        const radarrDisks = await radarr.getDiskspace();
        for (const rd of radarrDisks || []) {
          const p = rd.path || rd.label || 'Radarr Storage';
          if (!diskMap.has(p) && rd.totalSpace > 0) {
            const free = rd.freeSpace || 0;
            const total = rd.totalSpace || 0;
            const used = total - free;
            diskMap.set(p, {
              path: p,
              totalBytes: total,
              freeBytes: free,
              usedBytes: used,
              freePercent: Number(((free / total) * 100).toFixed(1)),
              usedPercent: Number(((used / total) * 100).toFixed(1)),
            });
          }
        }
        radarrMovies = await radarr.getAllMovies();
      } catch (err) {
        logger.debug(`[StorageTracker] Radarr query error: ${err.message}`);
      }
    }

    const defaultSonarr =
      settings.sonarr.find((s) => s.isDefault) ?? settings.sonarr[0];
    if (defaultSonarr) {
      try {
        const sonarr = new SonarrAPI({
          apiKey: defaultSonarr.apiKey,
          url: SonarrAPI.buildUrl(defaultSonarr, '/api/v3'),
        });
        sonarrSeries = await sonarr.getAllSeries();
      } catch (err) {
        logger.debug(`[StorageTracker] Sonarr query error: ${err.message}`);
      }
    }

    const disks = Array.from(diskMap.values());
    const primaryDisk =
      disks.find((d) => d.path.includes('media')) ||
      disks.find((d) => d.path === '/') ||
      disks[0];

    // Compute library breakdown
    let moviesBytes = 0;
    for (const m of radarrMovies) {
      moviesBytes += m.sizeOnDisk || m.movieFile?.size || 0;
    }

    let tvBytes = 0;
    for (const s of sonarrSeries) {
      tvBytes += s.statistics?.sizeOnDisk || 0;
    }

    const totalMediaBytes = moviesBytes + tvBytes;
    const otherBytes = primaryDisk
      ? Math.max(0, primaryDisk.usedBytes - totalMediaBytes)
      : 0;

    const alertEnabled = settings.main.lowStorageAlertEnabled ?? true;
    const alertThresholdGb = settings.main.lowStorageThresholdGb ?? 80;
    const alertThresholdPercent =
      settings.main.lowStorageThresholdPercent ?? 10;

    let isLowStorage = false;
    if (alertEnabled && primaryDisk) {
      const freeGb = primaryDisk.freeBytes / (1024 * 1024 * 1024);
      if (
        freeGb <= alertThresholdGb ||
        primaryDisk.freePercent <= alertThresholdPercent
      ) {
        isLowStorage = true;
      }
    }

    return {
      disks,
      primaryDisk,
      breakdown: {
        moviesBytes,
        tvBytes,
        otherBytes,
        totalMediaBytes,
      },
      isLowStorage,
      alertThresholdGb,
      alertThresholdPercent,
      alertEnabled,
      activeDownloadsCount: 0,
    };
  }

  public async getCleanupCandidates(
    filter: 'unwatched' | 'watched' | 'all' = 'unwatched'
  ): Promise<CleanupCandidateItem[]> {
    const settings = getSettings();
    const tmdb = new TheMovieDb();
    const candidates: CleanupCandidateItem[] = [];

    // Load watched registry
    const watchedSet = new Set<string>();
    try {
      const watchedRepo = getRepository(Watched);
      const allWatched = await watchedRepo.find();
      for (const w of allWatched) {
        watchedSet.add(`${w.mediaType}-${w.tmdbId}`);
      }
    } catch {
      // fallback if DataSource is uninitialized in CLI or test
    }

    // Optional Jellyfin watch query
    let jellyfinWatchedItems: Set<string> | null = null;
    if (settings.jellyfin.apiKey && settings.jellyfin.userId) {
      try {
        const jfRes = await axios.get(
          `${getHostname(settings.jellyfin)}/Users/${settings.jellyfin.userId}/Items`,
          {
            headers: { 'X-Emby-Token': settings.jellyfin.apiKey },
            params: {
              isPlayed: true,
              includeItemTypes: 'Movie,Series',
              recursive: true,
            },
            timeout: 5000,
          }
        );
        const jfItems: any[] = jfRes.data?.Items ?? [];
        if (Array.isArray(jfItems)) {
          jellyfinWatchedItems = new Set<string>();
          for (const it of jfItems) {
            const providerIds = it.ProviderIds || {};
            if (providerIds.Tmdb) {
              jellyfinWatchedItems.add(
                `${it.Type === 'Series' ? 'tv' : 'movie'}-${providerIds.Tmdb}`
              );
            }
          }
        }
      } catch {
        // ignore Jellyfin error
      }
    }

    const defaultRadarr =
      settings.radarr.find((r) => r.isDefault) ?? settings.radarr[0];
    if (defaultRadarr) {
      try {
        const radarr = new RadarrAPI({
          apiKey: defaultRadarr.apiKey,
          url: RadarrAPI.buildUrl(defaultRadarr, '/api/v3'),
        });
        const movies = await radarr.getAllMovies();
        for (const m of movies) {
          const size = m.sizeOnDisk || m.movieFile?.size || 0;
          if (!m.hasFile || size <= 0) continue;

          const tmdbId = m.tmdbId;
          const key = `movie-${tmdbId}`;
          const isWatched =
            watchedSet.has(key) ||
            (jellyfinWatchedItems ? jellyfinWatchedItems.has(key) : false);

          if (filter === 'unwatched' && isWatched) continue;
          if (filter === 'watched' && !isWatched) continue;

          const addedDate = m.added || m.movieFile?.dateAdded;
          const daysInactive = addedDate
            ? Math.max(
                0,
                Math.floor(
                  (Date.now() - new Date(addedDate).getTime()) /
                    (1000 * 60 * 60 * 24)
                )
              )
            : 0;

          // Poster from images or TMDB
          let posterPath: string | undefined = undefined;
          const posterImg = (m.images || []).find(
            (img: any) => img.coverType === 'poster'
          );
          if (posterImg?.remoteUrl) {
            posterPath = posterImg.remoteUrl;
          }

          candidates.push({
            id: `movie-${m.id}`,
            mediaType: 'movie',
            tmdbId,
            radarrId: m.id,
            title: m.title,
            year: m.year,
            posterPath,
            sizeBytes: size,
            addedDate,
            daysInactive,
            isWatched,
            overview: m.overview,
          });
        }
      } catch (err) {
        logger.error(
          `[StorageTracker] Error fetching Radarr movies: ${err.message}`
        );
      }
    }

    const defaultSonarr =
      settings.sonarr.find((s) => s.isDefault) ?? settings.sonarr[0];
    if (defaultSonarr) {
      try {
        const sonarr = new SonarrAPI({
          apiKey: defaultSonarr.apiKey,
          url: SonarrAPI.buildUrl(defaultSonarr, '/api/v3'),
        });
        const seriesList = await sonarr.getAllSeries();
        for (const s of seriesList) {
          const size = s.statistics?.sizeOnDisk || 0;
          if (size <= 0 || (s.statistics?.episodeFileCount || 0) === 0)
            continue;

          let tmdbId = s.tmdbId;
          if (!tmdbId && s.tvdbId) {
            try {
              const tmdbShow = await tmdb.getShowByTvdbId({ tvdbId: s.tvdbId });
              tmdbId = tmdbShow.id;
            } catch {
              // fallback
            }
          }

          const key = `tv-${tmdbId || s.tvdbId}`;
          const isWatched =
            (tmdbId ? watchedSet.has(key) : false) ||
            (jellyfinWatchedItems && tmdbId
              ? jellyfinWatchedItems.has(key)
              : false);

          if (filter === 'unwatched' && isWatched) continue;
          if (filter === 'watched' && !isWatched) continue;

          const addedDate = s.added;
          const daysInactive = addedDate
            ? Math.max(
                0,
                Math.floor(
                  (Date.now() - new Date(addedDate).getTime()) /
                    (1000 * 60 * 60 * 24)
                )
              )
            : 0;

          let posterPath: string | undefined = undefined;
          const posterImg = (s.images || []).find(
            (img: any) => img.coverType === 'poster'
          );
          if (posterImg?.remoteUrl) {
            posterPath = posterImg.remoteUrl;
          }

          candidates.push({
            id: `tv-${s.id}`,
            mediaType: 'tv',
            tmdbId: tmdbId || s.tvdbId,
            sonarrId: s.id,
            title: s.title,
            year: s.year,
            posterPath,
            sizeBytes: size,
            addedDate,
            daysInactive,
            isWatched,
            overview: s.overview,
          });
        }
      } catch (err) {
        logger.error(
          `[StorageTracker] Error fetching Sonarr series: ${err.message}`
        );
      }
    }

    // Sort by oldest inactive first by default
    candidates.sort((a, b) => b.daysInactive - a.daysInactive);

    return candidates;
  }

  public async deleteMediaItems(
    items: Array<{
      mediaType: 'movie' | 'tv';
      tmdbId: number;
      radarrId?: number;
      sonarrId?: number;
      title?: string;
      year?: number;
    }>
  ): Promise<{ freedBytes: number; deletedCount: number }> {
    const settings = getSettings();
    let freedBytes = 0;
    let deletedCount = 0;

    const mediaRepository = getRepository(Media);

    for (const item of items) {
      try {
        if (item.mediaType === 'movie') {
          const defaultRadarr =
            settings.radarr.find((r) => r.isDefault) ?? settings.radarr[0];
          if (defaultRadarr) {
            const radarr = new RadarrAPI({
              apiKey: defaultRadarr.apiKey,
              url: RadarrAPI.buildUrl(defaultRadarr, '/api/v3'),
            });

            let radarrMovieId = item.radarrId;
            if (!radarrMovieId && item.tmdbId) {
              const m = await radarr.getMovieByTmdbId(item.tmdbId);
              radarrMovieId = m?.id;
            }

            if (radarrMovieId) {
              const movie: any = await radarr.getMovie({ id: radarrMovieId });
              const mSize = movie?.sizeOnDisk || movie?.movieFile?.size || 0;
              await radarr.deleteMovie(radarrMovieId, true);
              freedBytes += mSize;
              deletedCount += 1;
            }
          }

          // Purge from qBittorrent
          await torrentManager.deleteMediaTorrents({
            title: item.title,
            year: item.year,
            category: 'radarr',
          });

          // Delete or update Media in database
          if (item.tmdbId) {
            const dbMedia = await mediaRepository.findOne({
              where: { tmdbId: item.tmdbId, mediaType: MediaType.MOVIE },
            });
            if (dbMedia) {
              await mediaRepository.remove(dbMedia);
            }
          }
        } else if (item.mediaType === 'tv') {
          const defaultSonarr =
            settings.sonarr.find((s) => s.isDefault) ?? settings.sonarr[0];
          if (defaultSonarr) {
            const sonarr = new SonarrAPI({
              apiKey: defaultSonarr.apiKey,
              url: SonarrAPI.buildUrl(defaultSonarr, '/api/v3'),
            });

            let sonarrSeriesId = item.sonarrId;
            if (!sonarrSeriesId && item.tmdbId) {
              const series = await sonarr.getSeriesByTvdbId(item.tmdbId);
              sonarrSeriesId = series?.id;
            }

            if (sonarrSeriesId) {
              const s = await sonarr.getSeriesById(sonarrSeriesId);
              const sSize = s?.statistics?.sizeOnDisk || 0;
              await sonarr.deleteSeries(sonarrSeriesId, true);
              freedBytes += sSize;
              deletedCount += 1;
            }
          }

          // Purge from qBittorrent
          await torrentManager.deleteMediaTorrents({
            title: item.title,
            year: item.year,
            category: 'sonarr',
          });

          // Delete or update Media in database
          if (item.tmdbId) {
            const dbMedia = await mediaRepository.findOne({
              where: { tmdbId: item.tmdbId, mediaType: MediaType.TV },
            });
            if (dbMedia) {
              await mediaRepository.remove(dbMedia);
            }
          }
        }
      } catch (err) {
        logger.error(
          `[StorageTracker] Failed to delete ${item.mediaType} (${item.title || item.tmdbId}): ${err.message}`
        );
      }
    }

    // Refresh Jellyfin if configured
    if (settings.jellyfin.apiKey) {
      try {
        const jellyfin = new JellyfinAPI(
          getHostname(settings.jellyfin),
          settings.jellyfin.apiKey
        );
        await jellyfin.refreshLibrary();
      } catch {
        // ignore
      }
    }

    return { freedBytes, deletedCount };
  }
}

export const storageTracker = new StorageTracker();
export default storageTracker;

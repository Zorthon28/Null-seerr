import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import axios from 'axios';
import { uniqWith } from 'lodash';

export interface StalledSkipParams {
  mediaType: 'movie' | 'tv';
  tmdbId?: number;
  downloadId?: string;
  queueId?: number;
  serverId?: number;
  externalId?: number;
}

interface StalledTrackEntry {
  firstSeenStalled: number;
  title: string;
  mediaType: 'movie' | 'tv';
  tmdbId?: number;
  externalId?: number;
  queueId?: number;
  serverId?: number;
}

class StalledDownloadAutomation {
  private static instance: StalledDownloadAutomation;
  private stalledMap = new Map<string, StalledTrackEntry>();
  private lastCheckAt = 0;
  private isChecking = false;

  public static getInstance(): StalledDownloadAutomation {
    if (!StalledDownloadAutomation.instance) {
      StalledDownloadAutomation.instance = new StalledDownloadAutomation();
    }
    return StalledDownloadAutomation.instance;
  }

  private getQbitBaseUrls(): string[] {
    const customHost = process.env.QBITTORRENT_HOST;
    const customPort = process.env.QBITTORRENT_PORT || '8080';
    const hosts = [
      customHost ? `${customHost}:${customPort}` : null,
      'qbittorrent:8080',
      'localhost:8089',
      'localhost:8080',
      '127.0.0.1:8089',
      '127.0.0.1:8080',
      'qbit:8080',
    ].filter(Boolean) as string[];

    return hosts.map((h) => `http://${h}`);
  }

  /**
   * Helper to fetch active torrent list from qBittorrent
   */
  public async getQbitTorrents(): Promise<any[]> {
    for (const base of this.getQbitBaseUrls()) {
      try {
        const res = await axios.get(`${base}/api/v2/torrents/info`, { timeout: 3000 });
        if (Array.isArray(res.data)) {
          return res.data;
        }
      } catch {
        // try next host
      }
    }
    return [];
  }

  /**
   * Helper to delete torrent from qBittorrent directly
   */
  public async deleteFromQbittorrent(hash: string): Promise<boolean> {
    for (const base of this.getQbitBaseUrls()) {
      try {
        const url = `${base}/api/v2/torrents/delete`;
        const params = new URLSearchParams();
        params.append('hashes', hash);
        params.append('deleteFiles', 'true');
        await axios.post(url, params.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 4000,
        });
        logger.info(`[StalledAutomation] Deleted torrent ${hash} directly from qBittorrent (${base})`);
        return true;
      } catch {
        // try next host
      }
    }
    return false;
  }

  /**
   * Scans Sonarr and Radarr queues for ghost/redundant items where media is already
   * present on disk, and purges them without triggering additional redundant searches.
   */
  public async cleanGhostQueue(): Promise<void> {
    const settings = getSettings();
    const torrents = await this.getQbitTorrents();
    const torrentMap = new Map<string, any>();
    for (const t of torrents) {
      if (t.hash) torrentMap.set(t.hash.toLowerCase(), t);
    }

    // 1. Check Sonarr queues
    const filteredSonarr = uniqWith(
      settings.sonarr,
      (a, b) => a.hostname === b.hostname && a.port === b.port && a.baseUrl === b.baseUrl
    );

    for (const server of filteredSonarr) {
      if (!server.syncEnabled) continue;
      const sonarrApi = new SonarrAPI({
        apiKey: server.apiKey,
        url: SonarrAPI.buildUrl(server, '/api/v3'),
      });

      try {
        const queue = await sonarrApi.getQueue();
        if (!queue || !queue.length) continue;

        // Group queue items by downloadId (fallback to seriesId if no downloadId)
        const groups = new Map<string, typeof queue>();
        for (const item of queue) {
          const key = (item.downloadId || `series_${item.seriesId}`).toLowerCase();
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(item);
        }

        for (const [key, items] of groups.entries()) {
          const allEpisodesHaveFile = items.every((i) => i.episodeHasFile === true);
          const firstItem = items[0];
          const downloadId = firstItem.downloadId?.toLowerCase();

          // If all episodes in this queued torrent ALREADY have files on disk
          if (allEpisodesHaveFile) {
            const tor = downloadId ? torrentMap.get(downloadId) : null;
            // Purge if torrent is stalled (0 seeds / metaDL / 0% progress) OR if not even in torrent client
            const isRedundantOrStalled =
              !tor ||
              tor.state === 'metaDL' ||
              tor.state === 'stalledDL' ||
              tor.state === 'queuedDL' ||
              (tor.num_seeds === 0 && tor.progress < 0.05);

            if (isRedundantOrStalled) {
              logger.info(
                `[GhostQueueCleanup] Removing ${items.length} ghost queue items for series ID ${firstItem.seriesId} ("${firstItem.title}") — all episodes already exist on disk.`
              );

              const ids = items.map((i) => i.id);
              await sonarrApi.deleteQueueBulk({
                ids,
                removeFromClient: true,
                blocklist: false,
              });

              if (downloadId) {
                await this.deleteFromQbittorrent(downloadId).catch(() => {});
                this.stalledMap.delete(downloadId);
              }
            }
          }
        }
      } catch (e: any) {
        logger.debug(`[GhostQueueCleanup] Sonarr check failed on ${server.name}: ${e.message}`);
      }
    }

    // 2. Check Radarr queues
    const filteredRadarr = uniqWith(
      settings.radarr,
      (a, b) => a.hostname === b.hostname && a.port === b.port && a.baseUrl === b.baseUrl
    );

    for (const server of filteredRadarr) {
      if (!server.syncEnabled) continue;
      const radarrApi = new RadarrAPI({
        apiKey: server.apiKey,
        url: RadarrAPI.buildUrl(server, '/api/v3'),
      });

      try {
        const queue = await radarrApi.getQueue();
        if (!queue || !queue.length) continue;

        for (const item of queue) {
          if (!item.movieId) continue;
          try {
            const movie = await radarrApi.getMovie({ id: item.movieId });
            if (movie && movie.hasFile) {
              const downloadId = item.downloadId?.toLowerCase();
              const tor = downloadId ? torrentMap.get(downloadId) : null;
              const isRedundantOrStalled =
                !tor ||
                tor.state === 'metaDL' ||
                tor.state === 'stalledDL' ||
                tor.state === 'queuedDL' ||
                (tor.num_seeds === 0 && tor.progress < 0.05);

              if (isRedundantOrStalled) {
                logger.info(
                  `[GhostQueueCleanup] Removing ghost queue item ID ${item.id} for movie "${movie.title}" — movie already has file on disk.`
                );

                await radarrApi.deleteQueueItem({
                  id: item.id,
                  removeFromClient: true,
                  blocklist: false,
                });

                if (downloadId) {
                  await this.deleteFromQbittorrent(downloadId).catch(() => {});
                  this.stalledMap.delete(downloadId);
                }
              }
            }
          } catch {
            // ignore individual movie check errors
          }
        }
      } catch (e: any) {
        logger.debug(`[GhostQueueCleanup] Radarr check failed on ${server.name}: ${e.message}`);
      }
    }
  }

  /**
   * Removes a stalled release from Sonarr/Radarr, blocklists it so it won't be grabbed again,
   * wipes it from qBittorrent, and immediately triggers an alternative search on indexers
   * (only if the media does not already exist on disk).
   */
  public async skipStalledTorrent(params: StalledSkipParams): Promise<{ success: boolean; message: string }> {
    const settings = getSettings();
    const { mediaType, tmdbId, downloadId, queueId, serverId, externalId } = params;
    let handled = false;
    let releaseTitle = downloadId || 'stalled torrent';

    logger.info(`[StalledAutomation] skipStalledTorrent requested for ${mediaType} tmdbId=${tmdbId} downloadId=${downloadId} queueId=${queueId}`);

    if (mediaType === 'tv') {
      const filteredSonarr = uniqWith(settings.sonarr, (a, b) => a.hostname === b.hostname && a.port === b.port && a.baseUrl === b.baseUrl);

      for (const server of filteredSonarr) {
        if (serverId && server.id !== serverId) continue;
        const sonarrApi = new SonarrAPI({
          apiKey: server.apiKey,
          url: SonarrAPI.buildUrl(server, '/api/v3'),
        });

        try {
          const queue = await sonarrApi.getQueue();
          const matchingItems = queue.filter(
            (q) =>
              (queueId && q.id === queueId) ||
              (downloadId && q.downloadId?.toLowerCase() === downloadId.toLowerCase()) ||
              (externalId && q.seriesId === externalId)
          );

          if (matchingItems.length > 0) {
            releaseTitle = matchingItems[0].title || releaseTitle;
            const seriesId = matchingItems[0].seriesId;
            const allFilesExist = matchingItems.every((q) => q.episodeHasFile === true);

            logger.info(
              `[StalledAutomation] Found ${matchingItems.length} items in Sonarr (${server.name}) queue for "${releaseTitle}". Blocklisting and removing...`
            );

            // Bulk delete all matching queue items with blocklist=true and removeFromClient=true
            await sonarrApi.deleteQueueBulk({
              ids: matchingItems.map((q) => q.id),
              removeFromClient: true,
              blocklist: true,
            });

            // Trigger immediate search for alternative release ONLY if files are missing
            if (!allFilesExist) {
              logger.info(`[StalledAutomation] Triggering alternative search for series ID ${seriesId}...`);
              await sonarrApi.searchSeries(seriesId);
            } else {
              logger.info(
                `[StalledAutomation] Skipping search for series ID ${seriesId} because all episodes already exist on disk.`
              );
            }
            handled = true;
            break;
          }
        } catch (e: any) {
          logger.error(`[StalledAutomation] Failed to process queue removal on Sonarr ${server.name}: ${e.message}`);
        }
      }
    } else {
      const filteredRadarr = uniqWith(settings.radarr, (a, b) => a.hostname === b.hostname && a.port === b.port && a.baseUrl === b.baseUrl);

      for (const server of filteredRadarr) {
        if (serverId && server.id !== serverId) continue;
        const radarrApi = new RadarrAPI({
          apiKey: server.apiKey,
          url: RadarrAPI.buildUrl(server, '/api/v3'),
        });

        try {
          const queue = await radarrApi.getQueue();
          const matchingItems = queue.filter(
            (q) =>
              (queueId && q.id === queueId) ||
              (downloadId && q.downloadId?.toLowerCase() === downloadId.toLowerCase()) ||
              (externalId && q.movieId === externalId)
          );

          if (matchingItems.length > 0) {
            releaseTitle = matchingItems[0].title || releaseTitle;
            const movieId = matchingItems[0].movieId;

            logger.info(
              `[StalledAutomation] Found ${matchingItems.length} items in Radarr (${server.name}) queue for "${releaseTitle}". Blocklisting and removing...`
            );

            // Delete queue items with blocklist=true and removeFromClient=true
            await radarrApi.deleteQueueBulk({
              ids: matchingItems.map((q) => q.id),
              removeFromClient: true,
              blocklist: true,
            });

            // Check if movie already has file before searching
            let hasFile = false;
            try {
              const movie = await radarrApi.getMovie({ id: movieId });
              hasFile = Boolean(movie?.hasFile);
            } catch {}

            if (!hasFile) {
              logger.info(`[StalledAutomation] Triggering alternative search for movie ID ${movieId}...`);
              await radarrApi.searchMovie(movieId);
            } else {
              logger.info(
                `[StalledAutomation] Skipping search for movie ID ${movieId} because movie already has file on disk.`
              );
            }
            handled = true;
            break;
          }
        } catch (e: any) {
          logger.error(`[StalledAutomation] Failed to process queue removal on Radarr ${server.name}: ${e.message}`);
        }
      }
    }

    // Direct qBittorrent deletion as safety fallback
    if (downloadId) {
      await this.deleteFromQbittorrent(downloadId).catch(() => {});
      this.stalledMap.delete(downloadId.toLowerCase());
    }

    if (handled) {
      return {
        success: true,
        message: `Dead release "${releaseTitle}" has been blocklisted. Searching for an alternative release...`,
      };
    }

    return {
      success: true,
      message: `Alternative search triggered for ${mediaType}.`,
    };
  }

  /**
   * Periodic check called to detect and clean up long-stalled torrents (0 seeds, 0% progress)
   * and purge ghost queue entries for already-imported media.
   * Default threshold: 5 minutes of continuous 0 seeds (3 minutes for metaDL).
   */
  public async checkAndCleanStalled(stalledThresholdMinutes = 5): Promise<void> {
    if (this.isChecking) return;
    const now = Date.now();
    // Throttle checks to once every 30 seconds
    if (now - this.lastCheckAt < 30_000) return;
    this.lastCheckAt = now;
    this.isChecking = true;

    try {
      // 1. Run ghost queue cleanup first to remove redundant downloads for existing media
      await this.cleanGhostQueue().catch((e) =>
        logger.debug(`[StalledAutomation] cleanGhostQueue error: ${e.message}`)
      );

      // 2. Scan active torrents for dead swarms
      const torrents = await this.getQbitTorrents();
      if (!torrents.length) return;

      const activeHashes = new Set<string>();

      for (const t of torrents) {
        const hash = (t.hash || '').toLowerCase();
        if (!hash) continue;
        activeHashes.add(hash);

        const progress = (t.progress || 0) * 100;
        const seedsConnected = t.num_seeds ?? 0;
        const state = t.state || '';
        const dlspeed = t.dlspeed || 0;

        // A torrent is considered dead if:
        // - Less than 2% progress
        // - 0 connected seeders
        // - State is metaDL (cannot get metadata), stalledDL, queuedDL, or dl speed 0 (non-upload)
        const isStalledDead =
          progress < 2 &&
          seedsConnected === 0 &&
          (state === 'stalledDL' ||
            state === 'metaDL' ||
            state === 'queuedDL' ||
            (dlspeed === 0 && !state.includes('UP')));

        if (isStalledDead) {
          const existing = this.stalledMap.get(hash);
          if (!existing) {
            this.stalledMap.set(hash, {
              firstSeenStalled: now,
              title: t.name || hash,
              mediaType: t.category === 'tv' ? 'tv' : 'movie',
            });
            logger.debug(
              `[StalledAutomation] Tracking newly stalled torrent "${t.name}" (hash: ${hash}, 0 seeds, state: ${state})`
            );
          } else {
            const minutesStalled = (now - existing.firstSeenStalled) / (1000 * 60);

            // metaDL with 0 seeds gets only 3 minutes before auto-healing; others get 5 minutes
            const threshold = state === 'metaDL' ? Math.min(3, stalledThresholdMinutes) : stalledThresholdMinutes;

            if (minutesStalled >= threshold) {
              logger.info(
                `[StalledAutomation] Torrent "${existing.title}" (hash: ${hash}) has been stalled at ${progress.toFixed(
                  1
                )}% with 0 connected seeds for ${minutesStalled.toFixed(
                  1
                )}m (state: ${state}). Auto-blocklisting and finding alternative...`
              );

              // Auto-skip (blocklist dead release and trigger alternative search if not already downloaded)
              await this.skipStalledTorrent({
                mediaType: existing.mediaType,
                downloadId: hash,
              }).catch((e) => logger.warn(`[StalledAutomation] Auto-skip failed: ${e.message}`));

              this.stalledMap.delete(hash);
            }
          }
        } else {
          // If seeds connected or progressing, remove from stalled tracker
          if (this.stalledMap.has(hash)) {
            logger.debug(
              `[StalledAutomation] Torrent "${t.name}" resumed activity (${seedsConnected} seeds, speed: ${Math.round(
                dlspeed / 1024
              )} KB/s) — removed from stalled tracker.`
            );
            this.stalledMap.delete(hash);
          }
        }
      }

      // Cleanup entries that no longer exist in qBittorrent
      for (const trackedHash of this.stalledMap.keys()) {
        if (!activeHashes.has(trackedHash)) {
          this.stalledMap.delete(trackedHash);
        }
      }
    } catch (e: any) {
      logger.debug(`[StalledAutomation] checkAndCleanStalled error: ${e.message}`);
    } finally {
      this.isChecking = false;
    }
  }
}

export const stalledDownloadAutomation = StalledDownloadAutomation.getInstance();
export default stalledDownloadAutomation;

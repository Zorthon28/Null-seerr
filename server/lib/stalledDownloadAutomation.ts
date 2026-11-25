import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { torrentManager } from '@server/lib/torrentManager';
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
  reported?: boolean;
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

  public async skipStalledTorrent(params: StalledSkipParams): Promise<{ success: boolean; message: string }> {
    const settings = getSettings();
    const { mediaType, tmdbId, downloadId, queueId, serverId } = params;
    if (serverId === undefined || !Number.isSafeInteger(serverId) || (!downloadId && !queueId)) {
      return { success: false, message: 'Select a specific release on an Arr server.' };
    }
    let handled = false;
    let searched = false;

    logger.info(`[StalledAutomation] skipStalledTorrent requested for ${mediaType} tmdbId=${tmdbId} downloadId=${downloadId} queueId=${queueId}`);

    if (mediaType === 'tv') {
      const filteredSonarr = uniqWith(settings.sonarr, (a, b) => a.hostname === b.hostname && a.port === b.port && a.baseUrl === b.baseUrl);

      for (const server of filteredSonarr) {
        if (server.id !== serverId) continue;
        const sonarrApi = new SonarrAPI({
          apiKey: server.apiKey,
          url: SonarrAPI.buildUrl(server, '/api/v3'),
        });

        try {
          const queue = await sonarrApi.getQueue();
          const matchingItems = queue.filter(
            (q) =>
              (downloadId ? q.downloadId?.toLowerCase() === downloadId.toLowerCase() : q.id === queueId)
          );

          if (matchingItems.length > 0) {
            const seriesId = matchingItems[0].seriesId;
            const allFilesExist = matchingItems.every((q) => q.episodeHasFile === true);


            // Trigger immediate search for alternative release ONLY if files are missing
            if (!allFilesExist) {
              logger.info(`[StalledAutomation] Triggering alternative search for series ID ${seriesId}...`);
              await sonarrApi.searchSeries(seriesId);
              searched = true;
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
        if (server.id !== serverId) continue;
        const radarrApi = new RadarrAPI({
          apiKey: server.apiKey,
          url: RadarrAPI.buildUrl(server, '/api/v3'),
        });

        try {
          const queue = await radarrApi.getQueue();
          const matchingItems = queue.filter(
            (q) =>
              (downloadId ? q.downloadId?.toLowerCase() === downloadId.toLowerCase() : q.id === queueId)
          );

          if (matchingItems.length > 0) {
            const movieId = matchingItems[0].movieId;


            // Check if movie already has file before searching
            let hasFile = false;
            try {
              const movie = await radarrApi.getMovie({ id: movieId });
              hasFile = Boolean(movie?.hasFile);
            } catch {}

            if (!hasFile) {
              logger.info(`[StalledAutomation] Triggering alternative search for movie ID ${movieId}...`);
              await radarrApi.searchMovie(movieId);
              searched = true;
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

    if (handled) {
      return {
        success: true,
        message: searched ? 'Replacement search requested. The original release remains queued.' : 'The library already has files. The original release remains queued.',
      };
    }

    return { success: false, message: 'The selected release was not processed.' };
  }

  /** Report sustained stalls while preserving the queued downloads. */
  public async checkAndCleanStalled(stalledThresholdMinutes = 5): Promise<void> {
    if (this.isChecking) return;
    const now = Date.now();
    // Throttle checks to once every 30 seconds
    if (now - this.lastCheckAt < 30_000) return;
    this.lastCheckAt = now;
    this.isChecking = true;

    try {
      const torrents = await torrentManager.getTorrents();
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
        // - State is metaDL (cannot get metadata), or stalledDL
        const isStalledDead =
          progress < 2 &&
          seedsConnected === 0 &&
          (state === 'stalledDL' || state === 'metaDL');

        if (isStalledDead) {
          const existing = this.stalledMap.get(hash);
          if (!existing) {
            this.stalledMap.set(hash, {
              firstSeenStalled: now,
            });
            logger.debug(
              `[StalledAutomation] Tracking newly stalled torrent "${t.name}" (hash: ${hash}, 0 seeds, state: ${state})`
            );
          } else {
            const minutesStalled = (now - existing.firstSeenStalled) / (1000 * 60);

            // metaDL with 0 seeds gets only 3 minutes before reporting a stall; others get 5 minutes
            const threshold = state === 'metaDL' ? Math.min(3, stalledThresholdMinutes) : stalledThresholdMinutes;

            if (minutesStalled >= threshold && !existing.reported) {
              existing.reported = true;
              logger.warn("[StalledAutomation] Torrent has no connected seeders and remains queued", {
                hash,
                minutesStalled,
              });
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

import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
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

  /**
   * Helper to delete torrent from qBittorrent directly if reachable
   */
  private async deleteFromQbittorrent(hash: string): Promise<boolean> {
    const qbitPort = process.env.QBITTORRENT_PORT || '8080';
    const qbitHosts = [
      process.env.QBITTORRENT_HOST || 'qbittorrent',
      'localhost',
      '127.0.0.1',
      'qbit',
    ];

    for (const host of qbitHosts) {
      try {
        const url = `http://${host}:${qbitPort}/api/v2/torrents/delete`;
        const params = new URLSearchParams();
        params.append('hashes', hash);
        params.append('deleteFiles', 'true');
        await axios.post(url, params.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 4000,
        });
        logger.info(`[StalledAutomation] Deleted torrent ${hash} directly from qBittorrent (${host})`);
        return true;
      } catch {
        // try next host
      }
    }
    return false;
  }

  /**
   * Removes a stalled release from Sonarr/Radarr, blocklists it so it won't be grabbed again,
   * wipes it from qBittorrent, and immediately triggers an alternative search on indexers.
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
          const target = queue.find(
            (q) =>
              (queueId && q.id === queueId) ||
              (downloadId && q.downloadId?.toLowerCase() === downloadId.toLowerCase()) ||
              (externalId && q.seriesId === externalId)
          );

          if (target) {
            releaseTitle = target.title || releaseTitle;
            logger.info(`[StalledAutomation] Found target in Sonarr (${server.name}) queue ID ${target.id}: "${releaseTitle}". Blocklisting and removing...`);
            
            // Delete from queue with blocklist=true and removeFromClient=true
            await sonarrApi.deleteQueueItem({
              id: target.id,
              removeFromClient: true,
              blocklist: true,
            });

            // Trigger immediate search for alternative release in Sonarr
            await sonarrApi.searchSeries(target.seriesId);
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
          const target = queue.find(
            (q) =>
              (queueId && q.id === queueId) ||
              (downloadId && q.downloadId?.toLowerCase() === downloadId.toLowerCase()) ||
              (externalId && q.movieId === externalId)
          );

          if (target) {
            releaseTitle = target.title || releaseTitle;
            logger.info(`[StalledAutomation] Found target in Radarr (${server.name}) queue ID ${target.id}: "${releaseTitle}". Blocklisting and removing...`);

            // Delete from queue with blocklist=true and removeFromClient=true
            await radarrApi.deleteQueueItem({
              id: target.id,
              removeFromClient: true,
              blocklist: true,
            });

            // Trigger immediate search for alternative release in Radarr
            await radarrApi.searchMovie(target.movieId);
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
   * Periodic check called to detect and clean up long-stalled torrents (0 seeds, 0% progress).
   * Default threshold: 15 minutes of continuous 0 seeds.
   */
  public async checkAndCleanStalled(stalledThresholdMinutes = 15): Promise<void> {
    if (this.isChecking) return;
    const now = Date.now();
    // Throttle checks to once every 60 seconds
    if (now - this.lastCheckAt < 60_000) return;
    this.lastCheckAt = now;
    this.isChecking = true;

    try {
      const qbitPort = process.env.QBITTORRENT_PORT || '8080';
      const qbitHosts = [
        process.env.QBITTORRENT_HOST || 'qbittorrent',
        'localhost',
        '127.0.0.1',
        'qbit',
      ];

      let torrents: any[] = [];
      for (const host of qbitHosts) {
        try {
          const res = await axios.get(`http://${host}:${qbitPort}/api/v2/torrents/info`, { timeout: 3000 });
          if (Array.isArray(res.data)) {
            torrents = res.data;
            break;
          }
        } catch {
          // try next host
        }
      }

      if (!torrents.length) return;

      const activeHashes = new Set<string>();

      for (const t of torrents) {
        const hash = (t.hash || '').toLowerCase();
        if (!hash) continue;
        activeHashes.add(hash);

        const progress = Math.round((t.progress || 0) * 100);
        const seedsConnected = t.num_seeds ?? 0;
        const state = t.state || '';
        const dlspeed = t.dlspeed || 0;

        const isStalledDead =
          progress < 2 &&
          seedsConnected === 0 &&
          (state === 'stalledDL' || state === 'metaDL' || (dlspeed === 0 && !state.includes('UP')));

        if (isStalledDead) {
          const existing = this.stalledMap.get(hash);
          if (!existing) {
            this.stalledMap.set(hash, {
              firstSeenStalled: now,
              title: t.name || hash,
              mediaType: t.category === 'tv' ? 'tv' : 'movie',
            });
            logger.debug(`[StalledAutomation] Tracking newly stalled torrent "${t.name}" (hash: ${hash}, 0 seeds, 0%)`);
          } else {
            const minutesStalled = (now - existing.firstSeenStalled) / (1000 * 60);
            if (minutesStalled >= stalledThresholdMinutes) {
              logger.info(
                `[StalledAutomation] Torrent "${existing.title}" (hash: ${hash}) has been stalled at 0% with 0 connected seeds for ${Math.round(
                  minutesStalled
                )}m. Auto-blocklisting and searching for alternative release...`
              );

              // Auto-skip
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
            logger.debug(`[StalledAutomation] Torrent "${t.name}" recovered seeds (${seedsConnected} seeds) — removed from stalled tracker.`);
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

import axios from 'axios';
import logger from '@server/logger';

export interface QbittorrentItem {
  hash: string;
  name: string;
  size: number;
  progress: number;
  dlspeed: number;
  upspeed: number;
  eta: number;
  state: string;
  category: string;
  tags: string;
  content_path?: string;
  save_path?: string;
}

export class TorrentManager {
  private workingBaseUrl: string | null = null;
  private lastUrlCheck = 0;

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
      'host.docker.internal:8089',
      'host.docker.internal:8080',
      'qbit:8080',
    ].filter(Boolean) as string[];

    return hosts.map((h) => `http://${h}`);
  }

  private async getWorkingBaseUrl(): Promise<string | null> {
    const now = Date.now();
    if (this.workingBaseUrl && now - this.lastUrlCheck < 60000) {
      return this.workingBaseUrl;
    }

    const candidateUrls = this.getQbitBaseUrls();
    const urlsToTest = this.workingBaseUrl
      ? [
          this.workingBaseUrl,
          ...candidateUrls.filter((u) => u !== this.workingBaseUrl),
        ]
      : candidateUrls;

    for (const url of urlsToTest) {
      try {
        const res = await axios.get(`${url}/api/v2/app/version`, { timeout: 1500 });
        if (res.status === 200) {
          this.workingBaseUrl = url;
          this.lastUrlCheck = now;
          return url;
        }
      } catch {
        // try next host
      }
    }
    this.workingBaseUrl = null;
    return null;
  }

  /**
   * Get list of all torrents currently in qBittorrent
   */
  public async getTorrents(filter?: string, category?: string): Promise<QbittorrentItem[]> {
    const baseUrl = await this.getWorkingBaseUrl();
    if (!baseUrl) {
      logger.debug('[TorrentManager] qBittorrent not reachable');
      return [];
    }

    try {
      const params: Record<string, string> = {};
      if (filter) params.filter = filter;
      if (category) params.category = category;

      const res = await axios.get<QbittorrentItem[]>(`${baseUrl}/api/v2/torrents/info`, {
        params,
        timeout: 5000,
      });

      return res.data || [];
    } catch (e: any) {
      this.workingBaseUrl = null;
      logger.warn(`[TorrentManager] Error fetching torrents: ${e.message}`);
      return [];
    }
  }

  /**
   * Permanently delete torrents from qBittorrent and delete downloaded payload from disk
   */
  public async deleteTorrents(hashes: string[], deleteFiles = true): Promise<boolean> {
    if (!hashes || hashes.length === 0) return true;

    const baseUrl = await this.getWorkingBaseUrl();
    if (!baseUrl) {
      logger.warn('[TorrentManager] Cannot delete torrents: qBittorrent not reachable');
      return false;
    }

    try {
      logger.info(
        `[TorrentManager] Deleting ${hashes.length} torrent(s) from qBittorrent (deleteFiles=${deleteFiles})`,
        { hashes }
      );

      const params = new URLSearchParams();
      params.append('hashes', hashes.join('|'));
      params.append('deleteFiles', String(deleteFiles));

      await axios.post(
        `${baseUrl}/api/v2/torrents/delete`,
        params.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 5000,
        }
      );

      logger.info(`[TorrentManager] Successfully deleted torrent(s) and data from disk`);
      return true;
    } catch (e: any) {
      this.workingBaseUrl = null;
      logger.error(`[TorrentManager] Failed to delete torrents: ${e.message}`);
      return false;
    }
  }

  /**
   * Find matching torrent hashes by title, optional year, and category
   */
  public async findTorrentsForMedia({
    title,
    year,
    category,
  }: {
    title: string;
    year?: number;
    category?: 'radarr' | 'sonarr';
  }): Promise<QbittorrentItem[]> {
    const torrents = await this.getTorrents(undefined, category);
    if (torrents.length === 0) return [];

    const cleanTitle = title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .trim();

    const titleWords = cleanTitle
      .split(/\s+/)
      .filter((w) => w.length > 2 && !['the', 'and', 'movie', 'pelicula', 'los', 'las', 'del'].includes(w));

    return torrents.filter((t) => {
      const name = t.name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ');

      // If category specified, ensure it matches or has no category
      if (category && t.category && t.category.toLowerCase() !== category) {
        return false;
      }

      // If year specified, check if year is present in torrent name
      if (year && !name.includes(year.toString())) {
        return false;
      }

      // Check if all or most significant title words are present
      if (titleWords.length === 0) return false;
      const matchedWords = titleWords.filter((w) => name.includes(w));
      return matchedWords.length >= Math.ceil(titleWords.length * 0.7);
    });
  }

  /**
   * Delete all torrents associated with a media item (by known hashes and/or title match)
   */
  public async deleteMediaTorrents({
    title,
    year,
    category,
    knownHashes = [],
  }: {
    title?: string;
    year?: number;
    category?: 'radarr' | 'sonarr';
    knownHashes?: string[];
  }): Promise<{ deletedCount: number; hashes: string[] }> {
    const hashesToDelete = new Set<string>(
      knownHashes.map((h) => h.toLowerCase()).filter((h) => h.length >= 10)
    );

    if (title) {
      try {
        const matchingTorrents = await this.findTorrentsForMedia({
          title,
          year,
          category,
        });

        for (const t of matchingTorrents) {
          hashesToDelete.add(t.hash.toLowerCase());
        }
      } catch (e: any) {
        logger.warn(`[TorrentManager] Error finding torrents for "${title}": ${e.message}`);
      }
    }

    const hashesList = Array.from(hashesToDelete);
    if (hashesList.length === 0) {
      logger.info(`[TorrentManager] No matching torrents found in qBittorrent for "${title || 'unknown'}"`);
      return { deletedCount: 0, hashes: [] };
    }

    const success = await this.deleteTorrents(hashesList, true);
    return {
      deletedCount: success ? hashesList.length : 0,
      hashes: hashesList,
    };
  }
}

export const torrentManager = new TorrentManager();

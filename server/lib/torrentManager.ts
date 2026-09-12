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
  private qbitHosts = ['qbittorrent', 'localhost', 'host.docker.internal'];
  private qbitPort = 8080;

  private async getWorkingBaseUrl(): Promise<string | null> {
    for (const host of this.qbitHosts) {
      try {
        const url = `http://${host}:${this.qbitPort}/api/v2/app/version`;
        const res = await axios.get(url, { timeout: 1500 });
        if (res.status === 200) {
          return `http://${host}:${this.qbitPort}`;
        }
      } catch {
        // try next host
      }
    }
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
      const hashesParam = hashes.join('|');
      logger.info(
        `[TorrentManager] Deleting ${hashes.length} torrent(s) from qBittorrent (deleteFiles=${deleteFiles})`,
        { hashes }
      );

      await axios.post(
        `${baseUrl}/api/v2/torrents/delete`,
        `hashes=${encodeURIComponent(hashesParam)}&deleteFiles=${deleteFiles}`,
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 5000,
        }
      );

      logger.info(`[TorrentManager] Successfully deleted torrent(s) and data from disk`);
      return true;
    } catch (e: any) {
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

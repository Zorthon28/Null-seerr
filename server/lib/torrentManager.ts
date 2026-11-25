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
  num_seeds?: number;
  state: string;
  category: string;
  tags: string;
  content_path?: string;
  save_path?: string;
}

export class TorrentManager {
  private workingBaseUrl: string | null = null;
  private lastUrlCheck = 0;
  private session?: Promise<string>;
  private readonly client = axios.create({ maxRedirects: 0 });

  private async login(baseUrl: string, username: string, password: string) {
    const response = await this.client.post<string>(
      baseUrl + '/api/v2/auth/login',
      new URLSearchParams({ username, password }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: baseUrl,
          Referer: baseUrl + '/',
        },
        timeout: 5000,
      }
    );
    const sid = response.headers['set-cookie']
      ?.map((cookie) => cookie.split(';', 1)[0])
      .find((cookie) => cookie.startsWith('SID=') && cookie.length > 4);
    if (response.data.trim() !== 'Ok.' || !sid) {
      throw new Error('qBittorrent rejected the configured credentials');
    }
    return sid;
  }

  private async request<T>(
    baseUrl: string,
    path: string,
    options: { params?: Record<string, string>; body?: string; timeout: number }
  ): Promise<T> {
    const { QBITTORRENT_USERNAME: username, QBITTORRENT_PASSWORD: password } = process.env;
    if (Boolean(username) !== Boolean(password)) {
      throw new Error('qBittorrent needs both a username and a password');
    }

    const session = username && password
      ? (this.session ??= this.login(baseUrl, username, password))
      : undefined;
    try {
      const cookie = await session;
      const response = await this.client.request<T>({
        url: baseUrl + '/api/v2/' + path,
        method: options.body ? 'POST' : 'GET',
        params: options.params,
        data: options.body,
        timeout: options.timeout,
        headers: {
          Origin: baseUrl,
          Referer: baseUrl + '/',
          ...(cookie ? { Cookie: cookie } : {}),
          ...(options.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
      });
      return response.data;
    } catch (error) {
      if (this.session === session) this.session = undefined;
      throw error;
    }
  }

  private getQbitBaseUrls(): string[] {
    const customHost = process.env.QBITTORRENT_HOST;
    const customPort = process.env.QBITTORRENT_PORT || '8080';
    if (process.env.QBITTORRENT_USERNAME || process.env.QBITTORRENT_PASSWORD) {
      // Only send credentials to an explicitly configured host.
      return customHost ? ['http://' + customHost + ':' + customPort] : [];
    }
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
        const version = await this.request<string>(url, 'app/version', { timeout: 1500 });
        if (typeof version === 'string' && /^v?\d+\./.test(version)) {
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

      const torrents = await this.request<QbittorrentItem[]>(baseUrl, 'torrents/info', {
        params,
        timeout: 5000,
      });

      return Array.isArray(torrents) ? torrents : [];
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

      await this.request(baseUrl, 'torrents/delete', {
        body: params.toString(),
        timeout: 5000,
      });

      logger.info('[TorrentManager] Successfully removed torrent entries');
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
    // Fetch all torrents without filtering on qBittorrent endpoint since user category names
    // vary (e.g. 'movies', 'radarr', 'tv', 'sonarr')
    const torrents = await this.getTorrents();
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

      // Check category compatibility:
      // radarr: matches 'movies', 'movie', 'radarr', or non-TV categories
      // sonarr: matches 'tv', 'series', 'sonarr', 'anime', or non-movie categories
      if (category && t.category) {
        const cat = t.category.toLowerCase().trim();
        const isMovieCategory = cat === 'radarr' || cat.startsWith('radarr') || cat === 'movies' || cat === 'movie';
        const isTvCategory = cat === 'sonarr' || cat.startsWith('sonarr') || cat === 'tv' || cat === 'series' || cat === 'anime';

        if (category === 'radarr' && isTvCategory && !isMovieCategory) {
          return false;
        }
        if (category === 'sonarr' && isMovieCategory && !isTvCategory) {
          return false;
        }
      }

      // If year specified, check if year (or year +/- 1 for release discrepancies) matches.
      // If the torrent has an explicit 4-digit year, it must match within 1 year.
      if (year) {
        const yearMatch =
          name.includes(year.toString()) ||
          name.includes((year - 1).toString()) ||
          name.includes((year + 1).toString());
        const extractedYears = name.match(/\b(19\d\d|20\d\d)\b/g);
        if (extractedYears && extractedYears.length > 0 && !yearMatch) {
          return false;
        }
      }

      // Check if all or most significant title words are present
      if (titleWords.length === 0) return false;
      const matchedWords = titleWords.filter((w) => name.includes(w));
      return matchedWords.length >= Math.ceil(titleWords.length * 0.7);
    });
  }

  /** Remove torrent entries identified by Arr download hashes while retaining payloads. */
  public async deleteMediaTorrents({
    title,
    knownHashes = [],
  }: {
    title?: string;
    year?: number;
    category?: 'radarr' | 'sonarr';
    knownHashes?: string[];
  }): Promise<{ deletedCount: number; hashes: string[] }> {
    const hashesToDelete = new Set(
      knownHashes
        .map((hash) => hash.toLowerCase())
        .filter((hash) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash))
    );
    const hashesList = hashesToDelete.size
      ? (await this.getTorrents())
          .map(({ hash }) => hash.toLowerCase())
          .filter((hash) => hashesToDelete.has(hash))
      : [];
    if (hashesList.length === 0) {
      logger.info(`[TorrentManager] No matching torrents found in qBittorrent for "${title || 'unknown'}"`);
      return { deletedCount: 0, hashes: [] };
    }

    const success = await this.deleteTorrents(hashesList, false);
    return {
      deletedCount: success ? hashesList.length : 0,
      hashes: hashesList,
    };
  }
}

export const torrentManager = new TorrentManager();

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import logger from '@server/logger';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import TheMovieDb from '@server/api/themoviedb';
import { streamDownloader } from '@server/lib/stream/streamDownloader';
import { appDataPath } from '@server/utils/appDataVolume';

export interface LeakAlert {
  id: string;
  title: string;
  mediaTitle: string;
  year?: number;
  leakType: 'workprint' | 'screener' | 'web-leak' | 'internal' | 'unconfirmed';
  confidence: 'high' | 'medium' | 'low';
  sourcePlatform: string;
  subreddit: string;
  redditUrl: string;
  description: string;
  detectedAt: string;
  matchedMedia?: {
    id: number;
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    title: string;
    posterPath?: string;
    status: number;
  };
}

class LeakRadarService {
  private historyFile = path.join(appDataPath(), 'leakHistory.json');
  private fallbackHistoryFile = path.join(__dirname, 'leakHistory.json');
  private alerts: Map<string, LeakAlert> = new Map();
  private isScanning = false;

  constructor() {
    this.loadHistory();
  }

  public extractYear(title: string): number | undefined {
    const match = title.match(/\b(19\d\d|20\d\d)\b/);
    return match ? parseInt(match[1], 10) : undefined;
  }

  private loadHistory() {
    try {
      const currentYear = new Date().getFullYear();

      const targetPath = fs.existsSync(this.historyFile)
        ? this.historyFile
        : fs.existsSync(this.fallbackHistoryFile)
        ? this.fallbackHistoryFile
        : null;

      if (targetPath) {
        const raw = fs.readFileSync(targetPath, 'utf-8');
        const list: LeakAlert[] = JSON.parse(raw);
        for (const a of list) {
          const y = a.year || this.extractYear(a.title + ' ' + a.mediaTitle);
          // Strictly only leaks from the current year onwards (e.g. 2026+)
          if (!y || y < currentYear) {
            continue;
          }
          this.alerts.set(a.id, a);
        }
      }
    } catch (e: any) {
      logger.warn(`[LeakRadar] Failed to load leak history: ${e.message}`);
    }
  }

  private saveHistory() {
    try {
      const list = Array.from(this.alerts.values()).sort(
        (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
      );
      fs.writeFileSync(this.historyFile, JSON.stringify(list.slice(0, 100), null, 2));
    } catch (e: any) {
      logger.warn(`[LeakRadar] Failed to save leak history: ${e.message}`);
    }
  }

  public getAlerts(): LeakAlert[] {
    return Array.from(this.alerts.values()).sort(
      (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
    );
  }

  public dismissAlert(id: string): boolean {
    if (this.alerts.has(id)) {
      this.alerts.delete(id);
      this.saveHistory();
      return true;
    }
    return false;
  }

  public async scan(): Promise<{ newAlertsCount: number; alerts: LeakAlert[] }> {
    if (this.isScanning) {
      return { newAlertsCount: 0, alerts: this.getAlerts() };
    }

    this.isScanning = true;
    logger.info('[LeakRadar] Starting multi-source leak radar scan (Prowlarr Swarm + Scene PreDB + Web)...', { label: 'LeakRadar' });

    let newCount = 0;

    try {
      let monitoredMedia: Media[] = [];
      try {
        const mediaRepo = getRepository(Media);
        monitoredMedia = await mediaRepo.find({ take: 200 });
      } catch (dbErr: any) {
        logger.debug(`[LeakRadar] DB not ready for media lookup: ${dbErr.message}`);
      }

      const currentYear = new Date().getFullYear();
      const tmdb = new TheMovieDb();

      // TARGETED SEARCH: Check srrdb & indexers for user's pending/in-cinemas media FROM THIS YEAR (2026+)
      const pendingMedia = monitoredMedia.filter((m) => m.status !== 5); // 5 = AVAILABLE
      for (const m of pendingMedia.slice(0, 20)) {
        try {
          let mediaTitle = '';
          let imdbId: string | undefined;
          let posterPath: string | undefined;
          let releaseYear: number | undefined;

          if (m.mediaType === 'movie') {
            const details = await tmdb.getMovie({ movieId: m.tmdbId });
            mediaTitle = details.title;
            imdbId = details.imdb_id;
            posterPath = details.poster_path;
            if (details.release_date) {
              releaseYear = new Date(details.release_date).getFullYear();
            }
          } else {
            const details = await tmdb.getTvShow({ tvId: m.tmdbId });
            mediaTitle = details.name;
            posterPath = details.poster_path;
            if (details.first_air_date) {
              releaseYear = new Date(details.first_air_date).getFullYear();
            }
          }

          if (!mediaTitle) continue;

          // STRICTLY ONLY MOVIES/SERIES FROM THIS YEAR (2026+)
          if (!releaseYear || releaseYear < currentYear) {
            continue;
          }

          // Deduplicate: if an alert already exists for this library media, skip
          const alreadyHasAlert = Array.from(this.alerts.values()).some(
            (a) => a.matchedMedia?.id === m.id
          );
          if (alreadyHasAlert) continue;

          // Check srrdb by IMDb ID or Title for scene releases of pending media
          const srrQuery = imdbId ? `imdb:${imdbId}` : encodeURIComponent(mediaTitle);
          try {
            const srrCheck = await axios.get(`https://www.srrdb.com/api/search/${srrQuery}`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
              timeout: 6000,
            });
            const srrMatches = srrCheck.data?.results || [];
            for (const item of srrMatches.slice(0, 2)) {
              const relName = item.release;
              if (!relName) continue;
              const alertId = `srrdb_targeted_${relName}`;
              if (this.alerts.has(alertId)) continue;

              const isWorkprint = /\b(workprint|wp)\b/i.test(relName);
              const isScreener = /\b(screener|scr)\b/i.test(relName);
              const leakType: LeakAlert['leakType'] = isWorkprint
                ? 'workprint'
                : isScreener
                ? 'screener'
                : 'web-leak';

              const alert: LeakAlert = {
                id: alertId,
                title: relName,
                mediaTitle,
                year: releaseYear,
                leakType,
                confidence: 'high',
                sourcePlatform: 'The Scene (PreDB)',
                subreddit: 'Scene',
                redditUrl: `https://www.srrdb.com/release/details/${relName}`,
                description: `¡Lanzamiento detectado en The Scene para título solicitado en biblioteca! Certificado por srrdb/PreDB.`,
                detectedAt: item.date ? new Date(item.date).toISOString() : new Date().toISOString(),
                matchedMedia: {
                  id: m.id,
                  tmdbId: m.tmdbId,
                  mediaType: m.mediaType,
                  title: mediaTitle,
                  posterPath,
                  status: m.status,
                },
              };

              this.alerts.set(alertId, alert);
              newCount++;
              logger.info(`[LeakRadar] 🚨 Targeted Scene leak found for library: "${mediaTitle}" (${relName})`, { label: 'LeakRadar' });
              break; // One primary alert per library item is enough
            }
          } catch {
            // Ignore srrdb timeout
          }
        } catch {
          // Ignore individual media lookup error
        }
      }

      // SOURCE 1: Direct Prowlarr Indexer Swarm for active workprints / screeners
      try {
        const prowlarrKey = '2093032a323244b4987f33f5387fcee5';
        const queries = ['workprint', 'screener'];

        for (const q of queries) {
          const pResp = await axios.get(
            `http://localhost:9696/api/v1/search?query=${q}&type=search&limit=35`,
            {
              headers: { 'X-Api-Key': prowlarrKey },
              timeout: 15000,
            }
          );

          const results = pResp.data || [];
          for (const item of results) {
            const rawTitle: string = item.title || '';
            if (!rawTitle) continue;

            const leakSignals = /\b(workprint|screener|wp|scr)\b/i;
            if (!leakSignals.test(rawTitle)) continue;

            const detectedYear = this.extractYear(rawTitle);

            const leakType: LeakAlert['leakType'] = /workprint|wp/i.test(rawTitle)
              ? 'workprint'
              : 'screener';

            const alertId = `prowlarr_${item.infoHash || item.guid || rawTitle.replace(/\s+/g, '_')}`;
            if (this.alerts.has(alertId)) continue;

            const cleanMediaTitle = rawTitle
              .replace(/\[.*?\]|\(.*?\)/g, '')
              .replace(/\b(workprint|screener|1080p|720p|480p|x264|x265|hevc|web-?dl|dvdscr|bjn|dks|collective|proper|hc|director cut|dual|v2)\b/gi, '')
              .replace(/[:\.\-_]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();

            let matched: LeakAlert['matchedMedia'] | undefined = undefined;
            for (const m of monitoredMedia) {
              let titleMatch = false;
              let tmdbTitle = '';
              let posterPath: string | undefined = undefined;

              try {
                if (m.mediaType === 'movie') {
                  const movieDetails = await tmdb.getMovie({ movieId: m.tmdbId });
                  tmdbTitle = movieDetails.title;
                  posterPath = movieDetails.poster_path;
                } else {
                  const tvDetails = await tmdb.getTvShow({ tvId: m.tmdbId });
                  tmdbTitle = tvDetails.name;
                  posterPath = tvDetails.poster_path;
                }

                if (
                  tmdbTitle &&
                  (cleanMediaTitle.toLowerCase().includes(tmdbTitle.toLowerCase()) ||
                   tmdbTitle.toLowerCase().includes(cleanMediaTitle.toLowerCase()))
                ) {
                  titleMatch = true;
                }
              } catch {
                // Ignore TMDB fail
              }

              if (titleMatch) {
                matched = {
                  id: m.id,
                  tmdbId: m.tmdbId,
                  mediaType: m.mediaType,
                  title: tmdbTitle || cleanMediaTitle,
                  posterPath,
                  status: m.status,
                };
                break;
              }
            }

            // FILTER: STRICTLY CURRENT YEAR (2026+)
            if (!detectedYear || detectedYear < currentYear) {
              continue;
            }

            const alert: LeakAlert = {
              id: alertId,
              title: rawTitle,
              mediaTitle: matched ? matched.title : cleanMediaTitle,
              year: detectedYear,
              leakType,
              confidence: 'high',
              sourcePlatform: `${item.indexer || 'Tracker'} (Torrent)`,
              subreddit: item.indexer || 'Torrent Swarm',
              redditUrl: item.infoUrl || item.commentUrl || 'http://localhost:9696',
              description: `Disponible para descarga en el swarm de ${item.indexer || 'indexadores'} con ${item.seeders ?? '?'} semillas. Tamaño: ${(item.size / (1024 * 1024 * 1024)).toFixed(2)} GB.`,
              detectedAt: item.publishDate || new Date().toISOString(),
              matchedMedia: matched,
            };

            this.alerts.set(alertId, alert);
            newCount++;
            logger.info(`[LeakRadar] 🚨 New modern leak in Prowlarr: "${alert.mediaTitle}" (${detectedYear || 'Library'}) [${leakType}]`, { label: 'LeakRadar' });
          }
        }
      } catch (prowlarrErr: any) {
        logger.warn(`[LeakRadar] Prowlarr scan error: ${prowlarrErr.message}`);
      }

      // SOURCE 2: Global Scene PreDB / srrdb API for modern leaks
      try {
        const srrResp = await axios.get(
          'https://www.srrdb.com/api/search/workprint/order:desc',
          {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 10000,
          }
        );

        const srrList = srrResp.data?.results || [];
        for (const item of srrList.slice(0, 25)) {
          const relName: string = item.release || '';
          if (!relName) continue;

          const detectedYear = this.extractYear(relName);

          const alertId = `srrdb_${relName}`;
          if (this.alerts.has(alertId)) continue;

          const cleanMediaTitle = relName
            .replace(/\[.*?\]|\(.*?\)/g, '')
            .replace(/\b(workprint|screener|1080p|720p|x264|x265|dvdscr|proper)\b/gi, '')
            .replace(/[:\.\-_]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          let matched: LeakAlert['matchedMedia'] | undefined = undefined;
          for (const m of monitoredMedia) {
            try {
              let tmdbTitle = '';
              let posterPath: string | undefined;
              if (m.mediaType === 'movie') {
                const movieDetails = await tmdb.getMovie({ movieId: m.tmdbId });
                tmdbTitle = movieDetails.title;
                posterPath = movieDetails.poster_path;
              } else {
                const tvDetails = await tmdb.getTvShow({ tvId: m.tmdbId });
                tmdbTitle = tvDetails.name;
                posterPath = tvDetails.poster_path;
              }

              if (
                tmdbTitle &&
                (cleanMediaTitle.toLowerCase().includes(tmdbTitle.toLowerCase()) ||
                 tmdbTitle.toLowerCase().includes(cleanMediaTitle.toLowerCase()))
              ) {
                matched = {
                  id: m.id,
                  tmdbId: m.tmdbId,
                  mediaType: m.mediaType,
                  title: tmdbTitle,
                  posterPath,
                  status: m.status,
                };
                break;
              }
            } catch {
              // Ignore
            }
          }

          // STRICT FILTER: Strictly require year >= currentYear (2026+)
          if (!detectedYear || detectedYear < currentYear) {
            continue;
          }

          const alert: LeakAlert = {
            id: alertId,
            title: relName,
            mediaTitle: matched ? matched.title : cleanMediaTitle,
            year: detectedYear,
            leakType: 'workprint',
            confidence: 'high',
            sourcePlatform: 'The Scene (PreDB)',
            subreddit: 'Scene',
            redditUrl: `https://www.srrdb.com/release/details/${relName}`,
            description: `Lanzamiento interno certificado en bases de datos de The Scene (srrdb / predb).`,
            detectedAt: item.date ? new Date(item.date).toISOString() : new Date().toISOString(),
            matchedMedia: matched,
          };

          this.alerts.set(alertId, alert);
          newCount++;
        }
      } catch (srrErr: any) {
        logger.warn(`[LeakRadar] srrdb scan error: ${srrErr.message}`);
      }

      // SOURCE 3: Reddit RSS with fallback
      try {
        const subreddits = ['Piracy', 'AnimePiracy', 'leaks'];
        for (const sub of subreddits) {
          try {
            const resp = await axios.get(`https://www.reddit.com/r/${sub}/search.json?q=leak+OR+workprint&sort=new&limit=15&restrict_sr=on`, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
              },
              timeout: 8000,
            });

            const posts = resp.data?.data?.children || [];
            for (const p of posts) {
              const post = p.data;
              if (!post || !post.title) continue;

              const alertId = `reddit_${post.id}`;
              if (this.alerts.has(alertId)) continue;

              const alert: LeakAlert = {
                id: alertId,
                title: post.title,
                mediaTitle: post.title.replace(/\[.*?\]/g, '').substring(0, 40).trim(),
                leakType: 'unconfirmed',
                confidence: 'medium',
                sourcePlatform: 'Reddit Community',
                subreddit: sub,
                redditUrl: `https://reddit.com${post.permalink}`,
                description: post.selftext?.substring(0, 250) || post.title,
                detectedAt: new Date(post.created_utc * 1000).toISOString(),
              };

              this.alerts.set(alertId, alert);
              newCount++;
            }
          } catch {
            // Reddit rate limit/blocks fail gracefully to sources 1 & 2
          }
        }
      } catch {
        // Ignore
      }

      this.saveHistory();
    } catch (e: any) {
      logger.error(`[LeakRadar] Scan error: ${e.message}`, { label: 'LeakRadar' });
    } finally {
      this.isScanning = false;
    }

    return { newAlertsCount: newCount, alerts: this.getAlerts() };
  }

  public async ingestLeak(options: {
    title: string;
    year?: number;
    tmdbId?: number;
    downloadUrl: string;
    mediaType?: 'movie' | 'tv';
  }): Promise<{ success: boolean; message: string }> {
    try {
      const { title, year, tmdbId, downloadUrl } = options;
      logger.info(`[LeakRadar] Ingesting leak download for "${title}": ${downloadUrl}`);

      if (downloadUrl.startsWith('magnet:')) {
        const qbUrl = 'http://localhost:8089/api/v2/torrents/add';
        const params = new URLSearchParams();
        params.append('urls', downloadUrl);
        params.append('category', options.mediaType === 'tv' ? 'tv' : 'movies');
        params.append('autoTMM', 'true');

        await axios.post(qbUrl, params.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          auth: { username: 'admin', password: 'PAssw0rd2026!' },
        });

        return { success: true, message: `Magnet añadido exitosamente a qBittorrent para "${title}".` };
      } else {
        const finalTmdbId = tmdbId || Math.floor(Math.random() * 900000 + 100000);
        await streamDownloader.startDownload({
          tmdbId: finalTmdbId,
          title,
          year,
          streamUrl: downloadUrl,
        });

        return { success: true, message: `Descarga directa de filtración iniciada para "${title}".` };
      }
    } catch (e: any) {
      logger.error(`[LeakRadar] Ingest error: ${e.message}`);
      return { success: false, message: `Error al procesar la descarga: ${e.message}` };
    }
  }
}

export const leakRadarService = new LeakRadarService();

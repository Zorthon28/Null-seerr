import axios from 'axios';
import fs from 'fs';
import path from 'path';
import logger from '@server/logger';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import TheMovieDb from '@server/api/themoviedb';
import { streamDownloader } from '@server/lib/stream/streamDownloader';

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
  private historyFile = path.join(__dirname, 'leakHistory.json');
  private alerts: Map<string, LeakAlert> = new Map();
  private isScanning = false;

  constructor() {
    this.loadHistory();
  }

  private loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const raw = fs.readFileSync(this.historyFile, 'utf-8');
        const list: LeakAlert[] = JSON.parse(raw);
        for (const a of list) {
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

      // SOURCE 1: Direct Prowlarr Indexer Swarm for active workprints / screeners
      try {
        const prowlarrKey = '2093032a323244b4987f33f5387fcee5';
        const queries = ['workprint', 'screener'];

        for (const q of queries) {
          const pResp = await axios.get(
            `http://localhost:9696/api/v1/search?query=${q}&type=search&limit=25`,
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

            const leakType: LeakAlert['leakType'] = /workprint|wp/i.test(rawTitle)
              ? 'workprint'
              : 'screener';

            const alertId = `prowlarr_${item.infoHash || item.guid || rawTitle.replace(/\s+/g, '_')}`;
            if (this.alerts.has(alertId)) continue;

            const cleanMediaTitle = rawTitle
              .replace(/\[.*?\]|\(.*?\)/g, '')
              .replace(/\b(workprint|screener|1080p|720p|x264|x265|hevc|web-?dl|dvdscr|bjn|dks|collective|proper)\b/gi, '')
              .replace(/[:\.\-_]/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();

            let matched: LeakAlert['matchedMedia'] | undefined = undefined;
            for (const m of monitoredMedia) {
              const tmdb = new TheMovieDb();
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

            const alert: LeakAlert = {
              id: alertId,
              title: rawTitle,
              mediaTitle: matched ? matched.title : cleanMediaTitle,
              leakType,
              confidence: 'high',
              sourcePlatform: `${item.indexer || 'Tracker'} (Torrent)`,
              subreddit: 'Trackers / Scene',
              redditUrl: item.infoUrl || item.commentUrl || 'http://localhost:9696',
              description: `Disponible para descarga en el swarm de ${item.indexer || 'indexadores'} con ${item.seeders ?? '?'} semillas. Tamaño: ${(item.size / (1024 * 1024 * 1024)).toFixed(2)} GB.`,
              detectedAt: item.publishDate || new Date().toISOString(),
              matchedMedia: matched,
            };

            this.alerts.set(alertId, alert);
            newCount++;
            logger.info(`[LeakRadar] 🚨 New leak detected in Prowlarr: "${alert.mediaTitle}" (${leakType})`, { label: 'LeakRadar' });
          }
        }
      } catch (prowlarrErr: any) {
        logger.warn(`[LeakRadar] Prowlarr scan error: ${prowlarrErr.message}`);
      }

      // SOURCE 2: Scene PreDB / srrdb API for unreleased Scene leaks
      try {
        const srrResp = await axios.get(
          'https://www.srrdb.com/api/search/workprint/order:desc',
          {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 10000,
          }
        );

        const srrList = srrResp.data?.results || [];
        for (const item of srrList.slice(0, 15)) {
          const relName: string = item.release || '';
          if (!relName) continue;

          const alertId = `srrdb_${relName}`;
          if (this.alerts.has(alertId)) continue;

          const cleanMediaTitle = relName
            .replace(/\[.*?\]|\(.*?\)/g, '')
            .replace(/\b(workprint|screener|1080p|720p|x264|x265|dvdscr|proper)\b/gi, '')
            .replace(/[:\.\-_]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

          const alert: LeakAlert = {
            id: alertId,
            title: relName,
            mediaTitle: cleanMediaTitle,
            leakType: 'workprint',
            confidence: 'high',
            sourcePlatform: 'The Scene (PreDB)',
            subreddit: 'Scene',
            redditUrl: `https://www.srrdb.com/release/details/${relName}`,
            description: `Lanzamiento interno certificado en bases de datos de The Scene (srrdb / predb).`,
            detectedAt: item.date ? new Date(item.date).toISOString() : new Date().toISOString(),
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

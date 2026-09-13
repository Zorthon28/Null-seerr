import axios from 'axios';
import fs from 'fs';
import path from 'path';
import logger from '@server/logger';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import TheMovieDb from '@server/api/themoviedb';
import { streamDownloader } from '@server/lib/stream/streamDownloader';
import { appDataPath } from '@server/utils/appDataVolume';
import { getSettings } from '@server/lib/settings';
import RadarrAPI from '@server/api/servarr/radarr';
import { inspectLeak, LeakMediaInspection } from './leakInspector';
import { LeakNotifier } from './leakNotifier';

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
  downloadUrl?: string;
  description: string;
  detectedAt: string;
  autoDownloaded?: boolean;
  inspection?: LeakMediaInspection;
  matchedMedia?: {
    id: number;
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    title: string;
    posterPath?: string;
    status: number;
  };
}

export interface LeakRadarSettings {
  autoDownloadLibraryLeaks: boolean;
  minQualityGrade: 'A' | 'B' | 'C';
  notifyOnDiscord: boolean;
  notifyOnTelegram: boolean;
}


const isDocker = fs.existsSync('/.dockerenv') || fs.existsSync('/app/config/DOCKER');
const getProwlarrBaseUrl = () =>
  process.env.PROWLARR_URL || (isDocker ? 'http://prowlarr:9696' : '');
const getQbittorrentBaseUrl = () =>
  process.env.QBITTORRENT_URL || (isDocker ? 'http://qbittorrent:8080' : '');

class LeakRadarService {
  private historyFile = path.join(appDataPath(), 'leakHistory.json');
  private fallbackHistoryFile = path.join(__dirname, 'leakHistory.json');
  private settingsFile = path.join(appDataPath(), 'leakSettings.json');
  private alerts: Map<string, LeakAlert> = new Map();
  private isScanning = false;
  private settings: LeakRadarSettings = {
    autoDownloadLibraryLeaks: false,
    minQualityGrade: 'B',
    notifyOnDiscord: true,
    notifyOnTelegram: true,
  };

  constructor() {
    this.loadSettings();
    this.loadHistory();
  }

  public getSettings(): LeakRadarSettings {
    return this.settings;
  }

  public updateSettings(newSettings: Partial<LeakRadarSettings>): LeakRadarSettings {
    this.settings = { ...this.settings, ...newSettings };
    try {
      fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2));
      logger.info('[LeakRadar] Settings updated successfully', { label: 'LeakRadar' });
    } catch (e: any) {
      logger.warn(`[LeakRadar] Failed to save settings: ${e.message}`);
    }
    return this.settings;
  }

  private loadSettings() {
    try {
      if (fs.existsSync(this.settingsFile)) {
        const raw = fs.readFileSync(this.settingsFile, 'utf-8');
        this.settings = { ...this.settings, ...JSON.parse(raw) };
      }
    } catch (e: any) {
      logger.warn(`[LeakRadar] Failed to load settings: ${e.message}`);
    }
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
          if (!y || y < currentYear) {
            continue;
          }
          if (!a.inspection) {
            a.inspection = inspectLeak(a.title, a.description);
          }
          const cleanId = a.id.replace(/[^a-zA-Z0-9_-]/g, '_');
          a.id = cleanId;
          this.alerts.set(cleanId, a);
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
    const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    for (const [key] of this.alerts.entries()) {
      if (key === id || key.replace(/[^a-zA-Z0-9_-]/g, '_') === sanitized) {
        this.alerts.delete(key);
        this.saveHistory();
        return true;
      }
    }
    return false;
  }

  public async scan(): Promise<{ newAlertsCount: number; alerts: LeakAlert[] }> {
    if (this.isScanning) {
      return { newAlertsCount: 0, alerts: this.getAlerts() };
    }

    this.isScanning = true;
    logger.info('[LeakRadar] Starting high-precision leak radar scan...', { label: 'LeakRadar' });

    let newCount = 0;
    const currentYear = new Date().getFullYear();

    try {
      let monitoredMedia: Media[] = [];
      try {
        const mediaRepo = getRepository(Media);
        monitoredMedia = await mediaRepo.find({ take: 200 });
      } catch (dbErr: any) {
        logger.debug(`[LeakRadar] DB not ready for media lookup: ${dbErr.message}`);
      }

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

              const inspection = inspectLeak(relName, 'Lanzamiento interno certificado en bases de datos de The Scene (srrdb / predb).');

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
                inspection,
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

              // Send Notification if enabled
              LeakNotifier.sendNotification(alert);

              // Auto-Resolve torrent via Prowlarr and Auto-Download if enabled
              if (this.settings.autoDownloadLibraryLeaks && inspection.qualityGrade !== 'D' && !inspection.watermark.detected) {
                this.resolveAndAutoGrab(alert, m);
              }

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
            `${getProwlarrBaseUrl()}/api/v1/search?query=${q}&type=search&limit=35`,
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

            const cleanKey = (item.infoHash || item.guid || rawTitle).replace(/[^a-zA-Z0-9_-]/g, '_');
            const alertId = `prowlarr_${cleanKey}`;
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

            const downloadUrl = (item.infoHash ? `magnet:?xt=urn:btih:${item.infoHash}&dn=${encodeURIComponent(rawTitle)}` : undefined) || item.magnetUrl || item.downloadUrl;
            const inspection = inspectLeak(rawTitle);

            const alert: LeakAlert = {
              id: alertId,
              title: rawTitle,
              mediaTitle: matched ? matched.title : cleanMediaTitle,
              year: detectedYear,
              leakType,
              confidence: 'high',
              sourcePlatform: `${item.indexer || 'Tracker'} (Torrent)`,
              subreddit: item.indexer || 'Torrent Swarm',
              redditUrl: item.infoUrl || item.commentUrl || '',
              downloadUrl,
              description: `Disponible para descarga en el swarm de ${item.indexer || 'indexadores'} con ${item.seeders ?? '?'} semillas. Tamaño: ${(item.size / (1024 * 1024 * 1024)).toFixed(2)} GB.`,
              detectedAt: item.publishDate || new Date().toISOString(),
              inspection,
              matchedMedia: matched,
            };

            this.alerts.set(alertId, alert);
            newCount++;
            logger.info(`[LeakRadar] 🚨 New modern leak in Prowlarr: "${alert.mediaTitle}" (${detectedYear || 'Library'}) [${leakType}]`, { label: 'LeakRadar' });

            // Notification & Auto-download check
            if (matched) {
              LeakNotifier.sendNotification(alert);

              if (this.settings.autoDownloadLibraryLeaks && downloadUrl && inspection.qualityGrade !== 'D' && !inspection.watermark.detected) {
                this.ingestLeak({
                  title: alert.mediaTitle,
                  year: alert.year,
                  tmdbId: matched.tmdbId,
                  downloadUrl,
                  mediaType: matched.mediaType,
                }).then((res) => {
                  if (res.success) {
                    alert.autoDownloaded = true;
                    this.saveHistory();
                  }
                });
              }
            }
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

          const inspection = inspectLeak(relName, 'Lanzamiento interno certificado en bases de datos de The Scene (srrdb / predb).');

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
            inspection,
            matchedMedia: matched,
          };

          this.alerts.set(alertId, alert);
          newCount++;
        }
      } catch (srrErr: any) {
        logger.warn(`[LeakRadar] srrdb scan error: ${srrErr.message}`);
      }

      this.saveHistory();
    } catch (e: any) {
      logger.error(`[LeakRadar] Scan error: ${e.message}`, { label: 'LeakRadar' });
    } finally {
      this.isScanning = false;
    }

    return { newAlertsCount: newCount, alerts: this.getAlerts() };
  }

  // Resolves a Scene PreDB release to a live Prowlarr swarm torrent and auto-downloads
  private async resolveAndAutoGrab(alert: LeakAlert, media: Media) {
    try {
      const prowlarrKey = '2093032a323244b4987f33f5387fcee5';
      const cleanSearch = alert.title.replace(/[._-]/g, ' ');
      const pResp = await axios.get(
        `${getProwlarrBaseUrl()}/api/v1/search?query=${encodeURIComponent(cleanSearch)}&type=search&limit=5`,
        {
          headers: { 'X-Api-Key': prowlarrKey },
          timeout: 10000,
        }
      );

      const items = pResp.data || [];
      if (items.length > 0) {
        const top = items[0];
        const dlUrl = top.magnetUrl || top.downloadUrl || (top.infoHash ? `magnet:?xt=urn:btih:${top.infoHash}&dn=${encodeURIComponent(top.title)}` : undefined);
        if (dlUrl) {
          alert.downloadUrl = dlUrl;
          const ingestRes = await this.ingestLeak({
            title: alert.mediaTitle,
            year: alert.year,
            tmdbId: media.tmdbId,
            downloadUrl: dlUrl,
            mediaType: media.mediaType,
          });
          if (ingestRes.success) {
            alert.autoDownloaded = true;
            this.saveHistory();
            logger.info(`[LeakRadar] 🤖 Auto-downloaded Scene leak for "${alert.mediaTitle}" via Prowlarr!`);
          }
        }
      }
    } catch (e: any) {
      logger.warn(`[LeakRadar] Failed to resolve Scene leak to Prowlarr: ${e.message}`);
    }
  }

  // 1-Click Grab: executes immediate download for a given alert id
  public async grabLeak(alertId: string): Promise<{ success: boolean; message: string }> {
    let alert = this.alerts.get(alertId);
    if (!alert) {
      const sanitized = alertId.replace(/[^a-zA-Z0-9_-]/g, '_');
      alert =
        this.alerts.get(sanitized) ||
        Array.from(this.alerts.values()).find(
          (a) =>
            a.id === alertId ||
            a.id.replace(/[^a-zA-Z0-9_-]/g, '_') === sanitized
        );
    }
    if (!alert) {
      return { success: false, message: 'Alerta no encontrada.' };
    }

    // If downloadUrl is present, directly ingest
    if (alert.downloadUrl) {
      const ingestRes = await this.ingestLeak({
        title: alert.mediaTitle,
        year: alert.year,
        tmdbId: alert.matchedMedia?.tmdbId,
        downloadUrl: alert.downloadUrl,
        mediaType: alert.matchedMedia?.mediaType || 'movie',
      });
      if (ingestRes.success) {
        alert.autoDownloaded = true;
        this.saveHistory();
      }
      return ingestRes;
    }

    // If it's a Scene PreDB alert or missing magnet, search Prowlarr
    try {
      const prowlarrKey = '2093032a323244b4987f33f5387fcee5';
      const cleanSearch = (alert.mediaTitle || alert.title).replace(/[._-]/g, ' ');
      const pResp = await axios.get(
        `${getProwlarrBaseUrl()}/api/v1/search?query=${encodeURIComponent(cleanSearch)}&type=search&limit=5`,
        {
          headers: { 'X-Api-Key': prowlarrKey },
          timeout: 10000,
        }
      );

      const items = pResp.data || [];
      if (items.length > 0) {
        const top = items[0];
        const dlUrl =
          (top.infoHash
            ? `magnet:?xt=urn:btih:${top.infoHash}&dn=${encodeURIComponent(
                top.title || alert.title
              )}`
            : undefined) ||
          top.magnetUrl ||
          top.downloadUrl;
        if (dlUrl) {
          alert.downloadUrl = dlUrl;
          const ingestRes = await this.ingestLeak({
            title: alert.mediaTitle,
            year: alert.year,
            tmdbId: alert.matchedMedia?.tmdbId,
            downloadUrl: dlUrl,
            mediaType: alert.matchedMedia?.mediaType || 'movie',
          });
          if (ingestRes.success) {
            alert.autoDownloaded = true;
            this.saveHistory();
          }
          return ingestRes;
        }
      }

      return {
        success: false,
        message:
          'No se encontró un torrent activo en tus indexadores de Prowlarr para este lanzamiento de The Scene.',
      };
    } catch (e: any) {
      return { success: false, message: `Error al buscar en Prowlarr: ${e.message}` };
    }
  }

  // Feature 6: On-Demand Live Leak Search
  public async searchOnDemand(query: string): Promise<{
    query: string;
    sceneResults: any[];
    prowlarrResults: any[];
    redditResults: any[];
  }> {
    const cleanQ = query.trim();
    if (!cleanQ) {
      return { query, sceneResults: [], prowlarrResults: [], redditResults: [] };
    }

    logger.info(`[LeakRadar] Performing live on-demand leak search for: "${cleanQ}"`);

    const prowlarrKey = '2093032a323244b4987f33f5387fcee5';

    const [sceneRes, prowlarrRes, redditRes] = await Promise.allSettled([
      // 1. srrdb
      axios.get(`https://www.srrdb.com/api/search/${encodeURIComponent(cleanQ)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 6000,
      }),
      // 2. Prowlarr
      axios.get(`${getProwlarrBaseUrl()}/api/v1/search?query=${encodeURIComponent(cleanQ)}&type=search&limit=15`, {
        headers: { 'X-Api-Key': prowlarrKey },
        timeout: 10000,
      }),
      // 3. Reddit
      axios.get(`https://www.reddit.com/r/Piracy/search.json?q=${encodeURIComponent(cleanQ + ' leak')}&sort=new&limit=10`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        timeout: 6000,
      }),
    ]);

    const sceneResults: any[] = [];
    if (sceneRes.status === 'fulfilled') {
      for (const item of (sceneRes.value.data?.results || []).slice(0, 10)) {
        const rel = item.release || '';
        sceneResults.push({
          release: rel,
          date: item.date,
          inspection: inspectLeak(rel),
          url: `https://www.srrdb.com/release/details/${rel}`,
        });
      }
    }

    const prowlarrResults: any[] = [];
    if (prowlarrRes.status === 'fulfilled') {
      for (const item of (prowlarrRes.value.data || []).slice(0, 10)) {
        const title = item.title || '';
        const dlUrl = item.magnetUrl || item.downloadUrl || (item.infoHash ? `magnet:?xt=urn:btih:${item.infoHash}&dn=${encodeURIComponent(title)}` : undefined);
        prowlarrResults.push({
          title,
          indexer: item.indexer,
          size: item.size,
          seeders: item.seeders,
          downloadUrl: dlUrl,
          inspection: inspectLeak(title),
          infoUrl: item.infoUrl || item.commentUrl,
        });
      }
    }

    const redditResults: any[] = [];
    if (redditRes.status === 'fulfilled') {
      const posts = redditRes.value.data?.data?.children || [];
      for (const p of posts) {
        const post = p.data;
        if (!post?.title) continue;
        redditResults.push({
          title: post.title,
          subreddit: post.subreddit,
          url: `https://reddit.com${post.permalink}`,
          score: post.score,
          comments: post.num_comments,
          created: new Date(post.created_utc * 1000).toISOString(),
        });
      }
    }

    return {
      query: cleanQ,
      sceneResults,
      prowlarrResults,
      redditResults,
    };
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

      let finalTmdbId = tmdbId;
      if (!finalTmdbId) {
        try {
          const tmdb = new TheMovieDb();
          const cleanSearchTitle = title
            .replace(/\[.*?\]|\(.*?\)/g, '')
            .replace(
              /\b(workprint|screener|1080p|720p|480p|x264|x265|hevc|web-?dl|dvdscr|bjn|dks|collective|proper|hc|director cut|dual|v2)\b/gi,
              ''
            )
            .replace(/[:\.\-_]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const searchRes = await tmdb.searchMovies({
            query: cleanSearchTitle,
            language: 'en',
          });
          if (searchRes.results && searchRes.results.length > 0) {
            finalTmdbId = searchRes.results[0].id;
          }
        } catch {}
      }

      if (
        downloadUrl.startsWith('magnet:') ||
        downloadUrl.includes('.torrent') ||
        downloadUrl.includes('/download?')
      ) {
        const qbUrl = `${getQbittorrentBaseUrl()}/api/v2/torrents/add`;
        const params = new URLSearchParams();
        params.append('urls', downloadUrl);
        params.append('category', options.mediaType === 'tv' ? 'tv' : 'movies');
        params.append('autoTMM', 'true');

        await axios.post(qbUrl, params.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          auth: { username: 'admin', password: 'PAssw0rd2026!' },
        });

        // Automatically register the movie in Radarr if not already present
        // This ensures it appears on https://seerr.nullraccoon.com/downloads and automatically imports into Plex!
        if (finalTmdbId && options.mediaType !== 'tv') {
          try {
            const settings = getSettings();
            const radarrServer =
              settings.radarr.find((r) => r.isDefault) || settings.radarr[0];
            if (radarrServer) {
              const radarrApi = new RadarrAPI({
                apiKey: radarrServer.apiKey,
                url: RadarrAPI.buildUrl(radarrServer, '/api/v3'),
              });
              const existing = await radarrApi.getMovies();
              const inRadarr = existing.some((m) => m.tmdbId === finalTmdbId);
              if (!inRadarr) {
                const lookup = await radarrApi.getMovieByTmdbId(finalTmdbId);
                if (lookup) {
                  await radarrApi.addMovie({
                    title: lookup.title,
                    year: lookup.year || year || new Date().getFullYear(),
                    tmdbId: finalTmdbId,
                    profileId: radarrServer.activeProfileId || 1,
                    qualityProfileId: radarrServer.activeProfileId || 1,
                    rootFolderPath:
                      radarrServer.activeDirectory || '/data/media/movies',
                    minimumAvailability: 'released',
                    tags: [],
                    monitored: true,
                    searchNow: false,
                  });
                  logger.info(
                    `[LeakRadar] Registered "${lookup.title}" in Radarr for live download tracking and Plex import.`
                  );
                }
              }
            }
          } catch (arrErr: any) {
            logger.warn(
              `[LeakRadar] Non-blocking Radarr registration notice: ${arrErr.message}`
            );
          }
        }

        return {
          success: true,
          message: `Torrente añadido exitosamente a qBittorrent para "${title}".`,
        };
      } else {
        const streamTmdbId = finalTmdbId || Math.floor(Math.random() * 900000 + 100000);
        await streamDownloader.startDownload({
          tmdbId: streamTmdbId,
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

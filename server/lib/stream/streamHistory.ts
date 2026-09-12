import fs from 'fs';
import path from 'path';
import { appDataPath } from '@server/utils/appDataVolume';
import logger from '@server/logger';
import { getSettings } from '@server/lib/settings';
import RadarrAPI from '@server/api/servarr/radarr';
import { streamDownloader } from './streamDownloader';

export interface StreamDownloadRecord {
  tmdbId: number;
  title: string;
  year?: number;
  streamUrl: string;
  source: string;
  quality?: string;
  resolution?: string;
  fileName?: string;
  fileSize?: number;
  status: 'downloading' | 'completed' | 'failed';
  date: string;
  error?: string;
}

export interface StreamInfo {
  isStream: boolean;
  source?: string;
  streamUrl?: string;
  quality?: string;
  resolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  audioLanguage?: string;
  fileName?: string;
  fileSize?: number;
  status?: 'downloading' | 'completed' | 'failed';
  progress?: number;
  speed?: string;
  timeLeft?: string;
}

class StreamHistory {
  private filePath: string;
  private records: Map<number, StreamDownloadRecord> = new Map();
  private initialized = false;

  constructor() {
    this.filePath = path.join(appDataPath(), 'stream_downloads.json');
  }

  private init() {
    if (this.initialized) return;
    this.initialized = true;

    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const list: StreamDownloadRecord[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item.tmdbId) {
              this.records.set(item.tmdbId, item);
            }
          }
        }
      }
    } catch (e: any) {
      logger.warn(`[StreamHistory] Failed to read ${this.filePath}: ${e.message}`);
    }

    // Pre-populate known stream downloads if not present
    if (!this.records.has(12589)) {
      // Jimmy Neutron: Boy Genius (2001)
      this.records.set(12589, {
        tmdbId: 12589,
        title: 'Jimmy Neutron: Boy Genius',
        year: 2001,
        streamUrl: 'https://ok.ru/video/4987879361204',
        source: 'OK.ru (Audio Latino)',
        quality: 'WEBDL-480p',
        resolution: '640x480',
        fileName: 'Jimmy Neutron Boy Genius (2001) [WEB-DL Stream Latino].mp4',
        status: 'completed',
        date: '2026-09-10T22:19:00.000Z',
      });
      this.saveToFile();
    }
  }

  private saveToFile() {
    try {
      const list = Array.from(this.records.values());
      fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (e: any) {
      logger.error(`[StreamHistory] Failed to write ${this.filePath}: ${e.message}`);
    }
  }

  public saveRecord(record: StreamDownloadRecord) {
    this.init();
    this.records.set(record.tmdbId, record);
    this.saveToFile();
  }

  public getRecord(tmdbId: number): StreamDownloadRecord | undefined {
    this.init();
    return this.records.get(tmdbId);
  }

  public async getStreamInfo(
    tmdbId: number,
    cleanTitle?: string,
    year?: number
  ): Promise<StreamInfo | undefined> {
    this.init();

    // 1. Check active or recent streamDownloader jobs
    const activeJob = streamDownloader.getActiveJobForMovie(tmdbId);
    if (activeJob) {
      const isOkru =
        activeJob.streamUrl.includes('ok.ru') ||
        activeJob.streamUrl.includes('okcdn.ru');
      const isHackstore = activeJob.streamUrl.includes('hackstore');
      const sourceName = isOkru
        ? 'OK.ru (Audio Latino)'
        : isHackstore
        ? 'Hackstore (Stream)'
        : 'Web Stream (Latino)';

      return {
        isStream: true,
        source: sourceName,
        streamUrl: activeJob.streamUrl,
        status: activeJob.status === 'completed' ? 'completed' : 'downloading',
        progress: activeJob.progress,
        speed: activeJob.speed,
        timeLeft: activeJob.timeLeft,
        fileName: activeJob.targetPath
          ? path.basename(activeJob.targetPath)
          : undefined,
        audioLanguage: 'Español Latino',
      };
    }

    // 2. Check persistent stream download history
    const historyRecord = this.records.get(tmdbId);

    // 3. Query Radarr for movie file specifications
    let radarrMovieFile: any = null;
    try {
      const settings = getSettings();
      const defaultRadarr =
        settings.radarr.find((r) => r.isDefault) || settings.radarr[0];
      if (defaultRadarr) {
        const radarr = new RadarrAPI({
          url: RadarrAPI.buildUrl(defaultRadarr, '/api/v3'),
          apiKey: defaultRadarr.apiKey,
        });
        const radarrMovie = await radarr.getMovieByTmdbId(tmdbId);
        if (radarrMovie?.movieFile) {
          radarrMovieFile = radarrMovie.movieFile;
        }
      }
    } catch {
      // Radarr query failed or movie not in Radarr; continue
    }

    // Check if Radarr's file was downloaded via stream
    const isStreamFile =
      radarrMovieFile?.relativePath &&
      (radarrMovieFile.relativePath.includes('[WEB-DL Stream Latino]') ||
        radarrMovieFile.relativePath.includes('Stream Latino') ||
        radarrMovieFile.relativePath.includes('[WEB-DL Stream]'));

    // 4. Check filesystem on disk directly if Radarr didn't have movieFile yet
    let diskFound = false;
    let diskFileName: string | undefined;
    if (!radarrMovieFile && cleanTitle) {
      const folderName = year ? `${cleanTitle} (${year})` : cleanTitle;
      const mediaDirs = ['/data/media/movies', 'C:\\arr-stack\\data\\media\\movies'];
      for (const dir of mediaDirs) {
        try {
          const movieDir = path.join(dir, folderName);
          if (fs.existsSync(movieDir)) {
            const files = fs.readdirSync(movieDir);
            const streamFile = files.find(
              (f) =>
                f.includes('[WEB-DL Stream Latino]') ||
                f.includes('Stream Latino') ||
                f.includes('[WEB-DL Stream]')
            );
            if (streamFile) {
              diskFound = true;
              diskFileName = streamFile;
              break;
            }
          }
        } catch {
          // ignore
        }
      }
    }

    // If stream history, or Radarr stream file, or disk file matched:
    if (historyRecord || isStreamFile || diskFound) {
      const source =
        historyRecord?.source ||
        (isStreamFile || diskFound ? 'Web Stream (Audio Latino)' : 'Web Stream');

      const quality =
        radarrMovieFile?.quality?.quality?.name ||
        historyRecord?.quality ||
        'WEBDL-480p';

      const resolution =
        radarrMovieFile?.mediaInfo?.resolution || historyRecord?.resolution;

      const videoCodec = radarrMovieFile?.mediaInfo?.videoCodec;
      const audioCodec = radarrMovieFile?.mediaInfo?.audioCodec;
      const audioLanguage =
        radarrMovieFile?.languages?.[0]?.name || 'Español Latino';

      const fileName =
        radarrMovieFile?.relativePath ||
        diskFileName ||
        historyRecord?.fileName;

      const fileSize = radarrMovieFile?.size || historyRecord?.fileSize;

      return {
        isStream: true,
        source,
        streamUrl: historyRecord?.streamUrl,
        quality,
        resolution,
        videoCodec,
        audioCodec,
        audioLanguage,
        fileName,
        fileSize,
        status: 'completed',
      };
    }

    return undefined;
  }
}

export const streamHistory = new StreamHistory();
export default streamHistory;

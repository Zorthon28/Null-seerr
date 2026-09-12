import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import logger from '@server/logger';
import { getSettings } from '@server/lib/settings';
import RadarrAPI from '@server/api/servarr/radarr';
import { okruScraper } from './okruScraper';
import { streamHistory } from './streamHistory';

export interface StreamDownloadJob {
  id: string;
  tmdbId: number;
  title: string;
  year?: number;
  streamUrl: string;
  status: 'pending' | 'downloading' | 'completed' | 'failed';
  progress: number;
  size?: number;
  bytesDownloaded?: number;
  duration?: number;
  speed?: string;
  timeLeft?: string;
  targetPath?: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

class StreamDownloader {
  private jobs: Map<string, StreamDownloadJob> = new Map();
  private activeProcesses: Map<string, ChildProcess> = new Map();

  public getJobs(): StreamDownloadJob[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
    );
  }

  public getJob(id: string): StreamDownloadJob | undefined {
    return this.jobs.get(id);
  }

  public getActiveJobForMovie(tmdbId: number): StreamDownloadJob | undefined {
    return Array.from(this.jobs.values()).find(
      (j) =>
        j.tmdbId === tmdbId &&
        (j.status === 'downloading' || j.status === 'pending')
    );
  }

  public async startDownload({
    tmdbId,
    title,
    year,
    streamUrl,
  }: {
    tmdbId: number;
    title: string;
    year?: number;
    streamUrl: string;
  }): Promise<StreamDownloadJob> {
    const existing = this.getActiveJobForMovie(tmdbId);
    if (existing) {
      return existing;
    }

    const jobId = randomUUID();
    const cleanTitle = title.replace(/[<>:"/\\|?*]/g, '').trim();
    const folderName = year ? `${cleanTitle} (${year})` : cleanTitle;
    const fileName = `${folderName} [WEB-DL Stream Latino].mp4`;

    // Local host media directory
    const hostMediaDir = 'C:\\arr-stack\\data\\media\\movies';
    const hostMovieDir = path.join(hostMediaDir, folderName);
    const hostFilePath = path.join(hostMovieDir, fileName);

    // Ensure directory exists
    try {
      if (!fs.existsSync(hostMovieDir)) {
        fs.mkdirSync(hostMovieDir, { recursive: true });
      }
    } catch (e: any) {
      logger.warn(
        `[StreamDownloader] Failed to create dir locally: ${e.message}`
      );
    }

    // Inside container path
    const containerMediaDir = '/data/media/movies';
    const containerMovieDir = path.join(containerMediaDir, folderName);
    const containerFilePath = path.join(containerMovieDir, fileName);

    try {
      if (fs.existsSync(containerMediaDir) && !fs.existsSync(containerMovieDir)) {
        fs.mkdirSync(containerMovieDir, { recursive: true });
      }
    } catch {
      // ignore
    }

    const destFile = fs.existsSync(containerMediaDir)
      ? containerFilePath
      : hostFilePath;

    const job: StreamDownloadJob = {
      id: jobId,
      tmdbId,
      title,
      year,
      streamUrl,
      status: 'downloading',
      progress: 0,
      targetPath: destFile,
      startedAt: new Date(),
    };

    this.jobs.set(jobId, job);
    logger.info(`[StreamDownloader] Starting download for "${folderName}"`, {
      jobId,
      streamUrl,
      destFile,
    });

    const isOkruSource =
      streamUrl.includes('ok.ru') || streamUrl.includes('okcdn.ru');
    const sourceName = isOkruSource
      ? 'OK.ru (Audio Latino)'
      : streamUrl.includes('hackstore')
      ? 'Hackstore'
      : 'Web Stream (Latino)';

    streamHistory.saveRecord({
      tmdbId,
      title,
      year,
      streamUrl,
      source: sourceName,
      fileName,
      status: 'downloading',
      date: new Date().toISOString(),
    });

    let finalStreamUrl = streamUrl;
    if (finalStreamUrl.includes('ok.ru/video')) {
      logger.info(`[StreamDownloader] Resolving OK.ru page stream URL: ${finalStreamUrl}`);
      const okStream = await okruScraper.getVideoStream(finalStreamUrl, year);
      if (okStream?.streamUrl) {
        finalStreamUrl = okStream.streamUrl;
        logger.info(`[StreamDownloader] Successfully resolved OK.ru direct stream: ${finalStreamUrl.substring(0, 80)}...`);
      }
    }

    const isOkru =
      finalStreamUrl.includes('okcdn.ru') || finalStreamUrl.includes('ok.ru');
    const userAgent = isOkru
      ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      : 'Mozilla/5.0';

    const extraInputArgs: string[] = [];
    if (isOkru) {
      extraInputArgs.push('-headers', 'Referer: https://ok.ru/\r\n');
    }

    const isNativeFfmpeg = fs.existsSync('/usr/bin/ffmpeg');
    const hasAria2 = fs.existsSync('/usr/bin/aria2c');
    const isDirectFile = !finalStreamUrl.includes('.m3u8') && !finalStreamUrl.includes('m3u8');
    const useAria2 = hasAria2 && isDirectFile;

    let command = '';
    let args: string[] = [];

    if (useAria2) {
      command = 'aria2c';
      const destDir = path.dirname(destFile);
      const destBase = path.basename(destFile);
      args = [
        '-x',
        '16',
        '-s',
        '16',
        '-j',
        '16',
        '-k',
        '1M',
        '-c',
        '--summary-interval=1',
        '--allow-overwrite=true',
        '--auto-file-renaming=false',
        '-U',
        userAgent,
        ...(isOkru ? ['--header=Referer: https://ok.ru/'] : []),
        '-d',
        destDir,
        '-o',
        destBase,
        finalStreamUrl,
      ];
    } else {
      command = isNativeFfmpeg ? 'ffmpeg' : 'docker';
      args = isNativeFfmpeg
        ? ['-y', ...extraInputArgs, '-user_agent', userAgent, '-i', finalStreamUrl, '-c', 'copy', destFile]
        : ['exec', 'tdarr', 'ffmpeg', '-y', ...extraInputArgs, '-user_agent', userAgent, '-i', finalStreamUrl, '-c', 'copy', `/data/media/movies/${folderName}/${fileName}`];
    }

    let totalDuration = 0;
    let lastBytes = 0;
    let lastTime = Date.now();

    const child = spawn(command, args);
    this.activeProcesses.set(jobId, child);

    const parseSizeToBytes = (str: string): number => {
      const m = str.match(/([0-9.]+)\s*(KiB|MiB|GiB|B)/i);
      if (!m) return 0;
      const num = parseFloat(m[1]);
      const unit = m[2].toUpperCase();
      if (unit === 'GIB') return Math.round(num * 1024 * 1024 * 1024);
      if (unit === 'MIB') return Math.round(num * 1024 * 1024);
      if (unit === 'KIB') return Math.round(num * 1024);
      return Math.round(num);
    };

    const handleStreamOutput = (text: string) => {
      if (useAria2) {
        const ariaMatch = text.match(
          /\[#[a-f0-9]+\s+([^\/]+)\/([^\(]+)\((\d+)%\).*?DL:(\S+)\s+ETA:([^\]\s]+)\]/i
        );
        if (ariaMatch) {
          job.bytesDownloaded = parseSizeToBytes(ariaMatch[1]);
          job.size = parseSizeToBytes(ariaMatch[2]);
          job.progress = Math.min(99, parseInt(ariaMatch[3], 10));
          job.speed = `${ariaMatch[4]}/s`;
          job.timeLeft = `~${ariaMatch[5]}`;
        }
        return;
      }

      // FFmpeg progress handling
      if (!totalDuration) {
        const durMatch = text.match(/Duration:\s*(\d+):(\d+):(\d+)/);
        if (durMatch) {
          totalDuration =
            parseInt(durMatch[1], 10) * 3600 +
            parseInt(durMatch[2], 10) * 60 +
            parseInt(durMatch[3], 10);
          job.duration = totalDuration;
        }
      }

      // Extract size (e.g. size=   45056kB)
      const sizeMatch = text.match(/size=\s*(\d+)\s*kB/i);
      let currentBytes = 0;
      if (sizeMatch) {
        currentBytes = parseInt(sizeMatch[1], 10) * 1024;
        job.bytesDownloaded = currentBytes;
      }

      // Extract speed multiplier (e.g. speed= 19.4x)
      const speedMatch = text.match(/speed=\s*([\d.]+)x/i);
      let speedMultiplier = 1;
      if (speedMatch) {
        speedMultiplier = parseFloat(speedMatch[1]);
      }

      // Extract current time
      const timeMatch = text.match(/time=\s*(\d+):(\d+):(\d+)/);
      if (timeMatch && totalDuration > 0) {
        const currentSec =
          parseInt(timeMatch[1], 10) * 3600 +
          parseInt(timeMatch[2], 10) * 60 +
          parseInt(timeMatch[3], 10);
        job.progress = Math.min(
          99,
          Math.round((currentSec / totalDuration) * 100)
        );

        // Estimate total size
        if (job.progress > 0 && currentBytes > 0) {
          job.size = Math.round(currentBytes / (job.progress / 100));
        }

        // Calculate ETA
        const remainingSec = Math.max(0, totalDuration - currentSec);
        const etaSeconds =
          speedMultiplier > 0 ? Math.round(remainingSec / speedMultiplier) : 0;
        if (etaSeconds >= 60) {
          job.timeLeft = `~${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s`;
        } else if (etaSeconds > 0) {
          job.timeLeft = `~${etaSeconds}s`;
        }

        // Calculate transfer speed
        const now = Date.now();
        const deltaSec = (now - lastTime) / 1000;
        if (deltaSec >= 1 && currentBytes > lastBytes) {
          const bps = (currentBytes - lastBytes) / deltaSec;
          job.speed = `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
          lastBytes = currentBytes;
          lastTime = now;
        } else if (!job.speed && speedMultiplier > 0) {
          job.speed = `${speedMultiplier.toFixed(1)}x`;
        }
      }
    };

    child.stdout?.on('data', (data: Buffer) => handleStreamOutput(data.toString()));
    child.stderr?.on('data', (data: Buffer) => handleStreamOutput(data.toString()));

    child.on('close', async (code) => {
      this.activeProcesses.delete(jobId);
      if (code === 0) {
        logger.info(
          `[StreamDownloader] Successfully completed download for "${folderName}"`
        );
        job.status = 'completed';
        job.progress = 100;
        job.timeLeft = 'Finalizado';
        job.speed = '';
        job.completedAt = new Date();

        try {
          if (fs.existsSync(destFile)) {
            job.size = fs.statSync(destFile).size;
            job.bytesDownloaded = job.size;
          }
        } catch {
          // ignore
        }

        streamHistory.saveRecord({
          tmdbId,
          title,
          year,
          streamUrl,
          source: sourceName,
          fileName,
          fileSize: job.size,
          status: 'completed',
          date: new Date().toISOString(),
        });

        await this.notifyRadarr(tmdbId, title, year);
      } else {
        logger.error(
          `[StreamDownloader] Download failed with code ${code} for "${folderName}"`
        );
        job.status = 'failed';
        job.error = job.error || `Process exited with code ${code}`;
        job.completedAt = new Date();

        streamHistory.saveRecord({
          tmdbId,
          title,
          year,
          streamUrl,
          source: sourceName,
          fileName,
          status: 'failed',
          error: job.error,
          date: new Date().toISOString(),
        });
      }
    });

    child.on('error', (err) => {
      this.activeProcesses.delete(jobId);
      logger.error(
        `[StreamDownloader] Spawn error for "${folderName}": ${err.message}`
      );
      job.status = 'failed';
      job.error = err.message;
      job.completedAt = new Date();
    });

    return job;
  }

  public cancelJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    const child = this.activeProcesses.get(id);
    if (child) {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      this.activeProcesses.delete(id);
    }

    job.status = 'failed';
    job.error = 'Descarga cancelada por el usuario';
    job.completedAt = new Date();

    if (job.targetPath) {
      try {
        if (fs.existsSync(job.targetPath)) {
          fs.unlinkSync(job.targetPath);
        }
      } catch {
        // ignore
      }
    }

    return true;
  }

  private async notifyRadarr(tmdbId: number, title: string, year?: number) {
    try {
      const settings = getSettings();
      const defaultRadarr = settings.radarr.find((r) => r.isDefault);
      if (!defaultRadarr) return;

      const radarr = new RadarrAPI({
        url: RadarrAPI.buildUrl(defaultRadarr, '/api/v3'),
        apiKey: defaultRadarr.apiKey,
      });

      let radarrMovie = await radarr.getMovieByTmdbId(tmdbId);
      if (!radarrMovie?.id) {
        logger.info(`[StreamDownloader] Adding movie to Radarr for tracking`, {
          title,
          tmdbId,
        });
        radarrMovie = await radarr.addMovie({
          title,
          tmdbId,
          year: year || 0,
          qualityProfileId: defaultRadarr.activeProfileId,
          profileId: defaultRadarr.activeProfileId,
          rootFolderPath: defaultRadarr.activeDirectory,
          minimumAvailability: 'released',
          tags: defaultRadarr.tags || [],
          monitored: false,
          searchNow: false,
        });
      }

      if (radarrMovie?.id) {
        logger.info(
          `[StreamDownloader] Triggering Radarr Rescan for movie ${radarrMovie.id}`
        );
        await radarr.rescanMovie(radarrMovie.id);
      }
    } catch (e: any) {
      logger.warn(
        `[StreamDownloader] Failed to notify Radarr after download: ${e.message}`
      );
    }
  }
}

export const streamDownloader = new StreamDownloader();

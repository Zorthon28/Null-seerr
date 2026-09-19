import { Router } from 'express';
import { spawn } from 'child_process';
import logger from '@server/logger';

const trailerRoutes = Router();

interface CacheEntry {
  url: string;
  type: 'hls' | 'mp4';
  cachedAt: number;
}

const urlCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function getDirectUrl(youtubeKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn('yt-dlp', [
      '--no-warnings',
      '--quiet',
      '--format',
      'best[ext=mp4]/best',
      '--get-url',
      `https://www.youtube.com/watch?v=${youtubeKey}`,
    ]);

    let stdout = '';
    let stderr = '';
    ytdlp.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    ytdlp.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    ytdlp.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(0, 200)}`));
      } else {
        // Take first URL line (video URL; there may be a second line for audio)
        const lines = stdout.trim().split('\n').filter(Boolean);
        resolve(lines[0].trim());
      }
    });
    ytdlp.on('error', reject);
  });
}

/**
 * GET /api/v1/trailer/stream?key=VIDEO_KEY
 *
 * Extracts a direct stream URL for a YouTube video via yt-dlp.
 * Results are cached in-memory for 4 hours (YouTube signed URLs are valid ~6h).
 * Does NOT require authentication — trailers are public content.
 */
trailerRoutes.get('/stream', async (req, res) => {
  const key = String(req.query.key || '').trim();
  if (!key || !/^[a-zA-Z0-9_-]{11}$/.test(key)) {
    return res.status(400).json({ error: 'Invalid YouTube key' });
  }

  // Serve from cache if still fresh
  const cached = urlCache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return res.json({ url: cached.url, type: cached.type, cached: true });
  }

  try {
    const url = await getDirectUrl(key);
    const type: 'hls' | 'mp4' =
      url.includes('manifest.googlevideo.com') || url.includes('hls_playlist')
        ? 'hls'
        : 'mp4';

    const entry: CacheEntry = { url, type, cachedAt: Date.now() };
    urlCache.set(key, entry);

    return res.json({ url, type, cached: false });
  } catch (e: any) {
    logger.debug(`[Trailer] yt-dlp failed for ${key}: ${e.message}`);
    return res.status(404).json({ error: 'Unable to extract trailer URL' });
  }
});

export default trailerRoutes;

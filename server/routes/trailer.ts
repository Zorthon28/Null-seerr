import { Router } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import logger from '@server/logger';

const trailerRoutes = Router();

interface CacheEntry {
  url: string;
  type: 'hls' | 'mp4';
  cachedAt: number;
}

const urlCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

const cacheFilePath = process.env.CONFIG_DIRECTORY
  ? `${process.env.CONFIG_DIRECTORY}/trailer-cache.json`
  : path.join(__dirname, '../../config/trailer-cache.json');

// Load cached URLs from disk
function loadPersistentCache(): void {
  try {
    if (fs.existsSync(cacheFilePath)) {
      const raw = fs.readFileSync(cacheFilePath, 'utf-8');
      const parsed: Record<string, CacheEntry> = JSON.parse(raw);
      const now = Date.now();
      let count = 0;
      for (const [key, entry] of Object.entries(parsed)) {
        if (entry?.url && now - (entry.cachedAt || 0) < CACHE_TTL_MS) {
          urlCache.set(key, entry);
          count++;
        }
      }
      logger.info(`[Trailer] Loaded ${count} trailer streams from persistent cache`);
    }
  } catch (e: any) {
    logger.warn(`[Trailer] Failed to load persistent cache from disk: ${e.message}`);
  }
}

// Debounced save to disk
let saveTimer: NodeJS.Timeout | null = null;
function savePersistentCacheDebounced(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const now = Date.now();
      const exportObj: Record<string, CacheEntry> = {};
      for (const [key, entry] of urlCache.entries()) {
        if (now - entry.cachedAt < CACHE_TTL_MS) {
          exportObj[key] = entry;
        }
      }
      fs.writeFileSync(cacheFilePath, JSON.stringify(exportObj, null, 2), 'utf-8');
    } catch (e: any) {
      logger.warn(`[Trailer] Failed to persist cache to disk: ${e.message}`);
    }
  }, 1000);
}

// Initialize persistent cache on module load
loadPersistentCache();

function getDirectUrl(youtubeKey: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn('yt-dlp', [
      '--no-warnings',
      '--quiet',
      '--no-playlist',
      '--force-ipv4',
      '--socket-timeout',
      '10',
      '--extractor-args',
      'youtube:player_client=android,web',
      '--user-agent',
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
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
 * Results are cached in-memory and persisted to disk for 4 hours.
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
    savePersistentCacheDebounced();

    return res.json({ url, type, cached: false });
  } catch (e: any) {
    logger.debug(`[Trailer] yt-dlp failed for ${key}: ${e.message}`);
    return res.status(404).json({ error: 'Unable to extract trailer URL' });
  }
});

interface SearchCacheEntry {
  key: string;
  name: string;
  cachedAt: number;
}

const searchCache = new Map<string, SearchCacheEntry>();
const SEARCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function searchTrailer(
  title: string,
  year?: string
): Promise<{ key: string; name: string } | null> {
  const query = `${title} ${year ? year + ' ' : ''}official trailer`.trim();
  return new Promise((resolve) => {
    const ytdlp = spawn('yt-dlp', [
      '--no-warnings',
      '--quiet',
      '--no-playlist',
      '--force-ipv4',
      '--socket-timeout',
      '8',
      '--no-update',
      '--get-id',
      '--get-title',
      `ytsearch3:${query}`,
    ]);

    let stdout = '';
    ytdlp.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    ytdlp.on('close', (code) => {
      if (code !== 0 || !stdout.trim()) {
        resolve(null);
      } else {
        const lines = stdout
          .trim()
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        for (let i = 0; i < lines.length; i += 2) {
          const name = lines[i];
          const key = lines[i + 1];
          if (key && /^[a-zA-Z0-9_-]{11}$/.test(key)) {
            resolve({ key, name });
            return;
          }
        }
        resolve(null);
      }
    });
    ytdlp.on('error', () => resolve(null));
  });
}

/**
 * GET /api/v1/trailer/search?title=TITLE&year=YEAR
 *
 * Searches YouTube for an official trailer when TMDB has no trailers
 * or when TMDB trailer links are geo-restricted / blocked.
 */
trailerRoutes.get('/search', async (req, res) => {
  const title = String(req.query.title || '').trim();
  const year = req.query.year ? String(req.query.year).trim() : undefined;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  const cacheKey = `${title.toLowerCase()}_${year || ''}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < SEARCH_CACHE_TTL_MS) {
    return res.json({
      key: cached.key,
      name: cached.name,
      site: 'YouTube',
      type: 'Trailer',
      cached: true,
    });
  }

  try {
    const result = await searchTrailer(title, year);
    if (!result) {
      return res.status(404).json({ error: 'No trailer found' });
    }

    searchCache.set(cacheKey, {
      key: result.key,
      name: result.name,
      cachedAt: Date.now(),
    });

    return res.json({
      key: result.key,
      name: result.name,
      site: 'YouTube',
      type: 'Trailer',
      cached: false,
    });
  } catch (e: any) {
    logger.debug(`[Trailer] Search failed for "${title}": ${e.message}`);
    return res.status(500).json({ error: 'Trailer search failed' });
  }
});

export default trailerRoutes;


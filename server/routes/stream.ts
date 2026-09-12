import { Router } from 'express';
import logger from '@server/logger';
import { smartResolver } from '@server/lib/smartDownload/smartResolver';
import { streamDownloader } from '@server/lib/stream/streamDownloader';

const streamRoutes = Router();

/**
 * Check if movie has Multi torrents or Spanish streams
 * POST /api/v1/stream/check
 */
streamRoutes.post('/check', async (req, res) => {
  try {
    const { tmdbId, englishTitle, spanishTitle, year } = req.body;
    if (!tmdbId || !englishTitle) {
      return res.status(400).json({ error: 'tmdbId and englishTitle are required' });
    }

    const result = await smartResolver.checkMovie(
      Number(tmdbId),
      String(englishTitle),
      String(spanishTitle || englishTitle),
      year ? Number(year) : undefined
    );

    return res.json(result);
  } catch (e: any) {
    logger.error(`[Stream Routes] Error checking movie: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Start direct stream download
 * POST /api/v1/stream/download
 */
streamRoutes.post('/download', async (req, res) => {
  try {
    const { tmdbId, title, year, streamUrl } = req.body;
    if (!tmdbId || !title || !streamUrl) {
      return res.status(400).json({ error: 'tmdbId, title, and streamUrl are required' });
    }

    const job = await streamDownloader.startDownload({
      tmdbId: Number(tmdbId),
      title: String(title),
      year: year ? Number(year) : undefined,
      streamUrl: String(streamUrl),
    });

    return res.json({ success: true, job });
  } catch (e: any) {
    logger.error(`[Stream Routes] Error starting stream download: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Get all stream download jobs
 * GET /api/v1/stream/jobs
 */
streamRoutes.get('/jobs', (_req, res) => {
  try {
    const jobs = streamDownloader.getJobs();
    return res.json({ jobs });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Cancel stream download job
 * POST /api/v1/stream/cancel/:jobId
 */
streamRoutes.post('/cancel/:jobId', (req, res) => {
  try {
    const success = streamDownloader.cancelJob(req.params.jobId);
    return res.json({ success });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Get download job status for movie
 * GET /api/v1/stream/status/:tmdbId
 */
streamRoutes.get('/status/:tmdbId', (req, res) => {
  try {
    const tmdbId = Number(req.params.tmdbId);
    const job = streamDownloader.getActiveJobForMovie(tmdbId);
    return res.json({ active: !!job, job: job || null });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

export default streamRoutes;

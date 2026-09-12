import { Router } from 'express';
import logger from '@server/logger';
import { leakRadarService } from '@server/lib/leakRadar/leakRadarService';

const leakRoutes = Router();

/**
 * Get all active leak alerts
 * GET /api/v1/leaks
 */
leakRoutes.get('/', async (req, res) => {
  try {
    const alerts = leakRadarService.getAlerts();
    return res.json({
      alerts,
      total: alerts.length,
      matchedCount: alerts.filter((a) => Boolean(a.matchedMedia)).length,
    });
  } catch (e: any) {
    logger.error(`[LeakRoutes] Error getting alerts: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Trigger manual scan for leaks
 * POST /api/v1/leaks/scan
 */
leakRoutes.post('/scan', async (req, res) => {
  try {
    const result = await leakRadarService.scan();
    return res.json(result);
  } catch (e: any) {
    logger.error(`[LeakRoutes] Error scanning leaks: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Dismiss a leak alert
 * DELETE /api/v1/leaks/:id
 */
leakRoutes.delete('/:id', async (req, res) => {
  try {
    const success = leakRadarService.dismissAlert(req.params.id);
    return res.json({ success });
  } catch (e: any) {
    logger.error(`[LeakRoutes] Error dismissing alert: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Ingest a leak download (Direct link, DDL or magnet)
 * POST /api/v1/leaks/ingest
 */
leakRoutes.post('/ingest', async (req, res) => {
  try {
    const { title, year, tmdbId, downloadUrl, mediaType } = req.body;
    if (!title || !downloadUrl) {
      return res.status(400).json({ error: 'title and downloadUrl are required' });
    }

    const result = await leakRadarService.ingestLeak({
      title: String(title),
      year: year ? Number(year) : undefined,
      tmdbId: tmdbId ? Number(tmdbId) : undefined,
      downloadUrl: String(downloadUrl).trim(),
      mediaType: mediaType === 'tv' ? 'tv' : 'movie',
    });

    return res.json(result);
  } catch (e: any) {
    logger.error(`[LeakRoutes] Error ingesting leak: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

export default leakRoutes;

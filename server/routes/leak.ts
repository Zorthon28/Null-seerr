import { Router } from 'express';
import logger from '@server/logger';
import { leakRadarService, LeakAlert } from '@server/lib/leakRadar/leakRadarService';
import { LeakNotifier } from '@server/lib/leakRadar/leakNotifier';

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
      settings: leakRadarService.getSettings(),
    });
  } catch (e: any) {
    logger.error(`[LeakRoutes] Error getting alerts: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Get leak radar settings
 * GET /api/v1/leaks/settings
 */
leakRoutes.get('/settings', (req, res) => {
  try {
    return res.json(leakRadarService.getSettings());
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Update leak radar settings (e.g. autoDownloadLibraryLeaks)
 * POST /api/v1/leaks/settings
 */
leakRoutes.post('/settings', (req, res) => {
  try {
    const updated = leakRadarService.updateSettings(req.body);
    return res.json(updated);
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Trigger live on-demand leak search
 * GET /api/v1/leaks/search?query=...
 */
leakRoutes.get('/search', async (req, res) => {
  try {
    const q = String(req.query.query || '');
    if (!q.trim()) {
      return res.status(400).json({ error: 'Query parameter is required' });
    }
    const result = await leakRadarService.searchOnDemand(q);
    return res.json(result);
  } catch (e: any) {
    logger.error(`[LeakRoutes] Search error: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * 1-Click Grab a leak alert
 * POST /api/v1/leaks/grab
 * Body: { id: string }
 */
leakRoutes.post('/grab', async (req, res) => {
  try {
    const id = req.body?.id || req.body?.alertId || req.query?.id;
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID de alerta requerido' });
    }
    const result = await leakRadarService.grabLeak(String(id));
    return res.json(result);
  } catch (e: any) {
    logger.error(`[LeakRoutes] Grab error: ${e.message}`);
    return res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * 1-Click Grab a leak alert (param fallback)
 * POST /api/v1/leaks/:id/grab
 */
leakRoutes.post('/:id/grab', async (req, res) => {
  try {
    const result = await leakRadarService.grabLeak(req.params.id);
    return res.json(result);
  } catch (e: any) {
    logger.error(`[LeakRoutes] Grab error: ${e.message}`);
    return res.status(500).json({ success: false, message: e.message });
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
 * Send test notification
 * POST /api/v1/leaks/test-notification
 */
leakRoutes.post('/test-notification', async (req, res) => {
  try {
    const testAlert: LeakAlert = {
      id: 'test_leak_001',
      title: 'Spider-Man.Brand.New.Day.2026.1080p.WORKPRINT.x264-SCENE',
      mediaTitle: 'Spider-Man: Brand New Day',
      year: 2026,
      leakType: 'workprint',
      confidence: 'high',
      sourcePlatform: 'The Scene (PreDB)',
      subreddit: 'Scene',
      redditUrl: 'https://seerr.nullraccoon.com/leaks',
      description: 'Prueba de notificación del Radar de Filtraciones de Null-seerr. ¡Conexión exitosa!',
      detectedAt: new Date().toISOString(),
      inspection: {
        watermark: { detected: false },
        hardcodedSubs: { detected: false },
        audioProfile: { isOriginal: true, type: 'Digital Estéreo 5.1' },
        qualityGrade: 'A',
        cleanVideo: true,
        flags: ['Sin marcas de agua', 'Audio Original'],
      },
    };

    const result = await LeakNotifier.sendNotification(testAlert, true);
    return res.json({
      success: true,
      message: 'Notificación de prueba enviada',
      ...result,
    });
  } catch (e: any) {
    logger.error(`[LeakRoutes] Test notification error: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }
});

/**
 * Dismiss a leak alert
 * POST /api/v1/leaks/dismiss
 * Body: { id: string }
 */
leakRoutes.post('/dismiss', async (req, res) => {
  try {
    const id = req.body?.id || req.body?.alertId || req.query?.id;
    if (!id) {
      return res.status(400).json({ success: false, message: 'ID de alerta requerido' });
    }
    const success = leakRadarService.dismissAlert(String(id));
    return res.json({ success });
  } catch (e: any) {
    logger.error(`[LeakRoutes] Error dismissing alert: ${e.message}`);
    return res.status(500).json({ success: false, error: e.message });
  }
});

/**
 * Dismiss a leak alert (param fallback)
 * DELETE /api/v1/leaks/:id
 */
leakRoutes.delete('/:id', async (req, res) => {
  try {
    const success = leakRadarService.dismissAlert(req.params.id);
    return res.json({ success });
  } catch (e: any) {
    logger.error(`[LeakRoutes] Error dismissing alert: ${e.message}`);
    return res.status(500).json({ success: false, error: e.message });
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

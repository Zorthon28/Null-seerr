import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import storageTracker, { type CleanupSelection } from '@server/lib/storageTracker';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const storageRoutes = Router();

function cleanupSelection(value: unknown): CleanupSelection[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || (item.mediaType !== 'movie' && item.mediaType !== 'tv') ||
      !Number.isSafeInteger(item.tmdbId) || item.tmdbId <= 0 ||
      (item.libraryPath !== undefined && typeof item.libraryPath !== 'string')) return undefined;
    const id = item.mediaType === 'movie' ? item.radarrId : item.sonarrId;
    const key = `${item.mediaType}:${id}`;
    if (!Number.isSafeInteger(id) || id <= 0 || ids.has(key)) return undefined;
    ids.add(key);
  }
  return value;
}

// GET /api/v1/storage/status - Returns disks, breakdown, low storage status & thresholds
storageRoutes.get('/status', isAuthenticated(), async (req, res, next) => {
  try {
    const status = await storageTracker.getStorageStatus();
    return res.status(200).json(status);
  } catch (err) {
    logger.error(
      `[StorageRoutes] Error retrieving storage status: ${err.message}`
    );
    return next(err);
  }
});

// GET /api/v1/storage/candidates - Returns cleanup candidates (unwatched by default)
storageRoutes.get(
  '/candidates',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    try {
      const filter =
        (req.query.filter as 'unwatched' | 'watched' | 'all') || 'unwatched';
      const candidates = await storageTracker.getCleanupCandidates(filter);
      return res.status(200).json({
        totalCount: candidates.length,
        candidates,
      });
    } catch (err) {
      logger.error(
        `[StorageRoutes] Error retrieving cleanup candidates: ${err.message}`
      );
      return next(err);
    }
  }
);

storageRoutes.post('/preview', isAuthenticated(Permission.MANAGE_REQUESTS), async (req, res) => {
  const items = cleanupSelection(req.body.items);
  if (!items) return res.status(400).json({ message: 'Select valid library items.' });
  try {
    return res.json(await storageTracker.previewCleanup(items));
  } catch (error) {
    logger.warn('[StorageRoutes] Could not verify cleanup preview', { error: error.message });
    return res.status(409).json({ message: 'Could not verify the selected items in their library folders.' });
  }
});

// POST /api/v1/storage/cleanup - Executes a verified cleanup selection.
storageRoutes.post(
  '/cleanup',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    try {
      const items = cleanupSelection(req.body.items);
      if (!items || items.some(({ libraryPath }) => !libraryPath)) {
        return res
          .status(400)
          .json({ message: 'Review the selected files before cleaning up.' });
      }
      const preview = await storageTracker.previewCleanup(items).catch(() => undefined);
      if (!preview) return res.status(409).json({ message: 'The selection changed. Preview it again.' });
      const result = await storageTracker.deleteMediaItems(preview.items);
      return res.status(200).json({
        success: true,
        freedBytes: result.freedBytes,
        deletedCount: result.deletedCount,
      });
    } catch (err) {
      logger.error(`[StorageRoutes] Error executing cleanup: ${err.message}`);
      return next(err);
    }
  }
);

// POST /api/v1/storage/settings - Updates storage alert thresholds
storageRoutes.post(
  '/settings',
  isAuthenticated(Permission.ADMIN),
  async (req, res, next) => {
    try {
      const settings = getSettings();
      const {
        lowStorageAlertEnabled,
        lowStorageThresholdGb,
        lowStorageThresholdPercent,
      } = req.body;

      if (typeof lowStorageAlertEnabled === 'boolean') {
        settings.main.lowStorageAlertEnabled = lowStorageAlertEnabled;
      }
      if (typeof lowStorageThresholdGb === 'number') {
        settings.main.lowStorageThresholdGb = Math.max(
          1,
          lowStorageThresholdGb
        );
      }
      if (typeof lowStorageThresholdPercent === 'number') {
        settings.main.lowStorageThresholdPercent = Math.min(
          100,
          Math.max(1, lowStorageThresholdPercent)
        );
      }

      await settings.save();
      return res.status(200).json({
        success: true,
        lowStorageAlertEnabled: settings.main.lowStorageAlertEnabled,
        lowStorageThresholdGb: settings.main.lowStorageThresholdGb,
        lowStorageThresholdPercent: settings.main.lowStorageThresholdPercent,
      });
    } catch (err) {
      logger.error(
        `[StorageRoutes] Error saving storage settings: ${err.message}`
      );
      return next(err);
    }
  }
);

export default storageRoutes;

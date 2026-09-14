import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import storageTracker from '@server/lib/storageTracker';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const storageRoutes = Router();

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

// POST /api/v1/storage/cleanup - Executes media deletion and space reclamation
storageRoutes.post(
  '/cleanup',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    try {
      const items = req.body.items;
      if (!Array.isArray(items) || items.length === 0) {
        return res
          .status(400)
          .json({ message: 'No items provided for deletion' });
      }

      const result = await storageTracker.deleteMediaItems(items);
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

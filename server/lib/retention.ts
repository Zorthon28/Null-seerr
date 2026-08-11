import fs from 'fs';
import path from 'path';
import PlexAPI from '@server/api/plexapi';
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

const retentionPath = process.env.CONFIG_DIRECTORY
  ? `${process.env.CONFIG_DIRECTORY}/retention-policies.json`
  : path.join(__dirname, '../../../config/retention-policies.json');

export interface RetentionRule {
  tmdbId: number;
  mediaType: MediaType;
  policy: 'dont_delete' | 'delete_after_watched' | 'delete_after_7_days';
  addedAt: string;
}

export const loadRetentionRules = (): Record<string, RetentionRule> => {
  try {
    if (fs.existsSync(retentionPath)) {
      const data = fs.readFileSync(retentionPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    logger.error('[Retention] Failed to load retention policies:', { error: e.message });
  }
  return {};
};

export const saveRetentionRules = (rules: Record<string, RetentionRule>): void => {
  try {
    fs.writeFileSync(retentionPath, JSON.stringify(rules, null, 2), 'utf-8');
  } catch (e) {
    logger.error('[Retention] Failed to save retention policies:', { error: e.message });
  }
};

export const getRetentionRule = (mediaType: MediaType, tmdbId: number): RetentionRule | null => {
  const rules = loadRetentionRules();
  const key = `${mediaType}-${tmdbId}`;
  return rules[key] || null;
};

export const setRetentionRule = (mediaType: MediaType, tmdbId: number, policy: 'dont_delete' | 'delete_after_watched' | 'delete_after_7_days'): void => {
  const rules = loadRetentionRules();
  const key = `${mediaType}-${tmdbId}`;

  if (policy === 'dont_delete') {
    delete rules[key];
  } else {
    rules[key] = {
      tmdbId,
      mediaType,
      policy,
      addedAt: new Date().toISOString(),
    };
  }

  saveRetentionRules(rules);
};

export const runRetentionSync = async (): Promise<void> => {
  logger.info('[Retention Sync] Running media retention policy checks...', { label: 'Jobs' });
  const rules = loadRetentionRules();
  const ruleKeys = Object.keys(rules);

  if (ruleKeys.length === 0) {
    logger.debug('[Retention Sync] No media retention policies to process.', { label: 'Jobs' });
    return;
  }

  const settings = getSettings();
  const userRepository = getRepository(User);
  const mediaRepository = getRepository(Media);

  const admin = await userRepository.findOne({
    select: ['id', 'plexToken'],
    order: { id: 'ASC' },
    where: {},
  });

  if (!admin || !admin.plexToken) {
    logger.warn('[Retention Sync] No admin Plex token found, skipping Plex watch status checks.', { label: 'Jobs' });
    return;
  }

  const plex = new PlexAPI({
    plexToken: admin.plexToken,
    plexSettings: settings.plex,
  });

  // Resolve Radarr/Sonarr servers
  const radarrSettings = settings.radarr.find((r) => r.isDefault) || settings.radarr[0];
  const sonarrSettings = settings.sonarr.find((s) => s.isDefault) || settings.sonarr[0];

  const radarr = radarrSettings ? new RadarrAPI({ url: `${radarrSettings.useSsl ? 'https' : 'http'}://${radarrSettings.hostname}:${radarrSettings.port}/api/v3`, apiKey: radarrSettings.apiKey }) : null;
  const sonarr = sonarrSettings ? new SonarrAPI({ url: `${sonarrSettings.useSsl ? 'https' : 'http'}://${sonarrSettings.hostname}:${sonarrSettings.port}/api/v3`, apiKey: sonarrSettings.apiKey }) : null;

  const now = new Date();
  const rulesCopy = { ...rules };
  let changesMade = false;

  for (const key of ruleKeys) {
    const rule = rules[key];
    const media = await mediaRepository.findOne({ where: { tmdbId: rule.tmdbId, mediaType: rule.mediaType } });

    if (!media) {
      // If media record no longer exists, clean up rule
      delete rulesCopy[key];
      changesMade = true;
      continue;
    }

    let shouldDelete = false;

    if (rule.policy === 'delete_after_7_days') {
      const addedDate = new Date(rule.addedAt);
      const diffTime = Math.abs(now.getTime() - addedDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays >= 7) {
        logger.info(`[Retention Sync] Item ${rule.mediaType}-${rule.tmdbId} expired (> 7 days). Triggering deletion.`, { label: 'Jobs' });
        shouldDelete = true;
      }
    } else if (rule.policy === 'delete_after_watched') {
      const ratingKey = rule.mediaType === 'movie' ? media.ratingKey : media.ratingKey; // Use ratingKey for both

      if (ratingKey) {
        try {
          const metadata = await plex.getMetadata(ratingKey);
          if (rule.mediaType === 'movie') {
            if (metadata && metadata.viewedLeafCount > 0) { // For movies, viewedLeafCount or viewCount is used
              logger.info(`[Retention Sync] Movie ${media.tmdbId} watched on Plex. Triggering deletion.`, { label: 'Jobs' });
              shouldDelete = true;
            }
          } else {
            // TV show: check if all available episodes are watched
            if (metadata && metadata.viewedLeafCount === metadata.leafCount && metadata.leafCount > 0) {
              logger.info(`[Retention Sync] TV Show ${media.tmdbId} fully watched on Plex. Triggering deletion.`, { label: 'Jobs' });
              shouldDelete = true;
            }
          }
        } catch (e) {
          logger.warn(`[Retention Sync] Failed to fetch Plex metadata for ratingKey ${ratingKey}:`, { error: e.message });
        }
      }
    }

    if (shouldDelete) {
      try {
        if (rule.mediaType === 'movie' && radarr) {
          await radarr.removeMovie(rule.tmdbId);
        } else if (rule.mediaType === 'tv' && sonarr && media.tvdbId) {
          await sonarr.removeSeries(media.tvdbId);
        }

        // Clean up from Seerr DB
        await mediaRepository.remove(media);

        // Clean up rule
        delete rulesCopy[key];
        changesMade = true;
      } catch (e) {
        logger.error(`[Retention Sync] Deletion failed for ${rule.mediaType}-${rule.tmdbId}:`, { error: e.message });
      }
    }
  }

  if (changesMade) {
    saveRetentionRules(rulesCopy);
  }
};

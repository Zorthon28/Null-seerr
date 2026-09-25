import RadarrAPI from '@server/api/servarr/radarr';
import TheMovieDb from '@server/api/themoviedb';
import type { TmdbMovieDetails } from '@server/api/themoviedb/interfaces';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { uniqWith } from 'lodash';

class InCinemasSync {
  public running = false;
  private tmdb = new TheMovieDb();

  public async run(): Promise<void> {
    if (this.running) {
      logger.info('In-Cinemas sync is already running, skipping.', {
        label: 'InCinemasSync',
      });
      return;
    }

    this.running = true;
    try {
      logger.info('Starting scheduled In-Cinemas movie check...', {
        label: 'InCinemasSync',
      });

      const settings = getSettings();
      const filteredRadarr = uniqWith(settings.radarr, (a, b) => {
        return (
          a.hostname === b.hostname &&
          a.port === b.port &&
          a.baseUrl === b.baseUrl
        );
      });

      let totalChecked = 0;
      let totalTriggered = 0;

      for (const server of filteredRadarr) {
        if (!server.syncEnabled) continue;

        const radarr = new RadarrAPI({
          apiKey: server.apiKey,
          url: RadarrAPI.buildUrl(server, '/api/v3'),
        });

        let movies: any[] = [];
        try {
          movies = await radarr.getMovies();
        } catch (e: any) {
          logger.error(`[InCinemasSync] Failed to fetch movies from Radarr (${server.name}): ${e.message}`, {
            label: 'InCinemasSync',
          });
          continue;
        }

        // Monitored movies without files that are inCinemas, announced, or unreleased
        const candidates = movies.filter(
          (m) => m.monitored && !m.hasFile && (m.status === 'inCinemas' || m.status === 'announced' || m.minimumAvailability === 'inCinemas')
        );

        logger.info(
          `[InCinemasSync] Radarr (${server.name}): Found ${candidates.length} in-theaters/unreleased movie candidates`,
          { label: 'InCinemasSync' }
        );

        for (const movie of candidates) {
          totalChecked++;
          try {
            const tmdbDetails: TmdbMovieDetails = await this.tmdb.getMovie({
              movieId: movie.tmdbId,
            });

            const hasDigitalOrPhysicalRelease = this.checkDigitalOrPhysicalRelease(tmdbDetails);

            if (hasDigitalOrPhysicalRelease) {
              logger.info(
                `[InCinemasSync] Movie "${movie.title}" (${movie.tmdbId}) now has digital/physical release. Triggering Radarr search.`,
                { label: 'InCinemasSync', movieId: movie.id, title: movie.title }
              );
              totalTriggered++;
              await radarr.searchMovie(movie.id);

              // Throttle between searches by 4 seconds to protect indexer rate limits
              await new Promise((r) => setTimeout(r, 4000));
            } else {
              logger.debug(
                `[InCinemasSync] Movie "${movie.title}" (${movie.tmdbId}) remains in theatrical window. No tracker search triggered.`,
                { label: 'InCinemasSync' }
              );
            }
          } catch (err: any) {
            logger.warn(
              `[InCinemasSync] Error checking movie "${movie.title}" (${movie.tmdbId}): ${err.message}`,
              { label: 'InCinemasSync' }
            );
          }
        }
      }

      logger.info(
        `[InCinemasSync] Finished In-Cinemas sync: ${totalChecked} checked, ${totalTriggered} triggered for download.`,
        { label: 'InCinemasSync' }
      );
    } catch (e: any) {
      logger.error(`[InCinemasSync] Fatal error during sync: ${e.message}`, {
        label: 'InCinemasSync',
      });
    } finally {
      this.running = false;
    }
  }

  private checkDigitalOrPhysicalRelease(tmdbDetails: TmdbMovieDetails): boolean {
    const now = new Date();

    // 1. Check TMDB release dates for Digital (type 4) or Physical (type 5)
    if (tmdbDetails.release_dates?.results) {
      for (const country of tmdbDetails.release_dates.results) {
        for (const rel of country.release_dates || []) {
          if ((rel.type === 4 || rel.type === 5) && rel.release_date) {
            const relDate = new Date(rel.release_date);
            if (!isNaN(relDate.getTime()) && relDate <= now) {
              return true;
            }
          }
        }
      }
    }

    // 2. Check if theatrical release is older than 75 days (typical theatrical window)
    if (tmdbDetails.release_date) {
      const parts = tmdbDetails.release_date.split('-');
      const y = parseInt(parts[0], 10);
      if (!isNaN(y) && y >= 1900) {
        const m = parts.length > 1 ? parseInt(parts[1], 10) - 1 : 0;
        const d = parts.length > 2 ? parseInt(parts[2], 10) : 1;
        const relDate = new Date(y, m, d);
        const diffMs = now.getTime() - relDate.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        if (diffDays > 75) {
          return true;
        }
      }
    }

    return false;
  }
}

const inCinemasSync = new InCinemasSync();
export default inCinemasSync;

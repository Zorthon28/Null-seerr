import axios from 'axios';
import logger from '@server/logger';
import { hackstoreScraper } from '../stream/hackstoreScraper';
import { okruScraper } from '../stream/okruScraper';

export interface MovieAvailabilityResult {
  tmdbId: number;
  englishTitle: string;
  spanishTitle: string;
  year?: number;
  multiTorrentFound: boolean;
  multiTorrent?: {
    title: string;
    seeders: number;
    size: number;
  };
  streamAvailable: boolean;
  stream?: {
    source: string;
    streamUrl: string;
    quality: string;
    audio: string;
  };
  englishTorrentAvailable: boolean;
  englishTorrent?: {
    title: string;
    seeders: number;
    size: number;
  };
}

export class SmartResolver {
  private prowlarrUrl = process.env.PROWLARR_URL || 'http://prowlarr:9696';
  private prowlarrApiKey = '2093032a323244b4987f33f5387fcee5';

  public async checkMovie(
    tmdbId: number,
    englishTitle: string,
    spanishTitle: string,
    year?: number
  ): Promise<MovieAvailabilityResult> {
    const result: MovieAvailabilityResult = {
      tmdbId,
      englishTitle,
      spanishTitle,
      year,
      multiTorrentFound: false,
      streamAvailable: false,
      englishTorrentAvailable: false,
    };

    // 1. Search Prowlarr for torrent releases
    try {
      const query = year ? `${englishTitle} ${year}` : englishTitle;
      const prowlarrResponse = await axios.get(
        `${this.prowlarrUrl}/api/v1/search`,
        {
          params: {
            query,
            type: 'search',
            categories: 2000,
          },
          headers: {
            'X-Api-Key': this.prowlarrApiKey,
          },
          timeout: 25000,
        }
      );

      const releases: any[] = prowlarrResponse.data || [];

      // Filter for valid releases with seeds
      const seeded = releases.filter((r) => (r.seeders || 0) >= 1);

      // Check for true Spanish/Latino audio in torrent title
      const multiMatch = seeded.find((r) => {
        const t = String(r.title || '').toLowerCase();
        return (
          t.includes('latino') ||
          t.includes('es-latino') ||
          t.includes('audio latino') ||
          t.includes('dual latino') ||
          (t.includes('spanish') && !t.includes('sub')) ||
          (t.includes('castellano') && !t.includes('sub'))
        );
      });

      if (multiMatch) {
        result.multiTorrentFound = true;
        result.multiTorrent = {
          title: multiMatch.title,
          seeders: multiMatch.seeders,
          size: multiMatch.size,
        };
      }

      // Check best English release
      if (seeded.length > 0) {
        // Sort by seeders descending
        const sorted = [...seeded].sort(
          (a, b) => (b.seeders || 0) - (a.seeders || 0)
        );
        result.englishTorrentAvailable = true;
        result.englishTorrent = {
          title: sorted[0].title,
          seeders: sorted[0].seeders,
          size: sorted[0].size,
        };
      }
    } catch (e: any) {
      logger.warn(`[SmartResolver] Prowlarr check warning: ${e.message}`);
    }

    // 2. If no multi torrent, search Spanish stream provider
    if (!result.multiTorrentFound) {
      try {
        let stream = await hackstoreScraper.findMovieStream(
          spanishTitle,
          year
        );
        if (!stream) {
          logger.info(
            `[SmartResolver] Hackstore returned no stream for "${spanishTitle}". Trying OK.ru...`
          );
          stream = await okruScraper.searchMovie(spanishTitle, year);
          if (!stream && englishTitle && englishTitle !== spanishTitle) {
            stream = await okruScraper.searchMovie(englishTitle, year);
          }
        }

        if (stream) {
          result.streamAvailable = true;
          result.stream = {
            source: stream.source,
            streamUrl: stream.streamUrl,
            quality: stream.quality,
            audio: stream.audio,
          };
        }
      } catch (e: any) {
        logger.warn(`[SmartResolver] Stream scraper warning: ${e.message}`);
      }
    }

    return result;
  }
}

export const smartResolver = new SmartResolver();

import axios from 'axios';
import https from 'https';
import logger from '@server/logger';
import type { StreamInfo } from './hackstoreScraper';

export class OkruScraper {
  private baseUrl = 'https://ok.ru';
  private userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  private httpsAgent = new https.Agent({
    rejectUnauthorized: false,
  });

  private titleMatches(candidateTitle: string, queryTitle: string): boolean {
    const c = candidateTitle
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const q = queryTitle
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const cleanQ = q.replace(/[^a-z0-9\s]/g, ' ');
    const words = cleanQ
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 2 &&
          ![
            'pelicula',
            'latino',
            'completa',
            'audio',
            'espanol',
            'movie',
            'the',
            'los',
            'las',
            'del',
            'por',
            'con',
          ].includes(w)
      );

    if (words.length === 0) return true;
    const matches = words.filter((w) => c.includes(w));
    return matches.length >= Math.ceil(words.length * 0.5);
  }

  /**
   * Search OK.ru for Latin Spanish movie releases
   */
  public async searchMovie(
    title: string,
    year?: number
  ): Promise<StreamInfo | null> {
    const cleanTitle = title
      .replace(/[:\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const normalizedTitle = cleanTitle
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const baseTitle = title.split(/[:\-]/)[0].trim();
    const baseNormalized = baseTitle
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const titleVariants = Array.from(
      new Set([cleanTitle, normalizedTitle, baseTitle, baseNormalized])
    );

    const searchQueries: string[] = [];
    for (const tv of titleVariants) {
      if (year) searchQueries.push(`${tv} ${year} Latino`.trim());
      searchQueries.push(`${tv} Latino`.trim());
      searchQueries.push(`${tv} Español Latino`.trim());
    }

    for (const query of searchQueries) {
      try {
        const searchUrl = `${this.baseUrl}/video/search/${encodeURIComponent(query)}`;
        const response = await axios.get(searchUrl, {
          httpsAgent: this.httpsAgent,
          headers: {
            'User-Agent': this.userAgent,
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          timeout: 10000,
        });

        const html = response.data;
        if (typeof html !== 'string') continue;

        const unescaped = html
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>');

        const regex =
          /"movie":\{"href":"\/video\/(\d+)","id":"\d+","provider":"[^"]*","title":"([^"]+)"/g;
        let match;
        const candidates: { id: string; title: string }[] = [];

        while ((match = regex.exec(unescaped)) !== null) {
          const id = match[1];
          const videoTitle = match[2];
          candidates.push({ id, title: videoTitle });
        }

        logger.debug(
          `[OkruScraper] Query "${query}" returned ${candidates.length} candidates`
        );

        for (const candidate of candidates) {
          const lowerTitle = candidate.title.toLowerCase();
          const isLatino =
            lowerTitle.includes('latino') ||
            lowerTitle.includes('audio latino') ||
            lowerTitle.includes('español latino') ||
            lowerTitle.includes('es-latino');

          if (!isLatino) continue;
          if (
            !this.titleMatches(candidate.title, cleanTitle) &&
            !this.titleMatches(candidate.title, baseTitle)
          ) {
            continue;
          }

          const stream = await this.getVideoStream(candidate.id, year);
          if (stream) {
            return stream;
          }
        }
      } catch (e: any) {
        logger.debug(
          `[OkruScraper] Search error for query "${query}": ${e.message}`
        );
      }
    }

    return null;
  }

  /**
   * Extract video stream from an OK.ru video ID or full URL
   */
  public async getVideoStream(
    videoIdOrUrl: string,
    year?: number
  ): Promise<StreamInfo | null> {
    try {
      const videoIdMatch = videoIdOrUrl.match(/(\d{10,16})/);
      if (!videoIdMatch) return null;
      const videoId = videoIdMatch[1];

      const embedUrl = `${this.baseUrl}/videoembed/${videoId}`;
      const response = await axios.get(embedUrl, {
        httpsAgent: this.httpsAgent,
        headers: {
          'User-Agent': this.userAgent,
          Referer: `${this.baseUrl}/`,
        },
        timeout: 10000,
      });

      const html = response.data;
      if (typeof html !== 'string') return null;

      const dataOptsMatch = html.match(/data-options="([^"]+)"/);
      if (!dataOptsMatch) return null;

      const unescaped = dataOptsMatch[1]
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');

      const parsed = JSON.parse(unescaped);
      let meta = parsed.flashvars?.metadata;
      if (typeof meta === 'string') {
        meta = JSON.parse(meta);
      }

      if (!meta) return null;

      const duration = Number(meta.movie?.duration || 0);
      if (duration < 2700) {
        logger.debug(
          `[OkruScraper] Video ${videoId} duration is only ${duration}s (< 45m), skipping`
        );
        return null;
      }

      const movieTitle = meta.movie?.title || 'Movie';
      const videos: { name: string; url: string }[] = meta.videos || [];
      if (videos.length === 0) return null;

      const qualityPriority = ['full', 'hd', 'sd', 'low', 'lowest'];
      videos.sort((a, b) => {
        const aIdx = qualityPriority.indexOf(a.name.toLowerCase());
        const bIdx = qualityPriority.indexOf(b.name.toLowerCase());
        return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
      });

      const best = videos[0];
      const qualityLabel =
        best.name.toLowerCase() === 'full'
          ? '1080p/720p'
          : best.name.toUpperCase();

      return {
        source: 'OK.ru (Audio Latino)',
        streamUrl: best.url,
        quality: qualityLabel,
        audio: 'Español Latino',
        title: movieTitle,
        year,
      };
    } catch (e: any) {
      logger.error(
        `[OkruScraper] Error getting stream for ${videoIdOrUrl}: ${e.message}`
      );
      return null;
    }
  }
}

export const okruScraper = new OkruScraper();

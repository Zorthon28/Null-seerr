import axios from 'axios';
import logger from '@server/logger';

export interface StreamInfo {
  source: string;
  streamUrl: string;
  subtitlesUrl?: string;
  quality: string;
  audio: string;
  title: string;
  year?: number;
}

export class HackstoreScraper {
  private baseUrl = 'https://hackstore.mx';
  private userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  private unpack(p: string, a: number, c: number, k: string[]): string {
    const baseN = (num: number, b: number): string => {
      const digits =
        '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      let res = '';
      while (num > 0) {
        res = digits[num % b] + res;
        num = Math.floor(num / b);
      }
      return res || '0';
    };

    const lookup: Record<string, string> = {};
    for (let i = 0; i < c; i++) {
      const key = baseN(i, a);
      lookup[key] = k[i] && k[i].length > 0 ? k[i] : key;
    }

    return p.replace(/\b\w+\b/g, (w) => lookup[w] ?? w);
  }

  public async searchMovie(
    query: string,
    year?: number
  ): Promise<{ id: number; title: string; slug: string } | null> {
    try {
      const cleanQuery = query.replace(/[^\w\s]/gi, ' ').trim();
      const searchUrl = `${this.baseUrl}/wp-api/v1/search`;
      const response = await axios.get(searchUrl, {
        params: {
          q: cleanQuery,
          postType: 'movies',
          postsPerPage: 10,
        },
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        timeout: 10000,
      });

      const posts: any[] = response.data?.data?.posts || [];
      if (!posts || posts.length === 0) {
        logger.info(`[Hackstore] No results for search query: ${cleanQuery}`);
        return null;
      }

      // Try exact year match if year provided
      if (year) {
        const matchYear = posts.find((p) => {
          const t = String(p.title || '');
          const y = String(p.release_date || '');
          return t.includes(`(${year})`) || y.startsWith(String(year));
        });
        if (matchYear) {
          return {
            id: matchYear._id,
            title: matchYear.title,
            slug: matchYear.slug,
          };
        }
      }

      return {
        id: posts[0]._id,
        title: posts[0].title,
        slug: posts[0].slug,
      };
    } catch (e: any) {
      logger.error(`[Hackstore] Error searching movie: ${e.message}`);
      return null;
    }
  }

  public async getPlayerEmbeds(postId: number): Promise<string[]> {
    try {
      const playerUrl = `${this.baseUrl}/wp-api/v1/player`;
      const response = await axios.get(playerUrl, {
        params: {
          postId,
          demo: 0,
        },
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'application/json',
        },
        timeout: 10000,
      });

      const embeds: any[] = response.data?.data?.embeds || [];
      return embeds.map((e) => e.url).filter(Boolean);
    } catch (e: any) {
      logger.error(`[Hackstore] Error fetching player embeds: ${e.message}`);
      return [];
    }
  }

  public async extractStreamFromEmbed(embedUrl: string): Promise<StreamInfo | null> {
    try {
      const response = await axios.get(embedUrl, {
        headers: {
          'User-Agent': this.userAgent,
          Referer: `${this.baseUrl}/`,
        },
        timeout: 15000,
      });

      const html = response.data;
      if (typeof html !== 'string') return null;

      // Check for Dean Edwards packed JS
      const match = html.match(
        /eval\(function\(p,a,c,k,e,d\)\{.*?\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)/s
      );

      if (match) {
        const p = match[1];
        const a = parseInt(match[2], 10);
        const c = parseInt(match[3], 10);
        const k = match[4].split('|');
        const unpacked = this.unpack(p, a, c, k);

        // Find direct m3u8
        const m3u8Matches = unpacked.match(
          /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g
        );

        if (m3u8Matches && m3u8Matches.length > 0) {
          const masterUrl = m3u8Matches[0];
          // For vimeos, index-v1-a1.m3u8 is the 720p stream with Spanish audio
          let directStream = masterUrl;
          if (masterUrl.includes('master.m3u8')) {
            directStream = masterUrl.replace(
              '_,n,h,.urlset/master.m3u8',
              '_h/index-v1-a1.m3u8'
            );
          }

          return {
            source: 'Hackstore (Vimeos)',
            streamUrl: directStream,
            quality: '720p HD',
            audio: 'Español Latino',
            title: '',
          };
        }
      }

      // Check for raw direct m3u8/mp4
      const rawM3u8 = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
      if (rawM3u8) {
        return {
          source: 'Hackstore',
          streamUrl: rawM3u8[0],
          quality: 'HD',
          audio: 'Español Latino',
          title: '',
        };
      }

      return null;
    } catch (e: any) {
      logger.error(
        `[Hackstore] Error extracting stream from embed ${embedUrl}: ${e.message}`
      );
      return null;
    }
  }

  public async findMovieStream(
    spanishTitle: string,
    year?: number
  ): Promise<StreamInfo | null> {
    const movie = await this.searchMovie(spanishTitle, year);
    if (!movie) return null;

    const embeds = await this.getPlayerEmbeds(movie.id);
    for (const embed of embeds) {
      const stream = await this.extractStreamFromEmbed(embed);
      if (stream) {
        stream.title = movie.title;
        stream.year = year;
        return stream;
      }
    }

    return null;
  }
}

export const hackstoreScraper = new HackstoreScraper();

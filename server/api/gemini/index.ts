import axios from 'axios';
import logger from '@server/logger';
import NodeCache from 'node-cache';
import { getSettings } from '@server/lib/settings';

export interface GeminiRecommendationItem {
  title: string;
  mediaType: 'movie' | 'tv';
  year?: number;
  basedOn: string;
  reason: string;
}

export interface GeminiRecommendationResponse {
  recommendations: GeminiRecommendationItem[];
}

class GeminiAPI {
  private cache: NodeCache;
  private candidateModels = [
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-flash-latest',
  ];

  constructor() {
    // 6-hour TTL for recommendations cache (21600 seconds)
    this.cache = new NodeCache({ stdTTL: 21600, checkperiod: 600 });
  }

  public getApiKey(): string | undefined {
    return process.env.GEMINI_API_KEY || getSettings().main.geminiApiKey;
  }

  public isConfigured(): boolean {
    return Boolean(this.getApiKey());
  }

  public clearCache(): void {
    this.cache.flushAll();
  }

  public async getRecommendations(params: {
    likedTitles: { title: string; mediaType: 'movie' | 'tv' }[];
    watchedTitles: { title: string; mediaType: 'movie' | 'tv' }[];
    limit?: number;
    cacheKey?: string;
  }): Promise<GeminiRecommendationItem[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return [];
    }

    if (params.cacheKey && this.cache.has(params.cacheKey)) {
      logger.debug('Returning cached Gemini recommendations', {
        label: 'Gemini',
      });
      return this.cache.get<GeminiRecommendationItem[]>(params.cacheKey) || [];
    }

    const likedStr = params.likedTitles
      .slice(0, 15)
      .map((t) => `${t.title} (${t.mediaType.toUpperCase()})`)
      .join(', ');

    const watchedStr = params.watchedTitles
      .slice(0, 15)
      .map((t) => `${t.title} (${t.mediaType.toUpperCase()})`)
      .join(', ');

    if (!likedStr && !watchedStr) {
      return [];
    }

    const limit = params.limit || 16;
    const prompt = `You are a world-class film critic and entertainment curator powering an AI recommendation engine.
Analyze the user's favorite and recently enjoyed media:
- LIKED FAVORITES: ${likedStr || 'None'}
- RECENTLY WATCHED: ${watchedStr || 'None'}

Your Task:
Deeply examine their narrative tone, pacing, humor style (such as deadpan, mockumentary, satire, dark comedy, subtle wit), cinematography, aesthetic vibe, emotional weight, and character dynamics.
Generate ${limit} top-tier, high-conviction recommendations (a balanced mix of movies and TV series).

Key Instructions:
1. Prioritize stylistic and thematic cousins, cult classics, and acclaimed hidden gems over obvious generic blockbusters.
2. DO NOT recommend any titles that are already in their favorites or watched lists above.
3. Every recommendation MUST clearly specify which user favorite inspired it ("basedOn") and a concise, insightful explanation of the stylistic/tonal connection ("reason").
4. Respond ONLY with a valid JSON object matching this exact schema:
{
  "recommendations": [
    {
      "title": "Exact Title",
      "mediaType": "movie" | "tv",
      "year": 2021,
      "basedOn": "The specific user favorite it connects to",
      "reason": "1-2 sentence compelling rationale explaining the exact humor, tone, or narrative parallel"
    }
  ]
}`;

    for (const model of this.candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await axios.post(
          url,
          {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.7,
            },
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000,
          }
        );

        const rawText =
          response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) continue;

        const parsed = JSON.parse(rawText) as GeminiRecommendationResponse;
        if (
          Array.isArray(parsed?.recommendations) &&
          parsed.recommendations.length > 0
        ) {
          logger.info(
            `Generated ${parsed.recommendations.length} recommendations using Gemini (${model})`,
            {
              label: 'Gemini',
            }
          );

          if (params.cacheKey) {
            this.cache.set(params.cacheKey, parsed.recommendations);
          }
          return parsed.recommendations;
        }
      } catch (err: any) {
        logger.warn(
          `Gemini model ${model} attempt failed: ${
            err.response?.data?.error?.message || err.message
          }`,
          {
            label: 'Gemini',
          }
        );
      }
    }

    return [];
  }
}

export default new GeminiAPI();

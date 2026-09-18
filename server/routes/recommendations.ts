import SuggestarrAPI from '@server/api/suggestarr';
import TheMovieDb from '@server/api/themoviedb';
import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
import type {
  TmdbKeyword,
  TmdbMovieResult,
  TmdbTvResult,
} from '@server/api/themoviedb/interfaces';
import { MediaType } from '@server/constants/media';
import Media from '@server/entity/Media';
import logger from '@server/logger';
import { mapMovieResult, mapTvResult } from '@server/models/Search';
import { Router } from 'express';

const recommendationRoutes = Router();
const suggestarrApi = new SuggestarrAPI();

export interface SmartRecommendationItem {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  originalTitle?: string;
  overview: string;
  posterPath?: string;
  backdropPath?: string;
  releaseDate?: string;
  voteAverage: number;
  voteCount: number;
  matchScore: number;
  matchReasons: string[];
  mediaInfo?: Media;
}

// Helper keywords for smart affinity mapping
const THEMATIC_TAGS: Record<string, string> = {
  romance: 'Romance',
  'slice of life': 'Slice of Life',
  workplace: 'Ambiente Laboral / Adulto',
  office: 'Romance de Oficina',
  comedy: 'Comedia Ligera',
  iyashikei: 'Tono Relajante (Iyashikei)',
  seinen: 'Demografía Seinen',
  food: 'Gastronomía / Tienda',
  supermarket: 'Vida Cotidiana',
  'romantic comedy': 'Comedia Romántica',
};

// GET /api/v1/recommendations/smart/:type/:id
recommendationRoutes.get('/smart/:type/:id', async (req, res, next) => {
  const tmdb = new TheMovieDb();
  const mediaType: 'movie' | 'tv' =
    req.params.type === 'movie' ? 'movie' : 'tv';
  const targetId = Number(req.params.id);

  if (!targetId || isNaN(targetId)) {
    return next({
      status: 400,
      message: 'Invalid media ID.',
    });
  }

  try {
    const rawCandidates: Map<
      number,
      {
        item: TmdbTvResult | TmdbMovieResult;
        scoreBonus: number;
        reasons: Set<string>;
      }
    > = new Map();

    // 1. Fetch source details & keywords to understand genre & themes
    let sourceKeywords: string[] = [];
    let isAnime = false;
    let sourceGenreIds: number[] = [];

    if (mediaType === 'tv') {
      try {
        const sourceShow = await tmdb.getTvShow({ tvId: targetId });
        sourceGenreIds = (sourceShow.genres || []).map((g) => g.id);
        const kwList = sourceShow.keywords?.results || [];
        isAnime = kwList.some((k: TmdbKeyword) => k.id === ANIME_KEYWORD_ID);
        sourceKeywords = kwList.map((k: TmdbKeyword) => k.name.toLowerCase());
      } catch (err) {
        logger.debug('Could not fetch source show keywords', {
          label: 'Recommendations',
          targetId,
          error: err.message,
        });
      }
    } else {
      try {
        const sourceMovie = await tmdb.getMovie({ movieId: targetId });
        sourceGenreIds = (sourceMovie.genres || []).map((g) => g.id);
        const kwList = sourceMovie.keywords?.keywords || [];
        isAnime = kwList.some((k: TmdbKeyword) => k.id === ANIME_KEYWORD_ID);
        sourceKeywords = kwList.map((k: TmdbKeyword) => k.name.toLowerCase());
      } catch (err) {
        logger.debug('Could not fetch source movie keywords', {
          label: 'Recommendations',
          targetId,
          error: err.message,
        });
      }
    }

    // 2. Fetch TMDB Recommendations
    try {
      const recs =
        mediaType === 'tv'
          ? await tmdb.getTvRecommendations({ tvId: targetId, page: 1 })
          : await tmdb.getMovieRecommendations({ movieId: targetId, page: 1 });

      for (const rec of recs.results) {
        if (rec.id === targetId) continue;
        rawCandidates.set(rec.id, {
          item: rec,
          scoreBonus: 15,
          reasons: new Set(['Alta coincidencia de audiencia']),
        });
      }
    } catch (e) {
      logger.debug('Error getting TMDB recommendations', {
        label: 'Recommendations',
        error: e.message,
      });
    }

    // 3. Fetch TMDB Similar
    try {
      const similars =
        mediaType === 'tv'
          ? await tmdb.getTvSimilar({ tvId: targetId, page: 1 })
          : await tmdb.getMovieSimilar({ movieId: targetId, page: 1 });

      for (const sim of similars.results) {
        if (sim.id === targetId) continue;
        const existing = rawCandidates.get(sim.id);
        if (existing) {
          existing.scoreBonus += 10;
          existing.reasons.add('Temática y estructura similar');
        } else {
          rawCandidates.set(sim.id, {
            item: sim,
            scoreBonus: 10,
            reasons: new Set(['Temática y estructura similar']),
          });
        }
      }
    } catch (e) {
      logger.debug('Error getting TMDB similar', {
        label: 'Recommendations',
        error: e.message,
      });
    }

    // 4. Incorporate Suggestarr suggestions & job preview
    try {
      const suggestarrItems = await suggestarrApi.getJobPreview(1);
      for (const sItem of suggestarrItems) {
        const sTmdbId = Number(sItem.tmdb_id);
        if (sTmdbId && sTmdbId !== targetId) {
          const existing = rawCandidates.get(sTmdbId);
          if (existing) {
            existing.scoreBonus += 25;
            existing.reasons.add('Recomendado por Suggestarr AI');
          } else {
            // Fetch TMDB card details for this suggestarr item if not already in candidate list
            try {
              if (sItem.media_type === 'tv' && mediaType === 'tv') {
                const show = await tmdb.getTvShow({ tvId: sTmdbId });
                rawCandidates.set(sTmdbId, {
                  item: {
                    id: show.id,
                    name: show.name,
                    original_name: show.original_name,
                    overview: show.overview,
                    poster_path: show.poster_path,
                    backdrop_path: show.backdrop_path,
                    vote_average: show.vote_average,
                    vote_count: show.vote_count,
                    first_air_date: show.first_air_date,
                    genre_ids: (show.genres || []).map((g) => g.id),
                    origin_country: show.origin_country || [],
                    popularity: show.popularity || 10,
                    original_language: show.original_language,
                  } as TmdbTvResult,
                  scoreBonus: 25,
                  reasons: new Set(['Recomendado por Suggestarr AI']),
                });
              }
            } catch {
              // Ignore single item fetch failure
            }
          }
        }
      }
    } catch (err) {
      logger.debug('Suggestarr preview integration skipped', {
        label: 'Recommendations',
        error: err.message,
      });
    }

    // 5. Compute final match scores and format results
    const candidateList = Array.from(rawCandidates.values());

    // Fetch related media info from DB
    const mediaEntities = await Media.getRelatedMedia(
      req.user,
      candidateList.map((c) => ({
        tmdbId: c.item.id,
        mediaType:
          mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV,
      }))
    );

    const scoredResults: SmartRecommendationItem[] = candidateList
      .map(({ item, scoreBonus, reasons }) => {
        let baseScore = 70;

        // Rating contribution (up to 15 pts)
        if (item.vote_average) {
          baseScore += Math.min(15, Math.round(item.vote_average * 1.5));
        }

        // Shared genres check
        const itemGenreIds = item.genre_ids || [];
        const sharedGenres = itemGenreIds.filter((gid) =>
          sourceGenreIds.includes(gid)
        );
        if (sharedGenres.length > 0) {
          baseScore += Math.min(10, sharedGenres.length * 4);
          reasons.add('Género coincidente');
        }

        // Anime theme tags
        if (isAnime) {
          reasons.add('Anime');
        }

        const title = (item as TmdbTvResult).name || (item as TmdbMovieResult).title || '';
        const originalTitle =
          (item as TmdbTvResult).original_name ||
          (item as TmdbMovieResult).original_title;
        const releaseDate =
          (item as TmdbTvResult).first_air_date ||
          (item as TmdbMovieResult).release_date;

        const finalScore = Math.min(99, Math.max(75, baseScore + scoreBonus));

        const matchedMedia = mediaEntities.find(
          (m) =>
            m.tmdbId === item.id &&
            m.mediaType ===
              (mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV)
        );

        return {
          id: item.id,
          mediaType,
          title,
          originalTitle,
          overview: item.overview || '',
          posterPath: item.poster_path,
          backdropPath: item.backdrop_path,
          releaseDate,
          voteAverage: item.vote_average || 0,
          voteCount: item.vote_count || 0,
          matchScore: finalScore,
          matchReasons: Array.from(reasons),
          mediaInfo: matchedMedia,
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 16);

    return res.status(200).json({
      targetId,
      mediaType,
      totalResults: scoredResults.length,
      results: scoredResults,
    });
  } catch (e) {
    logger.error('Failed to generate smart recommendations', {
      label: 'Recommendations',
      targetId,
      mediaType,
      error: e.message,
    });
    return next({
      status: 500,
      message: 'Failed to generate recommendations.',
    });
  }
});

// GET /api/v1/recommendations/suggestarr
recommendationRoutes.get('/suggestarr', async (req, res, next) => {
  try {
    const status = await suggestarrApi.getStatus();
    const suggestionsResp = await suggestarrApi.getSuggestions({
      perPage: 30,
      status: 'all',
    });

    return res.status(200).json({
      serviceStatus: status,
      suggestions: suggestionsResp.data,
      meta: suggestionsResp.meta,
    });
  } catch (e) {
    logger.debug('Error in suggestarr route', {
      label: 'Recommendations',
      error: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve Suggestarr suggestions.',
    });
  }
});

// POST /api/v1/recommendations/suggestarr/sync
recommendationRoutes.post('/suggestarr/sync', async (_req, res, next) => {
  try {
    const triggered = await suggestarrApi.triggerJobRun(1);
    return res.status(200).json({
      success: triggered,
      message: triggered
        ? 'Suggestarr recommendation job triggered successfully.'
        : 'Failed to trigger Suggestarr job.',
    });
  } catch (e) {
    logger.error('Error triggering suggestarr job', {
      label: 'Recommendations',
      error: e.message,
    });
    return next({
      status: 500,
      message: 'Failed to sync with Suggestarr.',
    });
  }
});

export default recommendationRoutes;

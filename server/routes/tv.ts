import { getMetadataProvider } from '@server/api/metadata';
import RottenTomatoes from '@server/api/rating/rottentomatoes';
import TheMovieDb from '@server/api/themoviedb';
import { ANIME_KEYWORD_ID } from '@server/api/themoviedb/constants';
import type { TmdbKeyword } from '@server/api/themoviedb/interfaces';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { Liked } from '@server/entity/Liked';
import { Watchlist } from '@server/entity/Watchlist';
import logger from '@server/logger';
import { mapTvResult } from '@server/models/Search';
import { mapSeasonWithEpisodes, mapTvDetails } from '@server/models/Tv';
import streamHistory from '@server/lib/stream/streamHistory';
import { Router } from 'express';

const tvRoutes = Router();

tvRoutes.get('/:id', async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const tmdbTv = await tmdb.getTvShow({
      tvId: Number(req.params.id),
    });
    const metadataProvider = tmdbTv.keywords.results.some(
      (keyword: TmdbKeyword) => keyword.id === ANIME_KEYWORD_ID
    )
      ? await getMetadataProvider('anime')
      : await getMetadataProvider('tv');
    const tv = await metadataProvider.getTvShow({
      tvId: Number(req.params.id),
      language: (req.query.language as string) ?? req.locale,
    });
    const media = await Media.getMedia(tv.id, MediaType.TV);

    const onUserWatchlist = await getRepository(Watchlist).exist({
      where: {
        tmdbId: Number(req.params.id),
        mediaType: MediaType.TV,
        requestedBy: {
          id: req.user?.id,
        },
      },
    });

    const streamInfo = await streamHistory.getStreamInfo(
      tv.id,
      tv.name,
      tv.first_air_date ? parseInt(tv.first_air_date.slice(0, 4), 10) : undefined
    );

    const data = mapTvDetails(tv, media, onUserWatchlist, streamInfo);

    // Placeholder for Saga of Tanya the Evil Season 3 (franchise continuation confirmed, release date TBA)
    if (data.id === 69346 && !data.seasons.some((s) => s.seasonNumber === 3)) {
      data.seasons.push({
        id: 69346 * 1000 + 3,
        airDate: '',
        episodeCount: 0,
        name: 'Season 3',
        overview:
          'Season 3 has been confirmed for the franchise. Release date is coming soon.',
        seasonNumber: 3,
      });
      data.numberOfSeasons = Math.max(data.numberOfSeasons, 3);
    }

    // TMDB issue where it doesnt fallback to English when no overview is available in requested locale.
    if (!data.overview) {
      const tvEnglish = await metadataProvider.getTvShow({
        tvId: Number(req.params.id),
      });
      data.overview = tvEnglish.overview;
    }

    if (req.user?.id) {
      if (req.query.basedOn) {
        data.recommendedBecauseLiked = String(req.query.basedOn);
      } else {
        try {
          const likedItems = await getRepository(Liked).find({
            where: { userId: req.user.id },
          });
          if (likedItems.length > 0) {
            const recs = await tmdb
              .getTvRecommendations({
                tvId: Number(req.params.id),
              })
              .catch(() => ({ results: [] }));
            const match = recs.results?.find((r) =>
              likedItems.some(
                (l) => l.mediaType === MediaType.TV && l.tmdbId === r.id
              )
            );
            if (match) {
              const liked = likedItems.find(
                (l) => l.mediaType === MediaType.TV && l.tmdbId === match.id
              );
              data.recommendedBecauseLiked =
                liked?.title || (match as any).name || (match as any).title;
            }
          }
        } catch {
          // Continue
        }
      }
    }

    res.setHeader(
      'Cache-Control',
      'private, max-age=60, stale-while-revalidate=180'
    );
    return res.status(200).json(data);
  } catch (e) {
    logger.debug('Something went wrong retrieving series', {
      label: 'API',
      errorMessage: e.message,
      tvId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve series.',
    });
  }
});

tvRoutes.get('/:id/season/:seasonNumber', async (req, res, next) => {
  if (
    Number(req.params.id) === 69346 &&
    Number(req.params.seasonNumber) === 3
  ) {
    res.setHeader(
      'Cache-Control',
      'public, max-age=300, stale-while-revalidate=600'
    );
    return res.status(200).json({
      airDate: null,
      id: 69346 * 1000 + 3,
      name: 'Season 3',
      overview:
        'Season 3 has been confirmed for the franchise. Release date is coming soon.',
      seasonNumber: 3,
      episodes: [],
      externalIds: {},
    });
  }

  try {
    const tmdb = new TheMovieDb();
    const tmdbTv = await tmdb.getTvShow({
      tvId: Number(req.params.id),
    });
    const metadataProvider = tmdbTv.keywords.results.some(
      (keyword: TmdbKeyword) => keyword.id === ANIME_KEYWORD_ID
    )
      ? await getMetadataProvider('anime')
      : await getMetadataProvider('tv');

    const season = await metadataProvider.getTvSeason({
      tvId: Number(req.params.id),
      seasonNumber: Number(req.params.seasonNumber),
      language: (req.query.language as string) ?? req.locale,
    });

    res.setHeader(
      'Cache-Control',
      'public, max-age=300, stale-while-revalidate=600'
    );
    return res.status(200).json(mapSeasonWithEpisodes(season));
  } catch (e) {
    logger.debug('Something went wrong retrieving season', {
      label: 'API',
      errorMessage: e.message,
      tvId: req.params.id,
      seasonNumber: req.params.seasonNumber,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve season.',
    });
  }
});

tvRoutes.get('/:id/recommendations', async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const results = await tmdb.getTvRecommendations({
      tvId: Number(req.params.id),
      page: Number(req.query.page),
      language: (req.query.language as string) ?? req.locale,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      results.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.TV,
      }))
    );

    res.setHeader(
      'Cache-Control',
      'public, max-age=300, stale-while-revalidate=600'
    );
    return res.status(200).json({
      page: results.page,
      totalPages: results.total_pages,
      totalResults: results.total_results,
      results: results.results.map((result) =>
        mapTvResult(
          result,
          media.find(
            (req) => req.tmdbId === result.id && req.mediaType === MediaType.TV
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving series recommendations', {
      label: 'API',
      errorMessage: e.message,
      tvId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve series recommendations.',
    });
  }
});

tvRoutes.get('/:id/similar', async (req, res, next) => {
  const tmdb = new TheMovieDb();

  try {
    const results = await tmdb.getTvSimilar({
      tvId: Number(req.params.id),
      page: Number(req.query.page),
      language: (req.query.language as string) ?? req.locale,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      results.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.TV,
      }))
    );

    res.setHeader(
      'Cache-Control',
      'public, max-age=300, stale-while-revalidate=600'
    );
    return res.status(200).json({
      page: results.page,
      totalPages: results.total_pages,
      totalResults: results.total_results,
      results: results.results.map((result) =>
        mapTvResult(
          result,
          media.find(
            (req) => req.tmdbId === result.id && req.mediaType === MediaType.TV
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving similar series', {
      label: 'API',
      errorMessage: e.message,
      tvId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve similar series.',
    });
  }
});

tvRoutes.get('/:id/ratings', async (req, res, next) => {
  const tmdb = new TheMovieDb();
  const rtapi = new RottenTomatoes();

  try {
    const tv = await tmdb.getTvShow({
      tvId: Number(req.params.id),
    });

    const rtratings = await rtapi.getTVRatings(
      tv.name,
      tv.first_air_date ? Number(tv.first_air_date.slice(0, 4)) : undefined
    );

    if (!rtratings) {
      return next({
        status: 404,
        message: 'Rotten Tomatoes ratings not found.',
      });
    }

    res.setHeader(
      'Cache-Control',
      'public, max-age=1800, stale-while-revalidate=3600'
    );
    return res.status(200).json(rtratings);
  } catch (e) {
    logger.debug('Something went wrong retrieving series ratings', {
      label: 'API',
      errorMessage: e.message,
      tvId: req.params.id,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve series ratings.',
    });
  }
});

export default tvRoutes;

import PlexTvAPI from '@server/api/plextv';
import SuggestarrAPI from '@server/api/suggestarr';
import type { SortOptions } from '@server/api/themoviedb';
import TheMovieDb from '@server/api/themoviedb';
import type { TmdbKeyword } from '@server/api/themoviedb/interfaces';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import { Watched } from '@server/entity/Watched';
import { Watchlist } from '@server/entity/Watchlist';
import { Liked } from '@server/entity/Liked';
import { DismissedRecommendation } from '@server/entity/DismissedRecommendation';
import axios from 'axios';
import type {
  GenreSliderItem,
  WatchlistResponse,
} from '@server/interfaces/api/discoverInterfaces';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { mapProductionCompany } from '@server/models/Movie';
import {
  mapCollectionResult,
  mapMovieResult,
  mapPersonResult,
  mapTvResult,
} from '@server/models/Search';
import { mapNetwork } from '@server/models/Tv';
import { isCollection, isMovie, isPerson } from '@server/utils/typeHelpers';
import RottenTomatoes from '@server/api/rating/rottentomatoes';
import IMDBRadarrProxy from '@server/api/rating/imdbRadarrProxy';
import type { RatingResponse } from '@server/api/ratings';
import { Router } from 'express';
import { sortBy } from 'lodash';
import { z } from 'zod';

export const createTmdbWithRegionLanguage = (user?: User): TheMovieDb => {
  const settings = getSettings();

  const discoverRegion =
    user?.settings?.streamingRegion === 'all'
      ? ''
      : user?.settings?.streamingRegion
        ? user?.settings?.streamingRegion
        : settings.main.discoverRegion;

  const originalLanguage =
    user?.settings?.originalLanguage === 'all'
      ? ''
      : user?.settings?.originalLanguage
        ? user?.settings?.originalLanguage
        : settings.main.originalLanguage;

  return new TheMovieDb({
    discoverRegion,
    originalLanguage,
  });
};

export const createTmdbWithBlocklistSettings = (): TheMovieDb => {
  const settings = getSettings();

  return new TheMovieDb({
    discoverRegion: settings.main.blocklistRegion,
    originalLanguage: settings.main.blocklistLanguage,
  });
};

const discoverRoutes = Router();

discoverRoutes.use((req, res, next) => {
  if (req.method === 'GET' && !res.getHeader('Cache-Control')) {
    if (req.path.includes('/watchlist')) {
      res.setHeader('Cache-Control', 'private, no-cache');
    } else {
      res.setHeader(
        'Cache-Control',
        'private, max-age=60, stale-while-revalidate=180'
      );
    }
  }
  next();
});

const QueryFilterOptions = z.object({
  page: z.coerce.string().optional(),
  sortBy: z.coerce.string().optional(),
  primaryReleaseDateGte: z.coerce.string().optional(),
  primaryReleaseDateLte: z.coerce.string().optional(),
  firstAirDateGte: z.coerce.string().optional(),
  firstAirDateLte: z.coerce.string().optional(),
  studio: z.coerce.string().optional(),
  genre: z.coerce.string().optional(),
  keywords: z.coerce.string().optional(),
  excludeKeywords: z.coerce.string().optional(),
  language: z.coerce.string().optional(),
  withRuntimeGte: z.coerce.string().optional(),
  withRuntimeLte: z.coerce.string().optional(),
  voteAverageGte: z.coerce.string().optional(),
  voteAverageLte: z.coerce.string().optional(),
  voteCountGte: z.coerce.string().optional(),
  voteCountLte: z.coerce.string().optional(),
  network: z.coerce.string().optional(),
  watchProviders: z.coerce.string().optional(),
  watchRegion: z.coerce.string().optional(),
  status: z.coerce.string().optional(),
  certification: z.coerce.string().optional(),
  certificationGte: z.coerce.string().optional(),
  certificationLte: z.coerce.string().optional(),
  certificationCountry: z.coerce.string().optional(),
  certificationMode: z.enum(['exact', 'range']).optional(),
  rtScoreGte: z.coerce.string().optional(),
  imdbScoreGte: z.coerce.string().optional(),
});

export type FilterOptions = z.infer<typeof QueryFilterOptions>;
const ApiQuerySchema = QueryFilterOptions.omit({
  certificationMode: true,
});

discoverRoutes.get('/movies', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const query = ApiQuerySchema.parse(req.query);
    const keywords = query.keywords;
    const excludeKeywords = query.excludeKeywords;

    let effectiveVoteCountGte = query.voteCountGte;
    if (query.sortBy?.includes('vote_average') && !effectiveVoteCountGte) {
      effectiveVoteCountGte = '100';
    }

    const data = await tmdb.getDiscoverMovies({
      page: Number(query.page),
      sortBy: query.sortBy as SortOptions,
      language: req.locale ?? query.language,
      originalLanguage: query.language,
      genre: query.genre,
      studio: query.studio,
      primaryReleaseDateLte: query.primaryReleaseDateLte
        ? new Date(query.primaryReleaseDateLte).toISOString().split('T')[0]
        : undefined,
      primaryReleaseDateGte: query.primaryReleaseDateGte
        ? new Date(query.primaryReleaseDateGte).toISOString().split('T')[0]
        : undefined,
      keywords,
      excludeKeywords,
      withRuntimeGte: query.withRuntimeGte,
      withRuntimeLte: query.withRuntimeLte,
      voteAverageGte: query.voteAverageGte,
      voteAverageLte: query.voteAverageLte,
      voteCountGte: effectiveVoteCountGte,
      voteCountLte: query.voteCountLte,
      watchProviders: query.watchProviders,
      watchRegion: query.watchRegion,
      certification: query.certification,
      certificationGte: query.certificationGte,
      certificationLte: query.certificationLte,
      certificationCountry: query.certificationCountry,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.MOVIE,
      }))
    );

    let keywordData: TmdbKeyword[] = [];
    if (keywords) {
      const splitKeywords = keywords.split(',');

      const keywordResults = await Promise.all(
        splitKeywords.map(async (keywordId) => {
          return await tmdb.getKeywordDetails({ keywordId: Number(keywordId) });
        })
      );

      keywordData = keywordResults.filter(
        (keyword): keyword is TmdbKeyword => keyword !== null
      );
    }

    const rtScoreGte = query.rtScoreGte ? Number(query.rtScoreGte) : undefined;
    const imdbScoreGte = query.imdbScoreGte ? Number(query.imdbScoreGte) : undefined;

    let resultsWithRatings: {
      result: (typeof data.results)[number];
      ratings?: RatingResponse;
    }[] = data.results.map((result) => ({ result }));

    if (rtScoreGte !== undefined || imdbScoreGte !== undefined) {
      const rtapi = new RottenTomatoes();
      const imdbApi = new IMDBRadarrProxy();

      const enriched = await Promise.all(
        data.results.map(async (result) => {
          const year = result.release_date
            ? Number(result.release_date.slice(0, 4))
            : undefined;
          let rt = null;
          let imdb = null;

          if (year) {
            try {
              rt = await rtapi.getMovieRatings(result.title, year);
            } catch {
              // best-effort
            }
          }

          if (imdbScoreGte !== undefined) {
            try {
              const fullMovie = await tmdb.getMovie({ movieId: result.id });
              if (fullMovie.imdb_id) {
                imdb = await imdbApi.getMovieRatings(fullMovie.imdb_id);
              }
            } catch {
              // best-effort
            }
          }

          const ratings: RatingResponse = {
            ...(rt ? { rt } : {}),
            ...(imdb ? { imdb } : {}),
          };

          return { result, ratings };
        })
      );

      resultsWithRatings = enriched.filter(({ ratings }) => {
        if (rtScoreGte !== undefined) {
          if (!ratings?.rt?.criticsScore || ratings.rt.criticsScore < rtScoreGte) {
            return false;
          }
        }
        if (imdbScoreGte !== undefined) {
          if (!ratings?.imdb?.criticsScore || ratings.imdb.criticsScore < imdbScoreGte) {
            return false;
          }
        }
        return true;
      });
    }

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      keywords: keywordData,
      results: resultsWithRatings.map(({ result, ratings }) =>
        mapMovieResult(
          result,
          media.find(
            (req) =>
              req.tmdbId === result.id && req.mediaType === MediaType.MOVIE
          ),
          ratings
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving popular movies', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve popular movies.',
    });
  }
});

discoverRoutes.get<{ language: string }>(
  '/movies/language/:language',
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage(req.user);

    try {
      const languages = await tmdb.getLanguages();

      const language = languages.find(
        (lang) => lang.iso_639_1 === req.params.language
      );

      if (!language) {
        return next({ status: 404, message: 'Language not found.' });
      }

      const data = await tmdb.getDiscoverMovies({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        originalLanguage: req.params.language,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.MOVIE,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        language,
        results: data.results.map((result) =>
          mapMovieResult(
            result,
            media.find(
              (req) =>
                req.tmdbId === result.id && req.mediaType === MediaType.MOVIE
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving movies by language', {
        label: 'API',
        errorMessage: e.message,
        language: req.params.language,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movies by language.',
      });
    }
  }
);

discoverRoutes.get<{ genreId: string }>(
  '/movies/genre/:genreId',
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage(req.user);

    try {
      const genres = await tmdb.getMovieGenres({
        language: (req.query.language as string) ?? req.locale,
      });

      const genre = genres.find(
        (genre) => genre.id === Number(req.params.genreId)
      );

      if (!genre) {
        return next({ status: 404, message: 'Genre not found.' });
      }

      const data = await tmdb.getDiscoverMovies({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        genre: req.params.genreId as string,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.MOVIE,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        genre,
        results: data.results.map((result) =>
          mapMovieResult(
            result,
            media.find(
              (req) =>
                req.tmdbId === result.id && req.mediaType === MediaType.MOVIE
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving movies by genre', {
        label: 'API',
        errorMessage: e.message,
        genreId: req.params.genreId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movies by genre.',
      });
    }
  }
);

discoverRoutes.get<{ studioId: string }>(
  '/movies/studio/:studioId',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const studio = await tmdb.getStudio(Number(req.params.studioId));

      const data = await tmdb.getDiscoverMovies({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        studio: req.params.studioId as string,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.MOVIE,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        studio: mapProductionCompany(studio),
        results: data.results.map((result) =>
          mapMovieResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.MOVIE
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving movies by studio', {
        label: 'API',
        errorMessage: e.message,
        studioId: req.params.studioId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movies by studio.',
      });
    }
  }
);

discoverRoutes.get('/movies/upcoming', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  const now = new Date();
  const offset = now.getTimezoneOffset();
  const date = new Date(now.getTime() - offset * 60 * 1000)
    .toISOString()
    .split('T')[0];

  try {
    const data = await tmdb.getDiscoverMovies({
      page: Number(req.query.page),
      language: (req.query.language as string) ?? req.locale,
      primaryReleaseDateGte: date,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.MOVIE,
      }))
    );

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((result) =>
        mapMovieResult(
          result,
          media.find(
            (med) =>
              med.tmdbId === result.id && med.mediaType === MediaType.MOVIE
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving upcoming movies', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve upcoming movies.',
    });
  }
});

discoverRoutes.get('/tv', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const query = ApiQuerySchema.parse(req.query);
    const keywords = query.keywords;
    const excludeKeywords = query.excludeKeywords;

    let effectiveVoteCountGte = query.voteCountGte;
    if (query.sortBy?.includes('vote_average') && !effectiveVoteCountGte) {
      effectiveVoteCountGte = '50';
    }

    const data = await tmdb.getDiscoverTv({
      page: Number(query.page),
      sortBy: query.sortBy as SortOptions,
      language: req.locale ?? query.language,
      genre: query.genre,
      network: query.network ? Number(query.network) : undefined,
      firstAirDateLte: query.firstAirDateLte
        ? new Date(query.firstAirDateLte).toISOString().split('T')[0]
        : undefined,
      firstAirDateGte: query.firstAirDateGte
        ? new Date(query.firstAirDateGte).toISOString().split('T')[0]
        : undefined,
      originalLanguage: query.language,
      keywords,
      excludeKeywords,
      withRuntimeGte: query.withRuntimeGte,
      withRuntimeLte: query.withRuntimeLte,
      voteAverageGte: query.voteAverageGte,
      voteAverageLte: query.voteAverageLte,
      voteCountGte: effectiveVoteCountGte,
      voteCountLte: query.voteCountLte,
      watchProviders: query.watchProviders,
      watchRegion: query.watchRegion,
      withStatus: query.status,
      certification: query.certification,
      certificationGte: query.certificationGte,
      certificationLte: query.certificationLte,
      certificationCountry: query.certificationCountry,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.TV,
      }))
    );

    let keywordData: TmdbKeyword[] = [];
    if (keywords) {
      const splitKeywords = keywords.split(',');

      const keywordResults = await Promise.all(
        splitKeywords.map(async (keywordId) => {
          return await tmdb.getKeywordDetails({ keywordId: Number(keywordId) });
        })
      );

      keywordData = keywordResults.filter(
        (keyword): keyword is TmdbKeyword => keyword !== null
      );
    }

    const rtScoreGte = query.rtScoreGte ? Number(query.rtScoreGte) : undefined;
    let resultsWithRatings: {
      result: (typeof data.results)[number];
      ratings?: RatingResponse;
    }[] = data.results.map((result) => ({ result }));

    if (rtScoreGte !== undefined) {
      const rtapi = new RottenTomatoes();
      const enriched = await Promise.all(
        data.results.map(async (result) => {
          const year = result.first_air_date
            ? Number(result.first_air_date.slice(0, 4))
            : undefined;
          let rt = null;
          try {
            rt = await rtapi.getTVRatings(result.name, year);
          } catch {
            // best-effort
          }

          const ratings: RatingResponse = {
            ...(rt ? { rt } : {}),
          };
          return { result, ratings };
        })
      );

      resultsWithRatings = enriched.filter(({ ratings }) => {
        if (rtScoreGte !== undefined) {
          if (!ratings?.rt?.criticsScore || ratings.rt.criticsScore < rtScoreGte) {
            return false;
          }
        }
        return true;
      });
    }

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      keywords: keywordData,
      results: resultsWithRatings.map(({ result, ratings }) =>
        mapTvResult(
          result,
          media.find(
            (med) => med.tmdbId === result.id && med.mediaType === MediaType.TV
          ),
          ratings
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving popular series', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve popular series.',
    });
  }
});

discoverRoutes.get<{ language: string }>(
  '/tv/language/:language',
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage(req.user);

    try {
      const languages = await tmdb.getLanguages();

      const language = languages.find(
        (lang) => lang.iso_639_1 === req.params.language
      );

      if (!language) {
        return next({ status: 404, message: 'Language not found.' });
      }

      const data = await tmdb.getDiscoverTv({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        originalLanguage: req.params.language,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.TV,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        language,
        results: data.results.map((result) =>
          mapTvResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.TV
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving series by language', {
        label: 'API',
        errorMessage: e.message,
        language: req.params.language,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve series by language.',
      });
    }
  }
);

discoverRoutes.get<{ genreId: string }>(
  '/tv/genre/:genreId',
  async (req, res, next) => {
    const tmdb = createTmdbWithRegionLanguage(req.user);

    try {
      const genres = await tmdb.getTvGenres({
        language: (req.query.language as string) ?? req.locale,
      });

      const genre = genres.find(
        (genre) => genre.id === Number(req.params.genreId)
      );

      if (!genre) {
        return next({ status: 404, message: 'Genre not found.' });
      }

      const data = await tmdb.getDiscoverTv({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        genre: req.params.genreId,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.TV,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        genre,
        results: data.results.map((result) =>
          mapTvResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.TV
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving series by genre', {
        label: 'API',
        errorMessage: e.message,
        genreId: req.params.genreId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve series by genre.',
      });
    }
  }
);

discoverRoutes.get<{ networkId: string }>(
  '/tv/network/:networkId',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const network = await tmdb.getNetwork(Number(req.params.networkId));

      const data = await tmdb.getDiscoverTv({
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
        network: Number(req.params.networkId),
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.TV,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        network: mapNetwork(network),
        results: data.results.map((result) =>
          mapTvResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.TV
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving series by network', {
        label: 'API',
        errorMessage: e.message,
        networkId: req.params.networkId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve series by network.',
      });
    }
  }
);

discoverRoutes.get('/tv/upcoming', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  const now = new Date();
  const offset = now.getTimezoneOffset();
  const date = new Date(now.getTime() - offset * 60 * 1000)
    .toISOString()
    .split('T')[0];

  try {
    const data = await tmdb.getDiscoverTv({
      page: Number(req.query.page),
      language: (req.query.language as string) ?? req.locale,
      firstAirDateGte: date,
    });

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: MediaType.TV,
      }))
    );

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((result) =>
        mapTvResult(
          result,
          media.find(
            (med) => med.tmdbId === result.id && med.mediaType === MediaType.TV
          )
        )
      ),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving upcoming series', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve upcoming series.',
    });
  }
});

discoverRoutes.get('/trending', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const mediaType = (req.query.mediaType as 'all' | 'movie' | 'tv') ?? 'all';
    const timeWindow =
      (req.query.timeWindow as 'day' | 'week') === 'week' ? 'week' : 'day';
    const language = (req.query.language as string) ?? req.locale;
    const page = Number(req.query.page);

    const trendingFetchers = {
      movie: async () => ({
        data: await tmdb.getMovieTrending({ page, language, timeWindow }),
        mapper: mapMovieResult,
        type: MediaType.MOVIE,
      }),
      tv: async () => ({
        data: await tmdb.getTvTrending({ page, language, timeWindow }),
        mapper: mapTvResult,
        type: MediaType.TV,
      }),
      all: async () => ({
        data: await tmdb.getAllTrending({ page, language, timeWindow }),
        mapper: (result: any, media?: Media) => {
          if (isMovie(result)) {
            return mapMovieResult(result, media);
          } else if (isPerson(result)) {
            return mapPersonResult(result);
          } else if (isCollection(result)) {
            return mapCollectionResult(result);
          } else {
            return mapTvResult(result, media);
          }
        },
        type: null,
      }),
    } as const;

    const { data, mapper, type } = await trendingFetchers[mediaType]();

    const media = await Media.getRelatedMedia(
      req.user,
      data.results.map((result) => ({
        tmdbId: result.id,
        mediaType: isMovie(result) ? MediaType.MOVIE : MediaType.TV,
      }))
    );

    return res.status(200).json({
      page: data.page,
      totalPages: data.total_pages,
      totalResults: data.total_results,
      results: data.results.map((result) => {
        // - If "type" is set (case: "movie" or "tv"), the mediaType must also match.
        // - If "type" is not set (case: "all"), only filter by tmdbId.
        const selectedMedia = media.find(
          (med) =>
            med.tmdbId === result.id && (type ? med.mediaType === type : true)
        );

        return mapper(result, selectedMedia);
      }),
    });
  } catch (e) {
    logger.debug('Something went wrong retrieving trending items', {
      label: 'API',
      errorMessage: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve trending items.',
    });
  }
});

discoverRoutes.get<{ keywordId: string }>(
  '/keyword/:keywordId/movies',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const data = await tmdb.getMoviesByKeyword({
        keywordId: Number(req.params.keywordId),
        page: Number(req.query.page),
        language: (req.query.language as string) ?? req.locale,
      });

      const media = await Media.getRelatedMedia(
        req.user,
        data.results.map((result) => ({
          tmdbId: result.id,
          mediaType: MediaType.MOVIE,
        }))
      );

      return res.status(200).json({
        page: data.page,
        totalPages: data.total_pages,
        totalResults: data.total_results,
        results: data.results.map((result) =>
          mapMovieResult(
            result,
            media.find(
              (med) =>
                med.tmdbId === result.id && med.mediaType === MediaType.MOVIE
            )
          )
        ),
      });
    } catch (e) {
      logger.debug('Something went wrong retrieving movies by keyword', {
        label: 'API',
        errorMessage: e.message,
        keywordId: req.params.keywordId,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movies by keyword.',
      });
    }
  }
);

discoverRoutes.get<{ language: string }, GenreSliderItem[]>(
  '/genreslider/movie',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const mappedGenres: GenreSliderItem[] = [];

      const genres = await tmdb.getMovieGenres({
        language: (req.query.language as string) ?? req.locale,
      });

      await Promise.all(
        genres.map(async (genre) => {
          const genreData = await tmdb.getDiscoverMovies({
            genre: genre.id.toString(),
          });

          mappedGenres.push({
            id: genre.id,
            name: genre.name,
            backdrops: genreData.results
              .filter((title) => !!title.backdrop_path)
              .map((title) => title.backdrop_path) as string[],
          });
        })
      );

      const sortedData = sortBy(mappedGenres, 'name');

      return res.status(200).json(sortedData);
    } catch (e) {
      logger.debug('Something went wrong retrieving the movie genre slider', {
        label: 'API',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve movie genre slider.',
      });
    }
  }
);

discoverRoutes.get<{ language: string }, GenreSliderItem[]>(
  '/genreslider/tv',
  async (req, res, next) => {
    const tmdb = new TheMovieDb();

    try {
      const mappedGenres: GenreSliderItem[] = [];

      const genres = await tmdb.getTvGenres({
        language: (req.query.language as string) ?? req.locale,
      });

      await Promise.all(
        genres.map(async (genre) => {
          const genreData = await tmdb.getDiscoverTv({
            genre: genre.id.toString(),
          });

          mappedGenres.push({
            id: genre.id,
            name: genre.name,
            backdrops: genreData.results
              .filter((title) => !!title.backdrop_path)
              .map((title) => title.backdrop_path) as string[],
          });
        })
      );

      const sortedData = sortBy(mappedGenres, 'name');

      return res.status(200).json(sortedData);
    } catch (e) {
      logger.debug('Something went wrong retrieving the series genre slider', {
        label: 'API',
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Unable to retrieve series genre slider.',
      });
    }
  }
);

discoverRoutes.get<Record<string, unknown>, WatchlistResponse>(
  '/watchlist',
  async (req, res) => {
    const userRepository = getRepository(User);
    const itemsPerPage = 20;
    const page = req.query.page ? Number(req.query.page) : 1;
    const offset = (page - 1) * itemsPerPage;

    const activeUser = await userRepository.findOne({
      where: { id: req.user?.id },
      select: ['id', 'plexToken'],
    });

    if (activeUser && !activeUser?.plexToken) {
      // Non-Plex users can only see their own watchlist
      const [result, total] = await getRepository(Watchlist).findAndCount({
        where: { requestedBy: { id: activeUser?.id } },
        relations: {
          /*requestedBy: true,media:true*/
        },
        // loadRelationIds: true,
        take: itemsPerPage,
        skip: offset,
      });
      if (total) {
        return res.json({
          page: page,
          totalPages: Math.ceil(total / itemsPerPage),
          totalResults: total,
          results: result,
        });
      }
    }
    if (!activeUser?.plexToken) {
      // We will just return an empty array if the user has no Plex token
      return res.json({
        page: 1,
        totalPages: 1,
        totalResults: 0,
        results: [],
      });
    }

    // List watchlist from Plex
    const plexTV = new PlexTvAPI(activeUser.plexToken);

    const watchlist = await plexTV.getWatchlist({ offset });

    return res.json({
      page,
      totalPages: Math.ceil(watchlist.totalSize / itemsPerPage),
      totalResults: watchlist.totalSize,
      results: watchlist.items.map((item) => ({
        id: item.tmdbId,
        ratingKey: item.ratingKey,
        title: item.title,
        mediaType: item.type === 'show' ? 'tv' : 'movie',
        tmdbId: item.tmdbId,
      })),
    });
  }
);

// Helper: Retrieve user watched media history from DB, Media table, and Jellyfin for the active profile
async function getWatchedMediaHistory(user?: User | null): Promise<{
  watchedSeriesIds: number[];
  watchedMovieIds: number[];
  allLibraryMovieIds: Set<number>;
  allLibrarySeriesIds: Set<number>;
}> {
  const watchedSeriesIds: number[] = [];
  const watchedMovieIds: number[] = [];
  const allLibraryMovieIds = new Set<number>();
  const allLibrarySeriesIds = new Set<number>();

  const isGusOrAdmin = !user || user.id === 2 || user.hasPermission(Permission.ADMIN);

  // 1. Explicitly marked watched items from Watched table for active user
  try {
    const watchedRepo = getRepository(Watched);
    const dbWatched = user
      ? await watchedRepo.find({
          where: { userId: user.id },
          order: { createdAt: 'DESC' },
        })
      : await watchedRepo.find({
          order: { createdAt: 'DESC' },
        });

    for (const w of dbWatched) {
      if (w.mediaType === MediaType.TV) {
        if (!watchedSeriesIds.includes(w.tmdbId)) watchedSeriesIds.push(w.tmdbId);
        allLibrarySeriesIds.add(w.tmdbId);
      } else if (w.mediaType === MediaType.MOVIE) {
        if (!watchedMovieIds.includes(w.tmdbId)) watchedMovieIds.push(w.tmdbId);
        allLibraryMovieIds.add(w.tmdbId);
      }
    }
  } catch (e: any) {
    logger.debug('Error reading Watched table', { label: 'Discover', error: e.message });
  }

  // 2. All media in library (for exclusion so we don't recommend already downloaded media)
  try {
    const mediaRepo = getRepository(Media);
    const dbMedia = await mediaRepo.find({
      order: { updatedAt: 'DESC' },
    });

    for (const m of dbMedia) {
      if (m.mediaType === MediaType.MOVIE) {
        allLibraryMovieIds.add(m.tmdbId);
        if (
          isGusOrAdmin &&
          (m.status === MediaStatus.AVAILABLE ||
            m.status === MediaStatus.PARTIALLY_AVAILABLE ||
            m.status === 7) &&
          !watchedMovieIds.includes(m.tmdbId)
        ) {
          watchedMovieIds.push(m.tmdbId);
        }
      } else if (m.mediaType === MediaType.TV) {
        allLibrarySeriesIds.add(m.tmdbId);
        if (
          isGusOrAdmin &&
          (m.status === MediaStatus.AVAILABLE ||
            m.status === MediaStatus.PARTIALLY_AVAILABLE ||
            m.status === 7) &&
          !watchedSeriesIds.includes(m.tmdbId)
        ) {
          watchedSeriesIds.push(m.tmdbId);
        }
      }
    }
  } catch (e: any) {
    logger.debug('Error reading Media table', { label: 'Discover', error: e.message });
  }

  // 3. Query Jellyfin for played/watched items for the specific profile
  const settings = getSettings();
  const targetJellyfinUserId =
    user?.jellyfinUserId || (isGusOrAdmin ? settings.jellyfin.userId : undefined);

  if (settings.jellyfin.ip && settings.jellyfin.apiKey && targetJellyfinUserId) {
    try {
      const jfBase = `http://${settings.jellyfin.ip}:${settings.jellyfin.port}`;
      const resp = await axios.get(`${jfBase}/Users/${targetJellyfinUserId}/Items`, {
        headers: { 'X-Emby-Token': settings.jellyfin.apiKey },
        params: {
          Recursive: 'true',
          IncludeItemTypes: 'Movie,Series,Episode',
          Fields: 'ProviderIds,UserData,DatePlayed',
          SortBy: 'DatePlayed,SortName',
          SortOrder: 'Descending',
        },
        timeout: 5000,
      });

      for (const item of resp.data?.Items || []) {
        const userData = item.UserData || {};
        const isWatchedOrPlayed =
          userData.Played === true ||
          (userData.PlayCount && userData.PlayCount > 0) ||
          (userData.PlaybackPositionTicks && userData.PlaybackPositionTicks > 0);

        if (!isWatchedOrPlayed) continue;

        const tmdbId = Number(item.ProviderIds?.Tmdb);
        if (item.Type === 'Movie') {
          if (tmdbId) {
            allLibraryMovieIds.add(tmdbId);
            if (!watchedMovieIds.includes(tmdbId)) {
              watchedMovieIds.unshift(tmdbId);
            }
          }
        } else if (item.Type === 'Series') {
          if (tmdbId) {
            allLibrarySeriesIds.add(tmdbId);
            if (!watchedSeriesIds.includes(tmdbId)) {
              watchedSeriesIds.unshift(tmdbId);
            }
          }
        }
      }
    } catch (e: any) {
      logger.debug('Error reading Jellyfin items for profile', {
        label: 'Discover',
        targetJellyfinUserId,
        error: e.message,
      });
    }
  }

  // For Gus/Admin, preserve specific historical series seeds
  if (isGusOrAdmin) {
    if (!watchedSeriesIds.includes(296286)) {
      watchedSeriesIds.push(296286); // Smoking Behind the Supermarket with You
      allLibrarySeriesIds.add(296286);
    }
    if (!watchedSeriesIds.includes(65930)) {
      watchedSeriesIds.push(65930); // My Hero Academia
      allLibrarySeriesIds.add(65930);
    }
  }

  return { watchedSeriesIds, watchedMovieIds, allLibraryMovieIds, allLibrarySeriesIds };
}

// 1. Based on what you liked (recommendations based on liked and watched titles)
const handleRecentRecommendations = async (req: any, res: any, next: any) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const {
      watchedSeriesIds,
      watchedMovieIds,
      allLibraryMovieIds,
      allLibrarySeriesIds,
    } = await getWatchedMediaHistory(req.user);

    // Get user's liked titles
    const likedRepository = getRepository(Liked);
    let userLikedSeries: Liked[] = [];
    let userLikedMovies: Liked[] = [];
    let likedSeriesIds: number[] = [];
    let likedMovieIds: number[] = [];

    if (req.user?.id) {
      try {
        const likedItems = await likedRepository.find({
          where: { userId: req.user.id },
          order: { createdAt: 'DESC' },
        });
        userLikedSeries = likedItems.filter((l) => l.mediaType === 'tv');
        userLikedMovies = likedItems.filter((l) => l.mediaType === 'movie');
        likedSeriesIds = userLikedSeries.map((l) => l.tmdbId);
        likedMovieIds = userLikedMovies.map((l) => l.tmdbId);
      } catch {
        // Continue
      }
    }

    const dismissedRepository = getRepository(DismissedRecommendation);
    let dismissedSeriesIds: number[] = [];
    let dismissedMovieIds: number[] = [];

    if (req.user?.id) {
      try {
        const dismissedItems = await dismissedRepository.find({
          where: { userId: req.user.id },
        });
        dismissedSeriesIds = dismissedItems
          .filter((d) => d.mediaType === 'tv')
          .map((d) => d.tmdbId);
        dismissedMovieIds = dismissedItems
          .filter((d) => d.mediaType === 'movie')
          .map((d) => d.tmdbId);
      } catch {
        // Continue
      }
    }

    const addedIds = new Set<number>();

    const isExcluded = (id: number, mediaType: 'movie' | 'tv') => {
      if (addedIds.has(id)) return true;
      if (mediaType === 'movie') {
        return (
          allLibraryMovieIds.has(id) ||
          watchedMovieIds.includes(id) ||
          likedMovieIds.includes(id) ||
          dismissedMovieIds.includes(id)
        );
      } else {
        return (
          allLibrarySeriesIds.has(id) ||
          watchedSeriesIds.includes(id) ||
          likedSeriesIds.includes(id) ||
          dismissedSeriesIds.includes(id)
        );
      }
    };

    const isPreschoolOrToddler = (title?: string, overview?: string) => {
      const text = `${title || ''} ${overview || ''}`.toLowerCase();
      return /\b(paw patrol|peppa pig|barbie|snoopy|cocomelon|baby shark|dora the explorer|teletubbies|winnie the pooh|sesame street|thomas & friends|bob the builder|caillou|bluey)\b/i.test(
        text
      );
    };

    const getTitleRoot = (title?: string) => {
      if (!title) return '';
      const base = title.split(/[:\-\–\|]/)[0].trim().toLowerCase();
      return base.replace(/^(the|a|an)\s+/i, '').replace(/[^a-z0-9]/g, '');
    };

    // Helper to sample diverse seeds from liked items, avoiding sequel/franchise clustering
    const sampleDiverseSeeds = (items: Liked[], maxSeeds = 8): number[] => {
      const seenRoots = new Set<string>();
      const seeds: number[] = [];
      for (const item of items) {
        const root = getTitleRoot(item.title);
        if (root && !seenRoots.has(root)) {
          seenRoots.add(root);
          seeds.push(item.tmdbId);
        }
        if (seeds.length >= maxSeeds) break;
      }
      if (seeds.length < maxSeeds) {
        for (const item of items) {
          if (!seeds.includes(item.tmdbId)) {
            seeds.push(item.tmdbId);
            if (seeds.length >= maxSeeds) break;
          }
        }
      }
      return seeds;
    };

    // Seeds:
    // If the user has liked items, use ONLY their liked items as seeds (do not dilute with random watch history).
    // Only fall back to watched history if the user has 0 liked titles.
    const tvSeeds =
      userLikedSeries.length > 0
        ? sampleDiverseSeeds(userLikedSeries, 8)
        : watchedSeriesIds.slice(0, 8);

    const movieSeeds =
      userLikedMovies.length > 0
        ? sampleDiverseSeeds(userLikedMovies, 8)
        : watchedMovieIds.slice(0, 8);

    // Build a map of seed tmdbId to liked title
    const seedTitleMap = new Map<number, string>();
    for (const item of userLikedSeries) {
      if (item.title) seedTitleMap.set(item.tmdbId, item.title);
    }
    for (const item of userLikedMovies) {
      if (item.title) seedTitleMap.set(item.tmdbId, item.title);
    }

    // Pre-fetch candidate pools per seed concurrently via Promise.all
    const tvPools = new Map<number, any[]>();
    const moviePools = new Map<number, any[]>();

    await Promise.all([
      ...tvSeeds.map(async (sId) => {
        try {
          const [recs, sim] = await Promise.all([
            tmdb.getTvRecommendations({ tvId: sId, page: 1 }).catch(() => ({ results: [] })),
            tvSeeds.length <= 3
              ? tmdb.getTvSimilar({ tvId: sId, page: 1 }).catch(() => ({ results: [] }))
              : Promise.resolve({ results: [] }),
          ]);
          const combined = [...(recs.results || []), ...(sim.results || [])];
          const seen = new Set<number>();
          const list = combined.filter((i) => {
            if (!i?.id || seen.has(i.id)) return false;
            seen.add(i.id);
            return true;
          });
          tvPools.set(sId, list);
        } catch {
          tvPools.set(sId, []);
        }
      }),
      ...movieSeeds.map(async (mId) => {
        try {
          const [recs, sim] = await Promise.all([
            tmdb.getMovieRecommendations({ movieId: mId, page: 1 }).catch(() => ({ results: [] })),
            movieSeeds.length <= 3
              ? tmdb.getMovieSimilar({ movieId: mId, page: 1 }).catch(() => ({ results: [] }))
              : Promise.resolve({ results: [] }),
          ]);
          const combined = [...(recs.results || []), ...(sim.results || [])];
          const seen = new Set<number>();
          const list = combined.filter((i) => {
            if (!i?.id || seen.has(i.id)) return false;
            seen.add(i.id);
            return true;
          });
          moviePools.set(mId, list);
        } catch {
          moviePools.set(mId, []);
        }
      }),
    ]);

    // Round-robin selection across seeds for maximum diversity of user's liked titles
    const tvCandidates: {
      id: number;
      mediaType: 'tv';
      data: any;
      from?: string;
    }[] = [];
    for (let round = 0; round < 4 && tvCandidates.length < 30; round++) {
      for (const sId of tvSeeds) {
        const pool = tvPools.get(sId) || [];
        const item = pool.find(
          (show) =>
            !isExcluded(show.id, 'tv') &&
            !isPreschoolOrToddler(show.name, show.overview)
        );
        if (item) {
          addedIds.add(item.id);
          tvCandidates.push({
            id: item.id,
            mediaType: 'tv',
            data: { ...item, media_type: 'tv' },
            from: seedTitleMap.get(sId),
          });
        }
      }
    }

    const movieCandidates: {
      id: number;
      mediaType: 'movie';
      data: any;
      from?: string;
    }[] = [];
    for (let round = 0; round < 4 && movieCandidates.length < 30; round++) {
      for (const mId of movieSeeds) {
        const pool = moviePools.get(mId) || [];
        const item = pool.find(
          (movie) =>
            !isExcluded(movie.id, 'movie') &&
            !isPreschoolOrToddler(movie.title, movie.overview)
        );
        if (item) {
          addedIds.add(item.id);
          movieCandidates.push({
            id: item.id,
            mediaType: 'movie',
            data: { ...item, media_type: 'movie' },
            from: seedTitleMap.get(mId),
          });
        }
      }
    }

    // Interleave movie and tv recommendations for a balanced recent slider
    const interleaved: {
      id: number;
      mediaType: 'movie' | 'tv';
      data: any;
      from?: string;
    }[] = [];
    const maxLen = Math.max(movieCandidates.length, tvCandidates.length);

    for (let i = 0; i < maxLen; i++) {
      if (tvCandidates[i]) interleaved.push(tvCandidates[i]);
      if (movieCandidates[i]) interleaved.push(movieCandidates[i]);
    }

    // Backfill with remaining candidates if any slot left
    for (const cand of [...tvCandidates, ...movieCandidates]) {
      if (!interleaved.some((c) => c.id === cand.id)) {
        interleaved.push(cand);
      }
    }

    // If profile has little or no liked/watched history, backfill with trending media
    if (interleaved.length < 20) {
      try {
        const trending = await tmdb.getAllTrending({
          page: 1,
          timeWindow: 'week',
        });
        for (const item of trending.results || []) {
          if (interleaved.length >= 40) break;
          const isShow =
            (item as any).media_type === 'tv' || Boolean((item as any).name);
          const mType: 'movie' | 'tv' = isShow ? 'tv' : 'movie';

          if (!isExcluded(item.id, mType)) {
            addedIds.add(item.id);
            if (mType === 'movie') {
              const cand = {
                id: item.id,
                mediaType: 'movie' as const,
                data: { ...item, media_type: 'movie' },
              };
              interleaved.push(cand);
              movieCandidates.push(cand);
            } else {
              const cand = {
                id: item.id,
                mediaType: 'tv' as const,
                data: { ...item, media_type: 'tv' },
              };
              interleaved.push(cand);
              tvCandidates.push(cand);
            }
          }
        }
      } catch {
        // Continue
      }
    }

    // Filter by mediaType if specified (all, movie, tv)
    const filterMediaType = String(req.query.mediaType || 'all').toLowerCase();
    let candidatesToServe = interleaved;
    if (filterMediaType === 'movie') {
      candidatesToServe = movieCandidates;
    } else if (filterMediaType === 'tv') {
      candidatesToServe = tvCandidates;
    }

    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const pageSize = 20;
    const totalResults = candidatesToServe.length;
    const totalPages = Math.max(1, Math.ceil(totalResults / pageSize));
    const paginated = candidatesToServe.slice(
      (page - 1) * pageSize,
      page * pageSize
    );

    const media = await Media.getRelatedMedia(
      req.user,
      paginated.map((r) => ({
        tmdbId: r.id,
        mediaType: r.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV,
      }))
    );

    const formattedResults = paginated.map((r) => {
      const match = media.find(
        (m) =>
          m.tmdbId === r.id &&
          m.mediaType === (r.mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV)
      );
      const res =
        r.mediaType === 'movie'
          ? mapMovieResult(r.data, match)
          : mapTvResult(r.data, match);
      return {
        ...res,
        recommendationReason: r.from ? `Because you liked ${r.from}` : undefined,
        basedOnTitle: r.from || undefined,
      };
    });

    return res.status(200).json({
      page,
      totalPages,
      totalResults,
      results: formattedResults,
    });
  } catch (e) {
    logger.error('Failed to get recent media recommendations', {
      label: 'Discover',
      error: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve recent recommendations.',
    });
  }
};

discoverRoutes.get('/recommendations/recent', handleRecentRecommendations);
discoverRoutes.get('/smart-recommendations', handleRecentRecommendations);

// 2. Movies for You (based on ALL watched movies across user's history)
discoverRoutes.get('/recommendations/movies', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);

  try {
    const { watchedMovieIds, allLibraryMovieIds } = await getWatchedMediaHistory(req.user);
    const dismissedRepo = getRepository(DismissedRecommendation);
    const dismissedMovies = req.user?.id
      ? await dismissedRepo.find({
          where: { userId: req.user.id, mediaType: MediaType.MOVIE },
        })
      : [];
    const dismissedMovieIds = new Set(dismissedMovies.map((d) => d.tmdbId));
    const candidateScores = new Map<number, number>();
    const candidateMovieMap = new Map<number, any>();

    const likedRepo = getRepository(Liked);
    const likedMovies = req.user?.id
      ? await likedRepo.find({
          where: { userId: req.user.id, mediaType: MediaType.MOVIE },
        })
      : [];
    const likedMovieIds = likedMovies.map((l) => l.tmdbId);

    // Build sample pool prioritizing liked movies, followed by diverse watched movies
    const combinedSeeds = [
      ...likedMovieIds,
      ...watchedMovieIds.filter((id) => !likedMovieIds.includes(id)),
    ];

    if (combinedSeeds.length > 0) {
      const samplePool =
        combinedSeeds.length <= 12
          ? combinedSeeds
          : [
              ...combinedSeeds.slice(0, 6),
              ...combinedSeeds
                .slice(6)
                .filter(
                  (_, idx) =>
                    idx % Math.ceil((combinedSeeds.length - 6) / 6) === 0
                ),
            ].slice(0, 12);

      await Promise.all(
        samplePool.map(async (mId) => {
          const isLikedSeed = likedMovieIds.includes(mId);
          try {
            const [recs, sim] = await Promise.all([
              tmdb.getMovieRecommendations({ movieId: mId, page: 1 }).catch(() => ({ results: [] })),
              samplePool.length <= 4
                ? tmdb.getMovieSimilar({ movieId: mId, page: 1 }).catch(() => ({ results: [] }))
                : Promise.resolve({ results: [] }),
            ]);
            const combined = [...(recs.results || []), ...(sim.results || [])];
            const seen = new Set<number>();
            const list = combined.filter((i) => {
              if (!i?.id || seen.has(i.id)) return false;
              seen.add(i.id);
              return true;
            });

            for (let rank = 0; rank < Math.min(list.length, 12); rank++) {
              const movie = list[rank];
              if (
                allLibraryMovieIds.has(movie.id) ||
                watchedMovieIds.includes(movie.id) ||
                likedMovieIds.includes(movie.id) ||
                dismissedMovieIds.has(movie.id)
              ) {
                continue;
              }
              const currentScore = candidateScores.get(movie.id) || 0;
              // Liked seeds provide 1.5x boost over regular watched seeds
              const weight = isLikedSeed ? 1.5 : 1.0;
              candidateScores.set(
                movie.id,
                currentScore + Math.round((12 - rank) * weight)
              );
              if (!candidateMovieMap.has(movie.id)) {
                candidateMovieMap.set(movie.id, { ...movie, media_type: 'movie' });
              }
            }
          } catch {
            // Continue
          }
        })
      );
    }

    // If no candidate scores (fresh profile), provide popular / trending movies
    if (candidateScores.size === 0) {
      try {
        const popular = await tmdb.getDiscoverMovies({
          sortBy: 'popularity.desc',
          page: 1,
        });
        for (const movie of popular.results || []) {
          if (!allLibraryMovieIds.has(movie.id)) {
            candidateScores.set(movie.id, Math.round((movie.vote_average || 7) * 10));
            candidateMovieMap.set(movie.id, { ...movie, media_type: 'movie' });
          }
        }
      } catch {
        // Continue
      }
    }

    // Sort candidates by recommendation overlap score, then rating
    const sortedCandidateIds = Array.from(candidateScores.keys()).sort((a, b) => {
      const scoreDiff = (candidateScores.get(b) || 0) - (candidateScores.get(a) || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const movieA = candidateMovieMap.get(a);
      const movieB = candidateMovieMap.get(b);
      return (movieB?.vote_average || 0) - (movieA?.vote_average || 0);
    });

    const topCandidateMovies = sortedCandidateIds
      .slice(0, 20)
      .map((id) => candidateMovieMap.get(id));

    const media = await Media.getRelatedMedia(
      req.user,
      topCandidateMovies.map((r) => ({
        tmdbId: r.id,
        mediaType: MediaType.MOVIE,
      }))
    );

    const formattedResults = topCandidateMovies.map((r) => {
      const match = media.find(
        (m) => m.tmdbId === r.id && m.mediaType === MediaType.MOVIE
      );
      return mapMovieResult(r, match);
    });

    return res.status(200).json({
      page: 1,
      totalPages: 1,
      totalResults: formattedResults.length,
      results: formattedResults,
    });
  } catch (e) {
    logger.error('Failed to get movie recommendations', {
      label: 'Discover',
      error: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve movie recommendations.',
    });
  }
});

// 3. Series for You (based on ALL watched series across user's history + Suggestarr)
discoverRoutes.get('/recommendations/series', async (req, res, next) => {
  const tmdb = createTmdbWithRegionLanguage(req.user);
  const suggestarrApi = new SuggestarrAPI();

  try {
    const { watchedSeriesIds, allLibrarySeriesIds } = await getWatchedMediaHistory(req.user);
    const dismissedRepo = getRepository(DismissedRecommendation);
    const dismissedSeries = req.user?.id
      ? await dismissedRepo.find({
          where: { userId: req.user.id, mediaType: MediaType.TV },
        })
      : [];
    const dismissedSeriesIds = new Set(dismissedSeries.map((d) => d.tmdbId));

    const likedRepo = getRepository(Liked);
    const likedSeries = req.user?.id
      ? await likedRepo.find({
          where: { userId: req.user.id, mediaType: MediaType.TV },
        })
      : [];
    const likedSeriesIds = likedSeries.map((l) => l.tmdbId);

    const candidateScores = new Map<number, number>();
    const candidateSeriesMap = new Map<number, any>();

    // 1. Suggestarr AI suggestions for series
    try {
      const suggestarrItems = await suggestarrApi.getJobPreview(1);
      for (let rank = 0; rank < suggestarrItems.length; rank++) {
        const item = suggestarrItems[rank];
        if (item.media_type === 'tv') {
          const tid = Number(item.tmdb_id);
          if (
            tid &&
            !allLibrarySeriesIds.has(tid) &&
            !watchedSeriesIds.includes(tid) &&
            !likedSeriesIds.includes(tid) &&
            !dismissedSeriesIds.has(tid)
          ) {
            candidateScores.set(
              tid,
              (candidateScores.get(tid) || 0) + (15 - Math.min(rank, 10))
            );
            candidateSeriesMap.set(tid, {
              id: tid,
              name: item.name || item.title || '',
              original_name: item.name || item.title || '',
              overview: item.overview || '',
              poster_path: item.poster_path || '',
              backdrop_path: item.backdrop_path || '',
              vote_average: item.rating || 0,
              vote_count: 0,
              first_air_date: item.release_date || '',
              genre_ids: [],
              media_type: 'tv',
              origin_country: [],
              original_language: 'ja',
              popularity: 10,
            });
          }
        }
      }
    } catch {
      // Continue
    }

    // 2. Recommendations based on liked series and diverse watched series across history
    const combinedSeriesSeeds = [
      ...likedSeriesIds,
      ...watchedSeriesIds.filter((id) => !likedSeriesIds.includes(id)),
    ];

    if (combinedSeriesSeeds.length > 0) {
      const sampleSeriesPool =
        combinedSeriesSeeds.length <= 12
          ? combinedSeriesSeeds
          : [
              ...combinedSeriesSeeds.slice(0, 6),
              ...combinedSeriesSeeds
                .slice(6)
                .filter(
                  (_, idx) =>
                    idx % Math.ceil((combinedSeriesSeeds.length - 6) / 6) === 0
                ),
            ].slice(0, 12);

      await Promise.all(
        sampleSeriesPool.map(async (sId) => {
          const isLikedSeed = likedSeriesIds.includes(sId);
          try {
            const [recs, sim] = await Promise.all([
              tmdb.getTvRecommendations({ tvId: sId, page: 1 }).catch(() => ({ results: [] })),
              sampleSeriesPool.length <= 4
                ? tmdb.getTvSimilar({ tvId: sId, page: 1 }).catch(() => ({ results: [] }))
                : Promise.resolve({ results: [] }),
            ]);
            const combined = [...(recs.results || []), ...(sim.results || [])];
            const seen = new Set<number>();
            const list = combined.filter((i) => {
              if (!i?.id || seen.has(i.id)) return false;
              seen.add(i.id);
              return true;
            });

            for (let rank = 0; rank < Math.min(list.length, 12); rank++) {
              const show = list[rank];
              if (
                allLibrarySeriesIds.has(show.id) ||
                watchedSeriesIds.includes(show.id) ||
                likedSeriesIds.includes(show.id) ||
                dismissedSeriesIds.has(show.id)
              ) {
                continue;
              }
              const currentScore = candidateScores.get(show.id) || 0;
              const weight = isLikedSeed ? 1.5 : 1.0;
              candidateScores.set(
                show.id,
                currentScore + Math.round((12 - rank) * weight)
              );
              if (
                !candidateSeriesMap.has(show.id) ||
                !candidateSeriesMap.get(show.id).overview
              ) {
                candidateSeriesMap.set(show.id, { ...show, media_type: 'tv' });
              }
            }
          } catch {
            // Continue
          }
        })
      );
    }

    // If no candidate scores (fresh profile), provide popular / trending series
    if (candidateScores.size === 0) {
      try {
        const popular = await tmdb.getDiscoverTv({
          sortBy: 'popularity.desc',
          page: 1,
        });
        for (const show of popular.results || []) {
          if (!allLibrarySeriesIds.has(show.id)) {
            candidateScores.set(show.id, Math.round((show.vote_average || 7) * 10));
            candidateSeriesMap.set(show.id, { ...show, media_type: 'tv' });
          }
        }
      } catch {
        // Continue
      }
    }

    const sortedSeriesIds = Array.from(candidateScores.keys()).sort((a, b) => {
      const scoreDiff = (candidateScores.get(b) || 0) - (candidateScores.get(a) || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const showA = candidateSeriesMap.get(a);
      const showB = candidateSeriesMap.get(b);
      return (showB?.vote_average || 0) - (showA?.vote_average || 0);
    });

    const topCandidateSeries = sortedSeriesIds
      .slice(0, 20)
      .map((id) => candidateSeriesMap.get(id));

    const media = await Media.getRelatedMedia(
      req.user,
      topCandidateSeries.map((r) => ({
        tmdbId: r.id,
        mediaType: MediaType.TV,
      }))
    );

    const formattedResults = topCandidateSeries.map((r) => {
      const match = media.find(
        (m) => m.tmdbId === r.id && m.mediaType === MediaType.TV
      );
      return mapTvResult(r, match);
    });

    return res.status(200).json({
      page: 1,
      totalPages: 1,
      totalResults: formattedResults.length,
      results: formattedResults,
    });
  } catch (e) {
    logger.error('Failed to get series recommendations', {
      label: 'Discover',
      error: e.message,
    });
    return next({
      status: 500,
      message: 'Unable to retrieve series recommendations.',
    });
  }
});

/**
 * GET /api/v1/discover/resume
 * Returns in-progress media from Jellyfin for the logged-in user profile
 */
discoverRoutes.get('/resume', async (req, res, next) => {
  try {
    const settings = getSettings();
    const isGusOrAdmin = !req.user || req.user.id === 2 || req.user.hasPermission(Permission.ADMIN);
    const targetJellyfinUserId = req.user?.jellyfinUserId || (isGusOrAdmin ? settings.jellyfin.userId : undefined);

    if (!settings.jellyfin.ip || !settings.jellyfin.apiKey || !targetJellyfinUserId) {
      return res.status(200).json({ results: [] });
    }

    const jfBase = `http://${settings.jellyfin.ip}:${settings.jellyfin.port}`;
    const resp = await axios.get(`${jfBase}/Users/${targetJellyfinUserId}/Items/Resume`, {
      headers: { 'X-Emby-Token': settings.jellyfin.apiKey },
      params: {
        Fields: 'ProviderIds,UserData,Overview,MediaSources,SeriesName,SeasonName,IndexNumber,ParentIndexNumber',
        Limit: 20,
      },
      timeout: 5000,
    });

    const jellyfinHost =
      settings.jellyfin.externalHostname ||
      `http://${settings.jellyfin.ip}:${settings.jellyfin.port}`;
    const serverId = settings.jellyfin.serverId;

    const items = (resp.data?.Items || []).map((item: any) => {
      const isEpisode = item.Type === 'Episode';
      const isMovie = item.Type === 'Movie';
      const userData = item.UserData || {};
      const playedPercentage = Math.round(userData.PlayedPercentage || 0);
      const playbackPositionTicks = Number(userData.PlaybackPositionTicks) || 0;
      const totalTicks = Number(item.RunTimeTicks) || 0;

      const totalSeconds = Math.round(totalTicks / 10000000);
      const positionSeconds = Math.round(playbackPositionTicks / 10000000);
      const remainingMinutes = Math.max(0, Math.round((totalSeconds - positionSeconds) / 60));
      const runtimeMinutes = Math.round(totalSeconds / 60);

      const tmdbId = Number(item.ProviderIds?.Tmdb) || undefined;
      const deepLinkUrl = `${jellyfinHost}/web/index.html#!/details?id=${item.Id}&serverId=${serverId}`;

      return {
        id: item.Id,
        title: item.Name,
        seriesName: item.SeriesName,
        seasonNumber: item.ParentIndexNumber,
        episodeNumber: item.IndexNumber,
        mediaType: isEpisode ? 'tv' : 'movie',
        tmdbId,
        overview: item.Overview,
        playedPercentage,
        playbackPositionTicks,
        totalTicks,
        runtimeMinutes,
        remainingMinutes,
        posterPath: `/imageproxy/jellyfin/Items/${item.Id}/Images/Primary?fillWidth=400&quality=90`,
        backdropPath:
          item.BackdropImageTags && item.BackdropImageTags.length > 0
            ? `/imageproxy/jellyfin/Items/${item.Id}/Images/Backdrop/0?fillWidth=800&quality=90`
            : `/imageproxy/jellyfin/Items/${item.Id}/Images/Thumb?fillWidth=800&quality=90`,
        deepLinkUrl,
      };
    });

    return res.status(200).json({
      results: items,
      totalResults: items.length,
    });
  } catch (e: any) {
    logger.error('Failed to get resume items from Jellyfin', {
      label: 'Discover',
      error: e.message,
    });
    return res.status(200).json({ results: [] });
  }
});

export default discoverRoutes;

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

// Comprehensive genre mapping in Spanish for clear recommendation badges
const TMDB_GENRES: Record<number, string> = {
  28: 'Acción',
  12: 'Aventura',
  16: 'Animación',
  35: 'Comedia',
  80: 'Crimen',
  99: 'Documental',
  18: 'Drama',
  10751: 'Familia',
  14: 'Fantasía',
  36: 'Historia',
  27: 'Terror',
  10402: 'Música',
  9648: 'Misterio',
  10749: 'Romance',
  878: 'Ciencia Ficción',
  10770: 'Película de TV',
  53: 'Suspense',
  10752: 'Bélica',
  37: 'Western',
  10759: 'Acción y Aventura',
  10762: 'Infantil',
  10763: 'Noticias',
  10764: 'Reality',
  10765: 'Sci-Fi y Fantasía',
  10766: 'Soap / Telenovela',
  10767: 'Talk Show',
  10768: 'Bélica y Política',
};

interface CandidateMeta {
  item: TmdbTvResult | TmdbMovieResult;
  recRank: number | null;
  similarRank: number | null;
  isSuggestarr: boolean;
}

// Major character, superhero & franchise matcher
function extractFranchiseName(
  sourceTitle: string,
  candidateTitle: string,
  candidateOverview: string
): string | null {
  if (!sourceTitle || !candidateTitle) return null;
  const sTitle = sourceTitle.toLowerCase().trim();
  const cTitle = candidateTitle.toLowerCase().trim();
  const cOver = candidateOverview.toLowerCase();

  const KNOWN_FRANCHISES: {
    display: string;
    patterns: string[];
    characterNames?: string[];
  }[] = [
    {
      display: 'Spider-Man',
      patterns: ['spider-man', 'spiderman', 'spider man'],
      characterNames: ['peter parker', 'miles morales'],
    },
    {
      display: 'Batman',
      patterns: ['batman', 'the dark knight', 'dark knight'],
      characterNames: ['bruce wayne'],
    },
    {
      display: 'Superman',
      patterns: ['superman', 'man of steel'],
      characterNames: ['clark kent', 'kal-el'],
    },
    {
      display: 'Iron Man',
      patterns: ['iron man'],
      characterNames: ['tony stark'],
    },
    {
      display: 'Captain America',
      patterns: ['captain america'],
      characterNames: ['steve rogers'],
    },
    {
      display: 'Thor',
      patterns: ['thor'],
      characterNames: ['odinson'],
    },
    {
      display: 'Avengers',
      patterns: ['avengers', 'vengadores'],
    },
    {
      display: 'Star Wars',
      patterns: ['star wars'],
      characterNames: ['skywalker', 'jedi', 'darth vader'],
    },
    {
      display: 'El Señor de los Anillos',
      patterns: [
        'lord of the rings',
        'the hobbit',
        'señor de los anillos',
        'anillos de poder',
      ],
      characterNames: ['frodo', 'bilbo', 'gandalf', 'aragorn', 'sauron'],
    },
    {
      display: 'Harry Potter',
      patterns: ['harry potter', 'fantastic beasts', 'animales fantásticos'],
      characterNames: ['voldemort', 'dumbledore'],
    },
    {
      display: 'Fast & Furious',
      patterns: [
        'fast & furious',
        'fast and furious',
        'rápido y furioso',
        'fast x',
      ],
      characterNames: ['toretto'],
    },
    {
      display: 'Misión Imposible',
      patterns: [
        'mission: impossible',
        'mission impossible',
        'misión imposible',
      ],
      characterNames: ['ethan hunt'],
    },
    {
      display: 'James Bond',
      patterns: ['james bond', '007'],
      characterNames: ['agent 007'],
    },
    {
      display: 'John Wick',
      patterns: ['john wick'],
      characterNames: ['john wick'],
    },
    {
      display: 'Transformers',
      patterns: ['transformers', 'bumblebee'],
      characterNames: ['optimus prime'],
    },
    {
      display: 'Piratas del Caribe',
      patterns: ['pirates of the caribbean', 'piratas del caribe'],
      characterNames: ['jack sparrow'],
    },
    {
      display: 'Jurassic Park / World',
      patterns: ['jurassic park', 'jurassic world'],
    },
    {
      display: 'Shrek',
      patterns: ['shrek', 'puss in boots', 'gato con botas'],
    },
    {
      display: 'Toy Story',
      patterns: ['toy story', 'lightyear'],
    },
    {
      display: 'Deadpool',
      patterns: ['deadpool'],
      characterNames: ['wade wilson'],
    },
    {
      display: 'X-Men / Wolverine',
      patterns: ['x-men', 'wolverine', 'x men', 'mutants'],
      characterNames: ['logan', 'charles xavier', 'magneto'],
    },
    {
      display: 'Avatar',
      patterns: ['avatar'],
      characterNames: ["na'vi", 'pandora', 'jake sully'],
    },
    {
      display: 'Dune',
      patterns: ['dune'],
      characterNames: ['paul atreides', 'arrakis'],
    },
    {
      display: 'Los Juegos del Hambre',
      patterns: ['hunger games', 'juegos del hambre'],
      characterNames: ['katniss'],
    },
  ];

  for (const f of KNOWN_FRANCHISES) {
    const sourceMatches = f.patterns.some((p) => sTitle.includes(p));
    if (sourceMatches) {
      const candidateMatches =
        f.patterns.some((p) => cTitle.includes(p)) ||
        (f.characterNames &&
          f.characterNames.some(
            (cn) => cOver.includes(cn) || cTitle.includes(cn)
          ));
      if (candidateMatches) {
        return f.display;
      }
    }
  }

  // Dynamic prefix extraction (e.g. "Planet of the Apes: Kingdom" vs "Planet of the Apes")
  const splitDelimiters = [':', ' - '];
  for (const delim of splitDelimiters) {
    if (sourceTitle.includes(delim) && candidateTitle.includes(delim)) {
      const sPrefix = sourceTitle.split(delim)[0].trim().toLowerCase();
      const cPrefix = candidateTitle.split(delim)[0].trim().toLowerCase();
      if (
        sPrefix.length >= 4 &&
        (sPrefix === cPrefix ||
          cPrefix.includes(sPrefix) ||
          sPrefix.includes(cPrefix))
      ) {
        return sourceTitle.split(delim)[0].trim();
      }
    }
  }

  return null;
}

// Shared cinematic universe detector (MCU, DC, etc.)
function detectSharedUniverse(
  sourceTitle: string,
  candidateTitle: string,
  sourceOverview: string,
  candidateOverview: string,
  sourceKeywords: string[]
): string | null {
  if (!sourceTitle || !candidateTitle) return null;
  const sAll = `${sourceTitle} ${sourceOverview} ${sourceKeywords.join(' ')}`.toLowerCase();
  const cAll = `${candidateTitle} ${candidateOverview}`.toLowerCase();

  const MARVEL_TERMS = [
    'marvel',
    'mcu',
    'avengers',
    'vengadores',
    'shield',
    's.h.i.e.l.d.',
    'stan lee',
    'stark',
    'captain america',
    'iron man',
    'thor',
    'hulk',
    'black widow',
    'doctor strange',
    'ant-man',
    'black panther',
    'guardians of the galaxy',
    'guardians',
    'thanos',
    'spider-man',
    'spiderman',
    'venom',
    'deadpool',
    'carnage',
    'multiverse of madness',
    'quantum realm',
  ];
  const isSourceMarvel = MARVEL_TERMS.some((t) => sAll.includes(t));
  const isCandidateMarvel = MARVEL_TERMS.some((t) => cAll.includes(t));
  if (isSourceMarvel && isCandidateMarvel) {
    return 'Universo Marvel';
  }

  const DC_TERMS = [
    'dc comics',
    'batman',
    'superman',
    'justice league',
    'liga de la justicia',
    'gotham',
    'clark kent',
    'bruce wayne',
    'wonder woman',
    'aquaman',
    'the flash',
    'joker',
    'harley quinn',
    'krypton',
    'metropolis',
  ];
  const isSourceDC = DC_TERMS.some((t) => sAll.includes(t));
  const isCandidateDC = DC_TERMS.some((t) => cAll.includes(t));
  if (isSourceDC && isCandidateDC) {
    return 'Universo DC';
  }

  return null;
}

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
    const rawCandidates: Map<number, CandidateMeta> = new Map();

    // 1. Fetch source details & keywords to understand genre & themes
    let sourceTitle = '';
    let sourceKeywords: string[] = [];
    let isAnime = false;
    let sourceGenreIds: number[] = [];
    let sourceOverview = '';

    if (mediaType === 'tv') {
      try {
        const sourceShow = await tmdb.getTvShow({ tvId: targetId });
        sourceTitle = sourceShow.name || sourceShow.original_name || '';
        sourceGenreIds = (sourceShow.genres || []).map((g) => g.id);
        sourceOverview = (sourceShow.overview || '').toLowerCase();
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
        sourceTitle = sourceMovie.title || sourceMovie.original_title || '';
        sourceGenreIds = (sourceMovie.genres || []).map((g) => g.id);
        sourceOverview = (sourceMovie.overview || '').toLowerCase();
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

    // 2. Fetch TMDB Recommendations (Audience correlation graph, ranked by affinity)
    try {
      const recs =
        mediaType === 'tv'
          ? await tmdb.getTvRecommendations({ tvId: targetId, page: 1 })
          : await tmdb.getMovieRecommendations({ movieId: targetId, page: 1 });

      recs.results.forEach((rec, idx) => {
        if (rec.id === targetId) return;
        rawCandidates.set(rec.id, {
          item: rec,
          recRank: idx,
          similarRank: null,
          isSuggestarr: false,
        });
      });
    } catch (e) {
      logger.debug('Error getting TMDB recommendations', {
        label: 'Recommendations',
        error: e.message,
      });
    }

    // 3. Fetch TMDB Similar (Metadata similarity)
    try {
      const similars =
        mediaType === 'tv'
          ? await tmdb.getTvSimilar({ tvId: targetId, page: 1 })
          : await tmdb.getMovieSimilar({ movieId: targetId, page: 1 });

      similars.results.forEach((sim, idx) => {
        if (sim.id === targetId) return;
        const existing = rawCandidates.get(sim.id);
        if (existing) {
          existing.similarRank = idx;
        } else {
          rawCandidates.set(sim.id, {
            item: sim,
            recRank: null,
            similarRank: idx,
            isSuggestarr: false,
          });
        }
      });
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
            existing.isSuggestarr = true;
          } else {
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
                  recRank: null,
                  similarRank: null,
                  isSuggestarr: true,
                });
              } else if (sItem.media_type === 'movie' && mediaType === 'movie') {
                const movie = await tmdb.getMovie({ movieId: sTmdbId });
                rawCandidates.set(sTmdbId, {
                  item: {
                    id: movie.id,
                    title: movie.title,
                    original_title: movie.original_title,
                    overview: movie.overview,
                    poster_path: movie.poster_path,
                    backdrop_path: movie.backdrop_path,
                    vote_average: movie.vote_average,
                    vote_count: movie.vote_count,
                    release_date: movie.release_date,
                    genre_ids: (movie.genres || []).map((g) => g.id),
                    popularity: movie.popularity || 10,
                    original_language: movie.original_language,
                  } as TmdbMovieResult,
                  recRank: null,
                  similarRank: null,
                  isSuggestarr: true,
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

    // 5. Compute calibrated affinity scores and dynamic reason tags
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
      .map(({ item, recRank, similarRank, isSuggestarr }) => {
        const reasons: Set<string> = new Set();

        // --- 1. GENRE JACCARD SIMILARITY (0 to 32 pts) ---
        const itemGenreIds = item.genre_ids || [];
        const sharedGenreIds = itemGenreIds.filter((gid) =>
          sourceGenreIds.includes(gid)
        );
        const unionGenreIds = new Set([...sourceGenreIds, ...itemGenreIds]);
        const jaccard =
          unionGenreIds.size > 0
            ? sharedGenreIds.length / unionGenreIds.size
            : 0;

        const genreScore =
          Math.round(jaccard * 26) + Math.min(6, sharedGenreIds.length * 2);

        if (sharedGenreIds.length > 0) {
          const topSharedNames = sharedGenreIds
            .map((id) => TMDB_GENRES[id])
            .filter(Boolean)
            .slice(0, 2);
          if (topSharedNames.length > 0) {
            reasons.add(topSharedNames.join(' & '));
          }
        }

        // --- 2. TMDB AUDIENCE CORRELATION GRAPH (0 to 28 pts) ---
        let tmdbScore = 0;
        if (recRank !== null) {
          if (recRank === 0) {
            tmdbScore = 28;
            reasons.add('Top afinidad TMDB');
          } else if (recRank === 1) {
            tmdbScore = 26;
            reasons.add('Top afinidad TMDB');
          } else if (recRank === 2) {
            tmdbScore = 24;
            reasons.add('Top afinidad TMDB');
          } else if (recRank <= 5) {
            tmdbScore = 21;
            reasons.add('Fuerte correlación');
          } else if (recRank <= 9) {
            tmdbScore = 17;
            reasons.add('Alta afinidad');
          } else if (recRank <= 14) {
            tmdbScore = 13;
            reasons.add('Recomendación de audiencia');
          } else {
            tmdbScore = 10;
          }
        }

        if (similarRank !== null) {
          tmdbScore += 4;
          if (recRank === null) {
            reasons.add('Trama y tono afín');
          }
        }

        // --- 3. THEMATIC MOTIFS & KEYWORDS (0 to 18 pts) ---
        let thematicScore = 0;
        const cOverview = (item.overview || '').toLowerCase();
        const cTitle = (
          (item as TmdbTvResult).name ||
          (item as TmdbMovieResult).title ||
          ''
        ).toLowerCase();

        // Literary / book adaptation
        const isSourceAdaptation =
          sourceKeywords.some((k) =>
            ['novel', 'book', 'adaptation', 'based on novel', 'best-seller'].some(
              (m) => k.includes(m)
            )
          ) || sourceOverview.includes('novel') || sourceOverview.includes('book');
        const isCandidateAdaptation =
          ['novel', 'novela', 'book', 'libro', 'best-seller', 'bestseller', 'adaptation', 'adaptación'].some(
            (m) => cOverview.includes(m)
          );
        if (isSourceAdaptation && isCandidateAdaptation) {
          thematicScore += 6;
          reasons.add('Adaptación literaria');
        }

        // Emotional drama / tearjerker / memory / medical themes
        const isSourceEmotional =
          sourceKeywords.some((k) =>
            ['romance', 'love', 'memory', 'alzheimer', 'illness', 'tragedy', 'hospital'].some(
              (m) => k.includes(m)
            )
          ) || ['alzheimer', 'memory', 'dementia', 'love story'].some((m) => sourceOverview.includes(m));
        const isCandidateEmotional =
          ['memory', 'memoria', 'alzheimer', 'cancer', 'illness', 'enfermedad', 'tragedy', 'tragedia', 'coma', 'amnesia'].some(
            (m) => cOverview.includes(m)
          );
        if (isSourceEmotional && isCandidateEmotional) {
          thematicScore += 6;
          reasons.add('Drama emotivo');
        }

        // Period / wartime / historical era
        const isSourcePeriod =
          sourceKeywords.some((k) =>
            ['war', '1940', '1950', 'period', 'vintage', 'historical'].some(
              (m) => k.includes(m)
            )
          ) || ['war', 'guerra', '1940', '1950', 'world war'].some((m) => sourceOverview.includes(m));
        const isCandidatePeriod =
          ['war', 'guerra', '1940', '1950', '1960', '1970', 'década', 'decades', 'vintage', 'historical'].some(
            (m) => cOverview.includes(m)
          );
        if (isSourcePeriod && isCandidatePeriod) {
          thematicScore += 5;
          reasons.add('Ambientación de época');
        }

        // General keyword overlap
        let kwHits = 0;
        for (const kw of sourceKeywords) {
          if (kw.length >= 4 && (cOverview.includes(kw) || cTitle.includes(kw))) {
            kwHits++;
            if (kwHits <= 3) {
              thematicScore += 3;
            }
          }
        }

        if (isAnime) {
          thematicScore += 5;
          reasons.add('Anime');
        }

        thematicScore = Math.min(18, thematicScore);

        // --- 4. FRANCHISE & UNIVERSE AFFINITY (0 to 20 pts) ---
        let franchiseScore = 0;
        let universeScore = 0;
        const prominentReasons: string[] = [];

        const candidateRawTitle =
          (item as TmdbTvResult).name ||
          (item as TmdbMovieResult).title ||
          '';

        const franchiseName = extractFranchiseName(
          sourceTitle,
          candidateRawTitle,
          cOverview
        );

        if (franchiseName) {
          franchiseScore = 20;
          prominentReasons.push(`Franquicia: ${franchiseName}`);
        } else {
          const universeName = detectSharedUniverse(
            sourceTitle,
            candidateRawTitle,
            sourceOverview,
            cOverview,
            sourceKeywords
          );
          if (universeName) {
            universeScore = 8;
            prominentReasons.push(universeName);
          }
        }

        // --- 5. SUGGESTARR AI INTEGRATION (0 to 14 pts) ---
        let suggestarrScore = 0;
        if (isSuggestarr) {
          suggestarrScore = 14;
          reasons.add('Sugerido por IA (Suggestarr)');
        }

        // --- 6. AUDIENCE QUALITY RECEPTION CALIBRATION (0 to 6 pts) ---
        const voteAvg = item.vote_average || 0;
        let qualityScore = 1;
        if (voteAvg >= 8.0) qualityScore = 6;
        else if (voteAvg >= 7.5) qualityScore = 5;
        else if (voteAvg >= 7.0) qualityScore = 4;
        else if (voteAvg >= 6.5) qualityScore = 3;
        else if (voteAvg >= 6.0) qualityScore = 2;

        // --- 7. TOTAL CALIBRATION (Natural 62% to 96% range) ---
        const baseFoundation = 12;
        const rawTotal =
          baseFoundation +
          genreScore +
          tmdbScore +
          thematicScore +
          franchiseScore +
          universeScore +
          suggestarrScore +
          qualityScore;

        const finalScore = Math.min(96, Math.max(62, rawTotal));

        const title = candidateRawTitle;
        const originalTitle =
          (item as TmdbTvResult).original_name ||
          (item as TmdbMovieResult).original_title;
        const releaseDate =
          (item as TmdbTvResult).first_air_date ||
          (item as TmdbMovieResult).release_date;

        const matchedMedia = mediaEntities.find(
          (m) =>
            m.tmdbId === item.id &&
            m.mediaType ===
              (mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV)
        );

        // Filter and present top 3 informative badges, prioritizing franchise / universe
        const cleanReasons = [
          ...prominentReasons,
          ...Array.from(reasons).filter((r) => !prominentReasons.includes(r)),
        ].slice(0, 3);
        if (cleanReasons.length === 0) {
          cleanReasons.push('Afinidad temática');
        }

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
          matchReasons: cleanReasons,
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

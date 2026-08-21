import Header from '@app/components/Common/Header';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import useDiscover from '@app/hooks/useDiscover';
import useToasts from '@app/hooks/useToasts';
import ErrorPage from '@app/pages/_error';
import RTFresh from '@app/assets/rt_fresh.svg';
import RTRotten from '@app/assets/rt_rotten.svg';
import RTAudFresh from '@app/assets/rt_aud_fresh.svg';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  CheckIcon,
  CurrencyDollarIcon,
  FireIcon,
  SparklesIcon,
  StarIcon,
  TrophyIcon,
} from '@heroicons/react/24/solid';
import type { MovieResult } from '@server/models/Search';
import type { RTRating } from '@server/api/rating/rottentomatoes';
import axios from 'axios';
import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import useSWR from 'swr';

type BoxOfficeFilter = 'theatrical' | 'toprated' | 'boxoffice' | 'popular';

// Component to dynamically display Rotten Tomatoes & IMDb Ratings
const MovieCardRatings = ({ movieId, tmdbScore }: { movieId: number; tmdbScore: number }) => {
  const { data: ratings } = useSWR<RTRating>(`/api/v1/movie/${movieId}/ratings`, {
    revalidateOnFocus: false,
    dedupingInterval: 60000,
  });

  return (
    <div className="absolute bottom-2 left-2 z-10 flex flex-wrap items-center gap-1.5 rounded-md bg-black/80 px-2 py-0.5 text-[11px] font-bold text-white shadow-lg backdrop-blur-md">
      {/* TMDb / IMDb Rating */}
      {tmdbScore > 0 && (
        <div className="flex items-center gap-1 text-amber-400">
          <StarIcon className="h-3 w-3 fill-amber-400 text-amber-400" />
          <span>{tmdbScore.toFixed(1)}</span>
        </div>
      )}

      {/* Rotten Tomatoes Critics Tomatometer */}
      {ratings?.criticsScore !== undefined && ratings.criticsScore !== null && (
        <div className="flex items-center gap-1 border-l border-gray-700 pl-1.5">
          {ratings.criticsScore >= 60 ? (
            <RTFresh className="h-3 w-3" />
          ) : (
            <RTRotten className="h-3 w-3" />
          )}
          <span className={ratings.criticsScore >= 60 ? 'text-rose-400' : 'text-emerald-400'}>
            {ratings.criticsScore}%
          </span>
        </div>
      )}

      {/* Rotten Tomatoes Audience Score */}
      {ratings?.audienceScore !== undefined && ratings.audienceScore !== null && (
        <div className="flex items-center gap-1 border-l border-gray-700 pl-1.5">
          <RTAudFresh className="h-3 w-3" />
          <span className="text-amber-300">{ratings.audienceScore}%</span>
        </div>
      )}
    </div>
  );
};

const DiscoverBoxOffice = () => {
  const { addToast } = useToasts();
  const [activeFilter, setActiveFilter] = useState<BoxOfficeFilter>('theatrical');
  const [selectedMovieIds, setSelectedMovieIds] = useState<number[]>([]);
  const [isBatchRequesting, setIsBatchRequesting] = useState(false);

  // Exact bounds so future / unreleased movies NEVER display
  const todayString = useMemo(() => new Date().toISOString().split('T')[0], []);
  const ninetyDaysAgoString = useMemo(
    () => new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    []
  );
  const twoYearsAgoString = useMemo(
    () => new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    []
  );

  const queryParams = useMemo(() => {
    if (activeFilter === 'theatrical') {
      return {
        sortBy: 'popularity.desc',
        primaryReleaseDateLte: todayString,
        primaryReleaseDateGte: ninetyDaysAgoString,
      };
    }
    if (activeFilter === 'toprated') {
      return {
        sortBy: 'vote_average.desc',
        voteCountGte: '100',
        voteAverageGte: '7.0',
        primaryReleaseDateLte: todayString,
        primaryReleaseDateGte: twoYearsAgoString,
      };
    }
    if (activeFilter === 'boxoffice') {
      return {
        sortBy: 'revenue.desc',
        primaryReleaseDateLte: todayString,
      };
    }
    return {
      sortBy: 'popularity.desc',
      primaryReleaseDateLte: todayString,
    };
  }, [activeFilter, todayString, ninetyDaysAgoString, twoYearsAgoString]);

  const { titles, isLoadingInitialData, isLoadingMore, isReachingEnd, fetchMore, error, mutate } =
    useDiscover<
      MovieResult,
      never,
      {
        sortBy?: string;
        primaryReleaseDateGte?: string;
        primaryReleaseDateLte?: string;
        voteCountGte?: string;
        voteAverageGte?: string;
      }
    >('/api/v1/discover/movies', queryParams);

  // Strict client-side filter guaranteeing no future dates
  const filteredTitles = useMemo(() => {
    return titles.filter((movie) => !movie.releaseDate || movie.releaseDate <= todayString);
  }, [titles, todayString]);

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  const toggleSelectMovie = (id: number) => {
    if (selectedMovieIds.includes(id)) {
      setSelectedMovieIds(selectedMovieIds.filter((mId) => mId !== id));
    } else {
      setSelectedMovieIds([...selectedMovieIds, id]);
    }
  };

  const selectAllLoaded = () => {
    const unrequestedIds = filteredTitles
      .filter((t) => !t.mediaInfo || t.mediaInfo.status === 1)
      .map((t) => t.id);
    setSelectedMovieIds(unrequestedIds);
  };

  const clearSelection = () => {
    setSelectedMovieIds([]);
  };

  const handleBatchRequest = async () => {
    if (selectedMovieIds.length === 0) return;
    setIsBatchRequesting(true);

    let successCount = 0;
    let failCount = 0;

    for (const mediaId of selectedMovieIds) {
      try {
        await axios.post('/api/v1/request', {
          mediaId,
          mediaType: 'movie',
          is4k: false,
        });
        successCount++;
      } catch {
        failCount++;
      }
    }

    setIsBatchRequesting(false);
    setSelectedMovieIds([]);
    mutate?.();

    if (successCount > 0) {
      addToast(`Successfully requested ${successCount} box-office movies!`, {
        appearance: 'success',
        autoDismiss: true,
      });
    }
    if (failCount > 0) {
      addToast(`Failed to request ${failCount} movies.`, {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  return (
    <>
      <PageTitle title="Box Office & Top Rated" />
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <Header subtext="Browse current theatrical hits, top grossing blockbusters, and critically acclaimed movies with live Rotten Tomatoes & IMDb ratings.">
            Box Office & Top Rated
          </Header>
        </div>

        {/* Filter Switcher */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-gray-800 bg-gray-900/80 p-1.5 backdrop-blur-md">
          <button
            type="button"
            onClick={() => {
              setActiveFilter('theatrical');
              setSelectedMovieIds([]);
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeFilter === 'theatrical'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <SparklesIcon className="h-4 w-4" />
            <span>In Theaters Now</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveFilter('toprated');
              setSelectedMovieIds([]);
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeFilter === 'toprated'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <TrophyIcon className="h-4 w-4 text-amber-300" />
            <span>Top Rated & Critics 🍅</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveFilter('boxoffice');
              setSelectedMovieIds([]);
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeFilter === 'boxoffice'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <CurrencyDollarIcon className="h-4 w-4" />
            <span>Top Grossing</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveFilter('popular');
              setSelectedMovieIds([]);
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeFilter === 'popular'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <FireIcon className="h-4 w-4" />
            <span>Most Popular</span>
          </button>
        </div>
      </div>

      {/* BATCH SELECTION ACTION BAR */}
      <div className="sticky top-16 z-30 mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/30 bg-gray-900/95 px-5 py-3.5 shadow-xl backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/20 text-xs font-bold text-amber-400">
            {selectedMovieIds.length}
          </span>
          <span className="text-sm font-medium text-gray-200">
            {selectedMovieIds.length === 1 ? '1 movie selected' : `${selectedMovieIds.length} movies selected`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={selectAllLoaded}
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
          >
            Select All Available
          </button>

          {selectedMovieIds.length > 0 && (
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-lg border border-gray-700 bg-transparent px-3 py-1.5 text-xs font-medium text-gray-400 transition-colors hover:text-gray-200"
            >
              Clear
            </button>
          )}

          <button
            type="button"
            disabled={selectedMovieIds.length === 0 || isBatchRequesting}
            onClick={handleBatchRequest}
            className={`flex items-center gap-2 rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${
              selectedMovieIds.length > 0 && !isBatchRequesting
                ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-lg shadow-amber-500/25 hover:from-amber-600 hover:to-amber-700'
                : 'cursor-not-allowed bg-gray-800 text-gray-500'
            }`}
          >
            {isBatchRequesting ? (
              <>
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
                <span>Requesting Batch...</span>
              </>
            ) : (
              <>
                <CheckIcon className="h-4 w-4" />
                <span>Request Selected ({selectedMovieIds.length})</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* MOVIE GRID WITH ROTTEN TOMATOES & IMDB RATINGS */}
      {isLoadingInitialData ? (
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 pb-12">
          {filteredTitles.map((movie) => {
            const isSelected = selectedMovieIds.includes(movie.id);
            const isAvailable = movie.mediaInfo?.status === 5;
            const isPending = movie.mediaInfo?.status === 2 || movie.mediaInfo?.status === 3 || movie.mediaInfo?.status === 4;

            return (
              <div
                key={movie.id}
                onClick={() => !isAvailable && toggleSelectMovie(movie.id)}
                className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border transition-all duration-300 ${
                  isSelected
                    ? 'border-amber-500 bg-amber-500/10 shadow-lg shadow-amber-500/20 ring-2 ring-amber-500'
                    : 'border-gray-800/80 bg-gray-900/60 hover:border-gray-700 hover:shadow-xl'
                }`}
              >
                {/* Checkbox Overlay */}
                <div className="absolute right-2.5 top-2.5 z-20">
                  {isAvailable ? (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-600/90 px-2 py-0.5 text-[10px] font-bold text-white shadow-md backdrop-blur-md">
                      <CheckCircleIcon className="h-3.5 w-3.5" />
                      <span>Available</span>
                    </span>
                  ) : isPending ? (
                    <span className="flex items-center gap-1 rounded-full bg-indigo-600/90 px-2 py-0.5 text-[10px] font-bold text-white shadow-md backdrop-blur-md">
                      <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
                      <span>Requested</span>
                    </span>
                  ) : (
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded-lg border transition-all ${
                        isSelected
                          ? 'border-amber-500 bg-amber-500 text-black shadow-md'
                          : 'border-white/40 bg-black/60 text-transparent backdrop-blur-md hover:border-amber-400'
                      }`}
                    >
                      <CheckIcon className="h-4 w-4 stroke-[3]" />
                    </div>
                  )}
                </div>

                {/* Poster Container */}
                <div className="relative aspect-[2/3] w-full overflow-hidden bg-gray-800">
                  {movie.posterPath ? (
                    <Image
                      src={`https://image.tmdb.org/t/p/w500${movie.posterPath}`}
                      alt={movie.title}
                      fill
                      sizes="(max-width: 768px) 50vw, (max-width: 1200px) 25vw, 16vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-gray-500">
                      No Poster
                    </div>
                  )}

                  {/* Rotten Tomatoes, IMDb & TMDb Badges */}
                  <MovieCardRatings movieId={movie.id} tmdbScore={movie.voteAverage} />
                </div>

                {/* Details Footer */}
                <div className="flex flex-grow flex-col justify-between p-3">
                  <div>
                    <h3 className="line-clamp-1 text-xs font-bold text-gray-100 transition-colors group-hover:text-amber-400">
                      {movie.title}
                    </h3>
                    <p className="mt-0.5 text-[11px] text-gray-400">
                      {movie.releaseDate ? movie.releaseDate : 'Released'}
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-gray-800/80 pt-2 text-[10px]">
                    <Link
                      href={`/movie/${movie.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-gray-400 hover:text-amber-400"
                    >
                      Details &rarr;
                    </Link>

                    {!isAvailable && !isPending && (
                      <span className="font-semibold text-amber-400/90">
                        {isSelected ? 'Selected' : 'Click to select'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Infinite Scroll trigger */}
      {!isReachingEnd && (
        <div className="flex justify-center pb-12">
          <button
            type="button"
            disabled={isLoadingMore}
            onClick={() => fetchMore()}
            className="rounded-xl border border-gray-700 bg-gray-800/90 px-6 py-2.5 text-xs font-semibold text-gray-200 transition-all hover:bg-gray-700 hover:text-white"
          >
            {isLoadingMore ? 'Loading more movies...' : 'Load More Movies'}
          </button>
        </div>
      )}
    </>
  );
};

export default DiscoverBoxOffice;

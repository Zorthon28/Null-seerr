import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import MediaSlider from '@app/components/MediaSlider';
import useDiscover from '@app/hooks/useDiscover';
import { useUpdateQueryParams } from '@app/hooks/useUpdateQueryParams';
import ErrorPage from '@app/pages/_error';
import { BarsArrowDownIcon, FilmIcon, SparklesIcon, TvIcon } from '@heroicons/react/24/solid';
import type { SortOptions as TMDBSortOptions } from '@server/api/themoviedb';
import type { MovieResult, TvResult } from '@server/models/Search';
import { useRouter } from 'next/router';
import { useState } from 'react';

const SortOptions: Record<string, TMDBSortOptions> = {
  PopularityAsc: 'popularity.asc',
  PopularityDesc: 'popularity.desc',
  FirstAirDateAsc: 'first_air_date.asc',
  FirstAirDateDesc: 'first_air_date.desc',
  TmdbRatingAsc: 'vote_average.asc',
  TmdbRatingDesc: 'vote_average.desc',
  TitleAsc: 'original_title.asc',
  TitleDesc: 'original_title.desc',
} as const;

type AnimeTab = 'featured' | 'series' | 'movies';

const DiscoverAnime = () => {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AnimeTab>('featured');
  const updateQueryParams = useUpdateQueryParams({});

  const sortBy = (router.query.sortBy as string) || SortOptions.PopularityDesc;

  // TV Anime Infinite Query
  const tvAnime = useDiscover<TvResult, never, { sortBy?: string; genre?: string; keywords?: string }>(
    '/api/v1/discover/tv',
    {
      genre: '16',
      keywords: '210024',
      sortBy,
    }
  );

  // Movie Anime Infinite Query
  const movieAnime = useDiscover<MovieResult, never, { sortBy?: string; genre?: string; keywords?: string }>(
    '/api/v1/discover/movies',
    {
      genre: '16',
      keywords: '210024',
      sortBy,
    }
  );

  if (tvAnime.error || movieAnime.error) {
    return <ErrorPage statusCode={500} />;
  }

  return (
    <>
      <PageTitle title="Anime" />
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <Header subtext="Explore popular, top-rated, and upcoming anime series and movies powered by TMDB & AniDB.">
            Anime Hub
          </Header>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-2 rounded-xl border border-gray-800 bg-gray-900/80 p-1.5 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setActiveTab('featured')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'featured'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <SparklesIcon className="h-4 w-4" />
            <span>Featured</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('series')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'series'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <TvIcon className="h-4 w-4" />
            <span>All Series</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('movies')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              activeTab === 'movies'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <FilmIcon className="h-4 w-4" />
            <span>All Movies</span>
          </button>
        </div>
      </div>

      {/* VIEW 1: FEATURED CAROUSELS & SLIDERS */}
      {activeTab === 'featured' && (
        <div className="space-y-4 pb-12">
          <MediaSlider
            sliderKey="anime-popular-series"
            title="Popular Anime Series"
            url="/api/v1/discover/tv"
            extraParams="genre=16&keywords=210024&sortBy=popularity.desc"
          />

          <MediaSlider
            sliderKey="anime-top-rated"
            title="Top Rated Anime"
            url="/api/v1/discover/tv"
            extraParams="genre=16&keywords=210024&sortBy=vote_average.desc&voteCountGte=150"
          />

          <MediaSlider
            sliderKey="anime-movies"
            title="Anime Movies & Features"
            url="/api/v1/discover/movies"
            extraParams="genre=16&keywords=210024&sortBy=popularity.desc"
          />

          <MediaSlider
            sliderKey="anime-upcoming"
            title="New & Upcoming Anime"
            url="/api/v1/discover/tv"
            extraParams="genre=16&keywords=210024&sortBy=first_air_date.desc"
          />
        </div>
      )}

      {/* VIEW 2: ALL SERIES GRID */}
      {activeTab === 'series' && (
        <div className="space-y-4 pb-12">
          <div className="flex items-center justify-end">
            <div className="flex items-center">
              <span className="inline-flex items-center rounded-l-md border border-r-0 border-gray-700 bg-gray-800 px-3 py-2 text-gray-300 sm:text-sm">
                <BarsArrowDownIcon className="h-4 w-4" />
              </span>
              <select
                id="sortBySeries"
                name="sortBySeries"
                className="rounded-r-md border border-gray-700 bg-gray-800/90 py-2 pl-3 pr-8 text-xs font-semibold text-gray-200 focus:border-indigo-500 focus:ring-indigo-500"
                value={sortBy}
                onChange={(e) => updateQueryParams('sortBy', e.target.value)}
              >
                <option value={SortOptions.PopularityDesc}>Popularity Descending</option>
                <option value={SortOptions.PopularityAsc}>Popularity Ascending</option>
                <option value={SortOptions.FirstAirDateDesc}>First Air Date Descending</option>
                <option value={SortOptions.FirstAirDateAsc}>First Air Date Ascending</option>
                <option value={SortOptions.TmdbRatingDesc}>TMDB Rating Descending</option>
                <option value={SortOptions.TmdbRatingAsc}>TMDB Rating Ascending</option>
              </select>
            </div>
          </div>

          <ListView
            items={tvAnime.titles}
            isEmpty={tvAnime.isEmpty}
            isLoading={tvAnime.isLoadingInitialData}
            isReachingEnd={tvAnime.isReachingEnd}
            onScrollBottom={tvAnime.fetchMore}
          />
        </div>
      )}

      {/* VIEW 3: ALL MOVIES GRID */}
      {activeTab === 'movies' && (
        <div className="space-y-4 pb-12">
          <div className="flex items-center justify-end">
            <div className="flex items-center">
              <span className="inline-flex items-center rounded-l-md border border-gray-700 bg-gray-800 px-3 py-2 text-gray-300 sm:text-sm">
                <BarsArrowDownIcon className="h-4 w-4" />
              </span>
              <select
                id="sortByMovies"
                name="sortByMovies"
                className="rounded-r-md border border-gray-700 bg-gray-800/90 py-2 pl-3 pr-8 text-xs font-semibold text-gray-200 focus:border-indigo-500 focus:ring-indigo-500"
                value={sortBy}
                onChange={(e) => updateQueryParams('sortBy', e.target.value)}
              >
                <option value={SortOptions.PopularityDesc}>Popularity Descending</option>
                <option value={SortOptions.PopularityAsc}>Popularity Ascending</option>
                <option value={SortOptions.FirstAirDateDesc}>Release Date Descending</option>
                <option value={SortOptions.FirstAirDateAsc}>Release Date Ascending</option>
                <option value={SortOptions.TmdbRatingDesc}>TMDB Rating Descending</option>
                <option value={SortOptions.TmdbRatingAsc}>TMDB Rating Ascending</option>
              </select>
            </div>
          </div>

          <ListView
            items={movieAnime.titles}
            isEmpty={movieAnime.isEmpty}
            isLoading={movieAnime.isLoadingInitialData}
            isReachingEnd={movieAnime.isReachingEnd}
            onScrollBottom={movieAnime.fetchMore}
          />
        </div>
      )}
    </>
  );
};

export default DiscoverAnime;

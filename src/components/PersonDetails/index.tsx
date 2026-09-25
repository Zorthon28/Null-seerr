import Ellipsis from '@app/assets/ellipsis.svg';
import CachedImage from '@app/components/Common/CachedImage';
import ImageFader from '@app/components/Common/ImageFader';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import ExternalLinkBlock from '@app/components/ExternalLinkBlock';
import TitleCard from '@app/components/TitleCard';
import globalMessages from '@app/i18n/globalMessages';
import ErrorPage from '@app/pages/_error';
import defineMessages from '@app/utils/defineMessages';
import { BarsArrowDownIcon, CircleStackIcon } from '@heroicons/react/24/solid';
import type { PersonCombinedCreditsResponse } from '@server/interfaces/api/personInterfaces';
import type { PersonDetails as PersonDetailsType } from '@server/models/Person';
import { groupBy } from 'lodash';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { useIntl } from 'react-intl';
import TruncateMarkup from 'react-truncate-markup';
import useSWR from 'swr';

const messages = defineMessages('components.PersonDetails', {
  birthdate: 'Born {birthdate}',
  lifespan: '{birthdate} – {deathdate}',
  alsoknownas: 'Also Known As: {names}',
  appearsin: 'Appearances',
  crewmember: 'Crew',
  ascharacter: 'as {character}',
  sortPopularityDesc: 'Most Popular',
  sortReleaseDateDesc: 'Release Date (Newest)',
  sortReleaseDateAsc: 'Release Date (Oldest)',
  sortTmdbRatingDesc: 'Highest Rated',
  sortTitleAsc: 'Title (A-Z)',
});

type MediaType = 'all' | 'movie' | 'tv';

type PersonSortOption =
  | 'popularity.desc'
  | 'popularity.asc'
  | 'release_date.desc'
  | 'release_date.asc'
  | 'vote_average.desc'
  | 'title.asc';

const sortCredits = (items: any[], sortBy: PersonSortOption) => {
  return [...items].sort((a, b) => {
    switch (sortBy) {
      case 'release_date.desc': {
        const aDate = a.releaseDate || a.firstAirDate || '';
        const bDate = b.releaseDate || b.firstAirDate || '';
        if (!aDate && !bDate) return 0;
        if (!aDate) return 1;
        if (!bDate) return -1;
        return bDate.localeCompare(aDate);
      }
      case 'release_date.asc': {
        const aDate = a.releaseDate || a.firstAirDate || '';
        const bDate = b.releaseDate || b.firstAirDate || '';
        if (!aDate && !bDate) return 0;
        if (!aDate) return 1;
        if (!bDate) return -1;
        return aDate.localeCompare(bDate);
      }
      case 'vote_average.desc': {
        const aRating = a.voteAverage ?? 0;
        const bRating = b.voteAverage ?? 0;
        if (bRating !== aRating) {
          return bRating - aRating;
        }
        return (b.voteCount ?? 0) - (a.voteCount ?? 0);
      }
      case 'title.asc': {
        const aTitle = (a.title || a.name || '').toLowerCase();
        const bTitle = (b.title || b.name || '').toLowerCase();
        return aTitle.localeCompare(bTitle);
      }
      case 'popularity.asc': {
        const aVotes = a.voteCount ?? 0;
        const bVotes = b.voteCount ?? 0;
        if (aVotes !== bVotes) {
          return aVotes - bVotes;
        }
        return (a.popularity ?? 0) - (b.popularity ?? 0);
      }
      case 'popularity.desc':
      default: {
        const aVotes = a.voteCount ?? 0;
        const bVotes = b.voteCount ?? 0;
        if (aVotes !== bVotes) {
          return bVotes - aVotes;
        }
        return (b.popularity ?? 0) - (a.popularity ?? 0);
      }
    }
  });
};

const PersonDetails = () => {
  const intl = useIntl();
  const router = useRouter();
  const [currentMediaType, setCurrentMediaType] = useState<MediaType>(
    (router.query.mediaType as MediaType) || 'all'
  );
  const [currentSortBy, setCurrentSortBy] = useState<PersonSortOption>(
    (router.query.sortBy as PersonSortOption) || 'popularity.desc'
  );

  useEffect(() => {
    if (router.query.sortBy) {
      setCurrentSortBy(router.query.sortBy as PersonSortOption);
    }
    if (router.query.mediaType) {
      setCurrentMediaType(router.query.mediaType as MediaType);
    }
  }, [router.query.sortBy, router.query.mediaType]);

  const handleSortChange = (newSort: PersonSortOption) => {
    setCurrentSortBy(newSort);
    router.replace(
      {
        pathname: router.pathname,
        query: {
          ...router.query,
          sortBy: newSort,
        },
      },
      undefined,
      { shallow: true }
    );
  };

  const handleMediaTypeChange = (newType: MediaType) => {
    setCurrentMediaType(newType);
    router.replace(
      {
        pathname: router.pathname,
        query: {
          ...router.query,
          mediaType: newType,
        },
      },
      undefined,
      { shallow: true }
    );
  };
  const { data, error } = useSWR<PersonDetailsType>(
    `/api/v1/person/${router.query.personId}`
  );
  const [showBio, setShowBio] = useState(false);

  const { data: combinedCredits, error: errorCombinedCredits } =
    useSWR<PersonCombinedCreditsResponse>(
      `/api/v1/person/${router.query.personId}/combined_credits`
    );

  const sortedCast = useMemo(() => {
    const filtered = (combinedCredits?.cast ?? []).filter(
      (media) =>
        currentMediaType === 'all' || media.mediaType === currentMediaType
    );
    const grouped = groupBy(filtered, 'id');

    const reduced = Object.values(grouped).map((objs) => {
      const bestDate =
        objs.find((o) => o.releaseDate)?.releaseDate ||
        objs.find((o) => o.firstAirDate)?.firstAirDate;
      return {
        ...objs[0],
        releaseDate: objs[0].releaseDate || bestDate || '',
        firstAirDate: objs[0].firstAirDate || bestDate || '',
        character: objs.map((pos) => pos.character).filter(Boolean).join(', '),
      };
    });

    return sortCredits(reduced, currentSortBy);
  }, [combinedCredits, currentMediaType, currentSortBy]);

  const sortedCrew = useMemo(() => {
    const filtered = (combinedCredits?.crew ?? []).filter(
      (media) =>
        currentMediaType === 'all' || media.mediaType === currentMediaType
    );
    const grouped = groupBy(filtered, 'id');

    const reduced = Object.values(grouped).map((objs) => {
      const bestDate =
        objs.find((o) => o.releaseDate)?.releaseDate ||
        objs.find((o) => o.firstAirDate)?.firstAirDate;
      return {
        ...objs[0],
        releaseDate: objs[0].releaseDate || bestDate || '',
        firstAirDate: objs[0].firstAirDate || bestDate || '',
        job: objs.map((pos) => pos.job).filter(Boolean).join(', '),
      };
    });

    return sortCredits(reduced, currentSortBy);
  }, [combinedCredits, currentMediaType, currentSortBy]);

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <ErrorPage statusCode={404} />;
  }

  const personAttributes: string[] = [];

  if (data.birthday) {
    if (data.deathday) {
      personAttributes.push(
        intl.formatMessage(messages.lifespan, {
          birthdate: intl.formatDate(data.birthday, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'UTC',
          }),
          deathdate: intl.formatDate(data.deathday, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'UTC',
          }),
        })
      );
    } else {
      personAttributes.push(
        intl.formatMessage(messages.birthdate, {
          birthdate: intl.formatDate(data.birthday, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'UTC',
          }),
        })
      );
    }
  }

  if (data.placeOfBirth) {
    personAttributes.push(data.placeOfBirth);
  }

  const isLoading = !combinedCredits && !errorCombinedCredits;

  const filterControls = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-grow sm:flex-grow-0">
        <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-gray-100 sm:text-sm">
          <BarsArrowDownIcon className="h-5 w-5" />
        </span>
        <select
          id="sortBy"
          name="sortBy"
          className="rounded-r-only text-sm"
          value={currentSortBy}
          onChange={(e) => handleSortChange(e.target.value as PersonSortOption)}
        >
          <option value="popularity.desc">
            {intl.formatMessage(messages.sortPopularityDesc)}
          </option>
          <option value="release_date.desc">
            {intl.formatMessage(messages.sortReleaseDateDesc)}
          </option>
          <option value="release_date.asc">
            {intl.formatMessage(messages.sortReleaseDateAsc)}
          </option>
          <option value="vote_average.desc">
            {intl.formatMessage(messages.sortTmdbRatingDesc)}
          </option>
          <option value="title.asc">
            {intl.formatMessage(messages.sortTitleAsc)}
          </option>
        </select>
      </div>

      <div className="flex flex-grow sm:flex-grow-0">
        <span className="inline-flex cursor-default items-center rounded-l-md border border-r-0 border-gray-500 bg-gray-800 px-3 text-sm text-gray-100">
          <CircleStackIcon className="h-5 w-5" />
        </span>
        <select
          id="mediaType"
          name="mediaType"
          onChange={(e) => {
            handleMediaTypeChange(e.target.value as MediaType);
          }}
          value={currentMediaType}
          className="rounded-r-only text-sm"
        >
          <option value="all">{intl.formatMessage(globalMessages.all)}</option>
          <option value="movie">
            {intl.formatMessage(globalMessages.movies)}
          </option>
          <option value="tv">{intl.formatMessage(globalMessages.tvshows)}</option>
        </select>
      </div>
    </div>
  );

  const cast = (sortedCast ?? []).length > 0 && (
    <>
      <div className="slider-header">
        <div className="slider-title">
          <span>{intl.formatMessage(messages.appearsin)}</span>
        </div>
      </div>
      <ul className="cards-vertical">
        {sortedCast?.map((media, index) => {
          const yearStr = (
            media.mediaType === 'movie'
              ? media.releaseDate
              : media.firstAirDate
          )?.slice(0, 4);

          return (
            <li key={`list-cast-item-${media.id}-${index}`}>
              <TitleCard
                key={media.id}
                id={media.id}
                title={media.mediaType === 'movie' ? media.title : media.name}
                userScore={media.voteAverage}
                year={
                  media.mediaType === 'movie'
                    ? media.releaseDate
                    : media.firstAirDate
                }
                image={media.posterPath}
                summary={media.overview}
                mediaType={media.mediaType as 'movie' | 'tv'}
                status={media.mediaInfo?.status}
                canExpand
              />
              <div className="mt-1.5 w-full text-center text-xs text-gray-400">
                {yearStr && (
                  <span className="font-semibold text-gray-300">
                    {yearStr}
                  </span>
                )}
                {yearStr && media.character && <span> • </span>}
                {media.character && (
                  <span title={media.character}>
                    {intl.formatMessage(messages.ascharacter, {
                      character: media.character,
                    })}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );

  const crew = (sortedCrew ?? []).length > 0 && (
    <>
      <div className="slider-header">
        <div className="slider-title">
          <span>{intl.formatMessage(messages.crewmember)}</span>
        </div>
      </div>
      <ul className="cards-vertical">
        {sortedCrew?.map((media, index) => {
          const yearStr = (
            media.mediaType === 'movie'
              ? media.releaseDate
              : media.firstAirDate
          )?.slice(0, 4);

          return (
            <li key={`list-crew-item-${media.id}-${index}`}>
              <TitleCard
                key={media.id}
                id={media.id}
                title={media.mediaType === 'movie' ? media.title : media.name}
                userScore={media.voteAverage}
                year={
                  media.mediaType === 'movie'
                    ? media.releaseDate
                    : media.firstAirDate
                }
                image={media.posterPath}
                summary={media.overview}
                mediaType={media.mediaType as 'movie' | 'tv'}
                status={media.mediaInfo?.status}
                canExpand
              />
              <div className="mt-1.5 w-full text-center text-xs text-gray-400">
                {yearStr && (
                  <span className="font-semibold text-gray-300">
                    {yearStr}
                  </span>
                )}
                {yearStr && media.job && <span> • </span>}
                {media.job && (
                  <span title={media.job}>
                    {media.job}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );

  return (
    <>
      <PageTitle title={data.name} />
      {(sortedCrew || sortedCast) && (
        <div className="absolute left-0 right-0 top-0 z-0 h-96">
          <ImageFader
            isDarker
            backgroundImages={[...(sortedCast ?? []), ...(sortedCrew ?? [])]
              .filter((media) => media.backdropPath)
              .map(
                (media) =>
                  `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${media.backdropPath}`
              )
              .slice(0, 6)}
          />
        </div>
      )}
      <div
        className={`relative z-10 mb-8 mt-4 flex flex-col items-center lg:flex-row ${
          data.biography ? 'lg:items-start' : ''
        }`}
      >
        {data.profilePath && (
          <div className="relative mb-6 mr-0 h-36 w-36 flex-shrink-0 overflow-hidden rounded-full ring-1 ring-gray-700 lg:mb-0 lg:mr-6 lg:h-44 lg:w-44">
            <CachedImage
              type="tmdb"
              src={`https://image.tmdb.org/t/p/w600_and_h900_bestv2${data.profilePath}`}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              fill
            />
          </div>
        )}
        <div className="w-full text-center text-gray-300 lg:text-left">
          <div className="flex w-full items-center justify-center lg:justify-between">
            <h1 className="text-3xl text-white lg:text-4xl">{data.name}</h1>
            <div className="hidden flex-shrink-0 lg:block">
              {filterControls}
            </div>
          </div>
          <div className="flex w-full items-center justify-center lg:justify-between">
            <div className="mb-3 mt-3">
              <ExternalLinkBlock
                mediaType="person"
                tmdbId={data.id}
                imdbId={data.imdbId}
              />
            </div>
          </div>
          <div className="mb-2 mt-1 space-y-1 text-xs text-white sm:text-sm lg:text-base">
            <div>{personAttributes.join(' | ')}</div>
            {(data.alsoKnownAs ?? []).length > 0 && (
              <div>
                {intl.formatMessage(messages.alsoknownas, {
                  names: (data.alsoKnownAs ?? []).reduce((prev, curr) =>
                    intl.formatMessage(globalMessages.delimitedlist, {
                      a: prev,
                      b: curr,
                    })
                  ),
                })}
              </div>
            )}
          </div>
          <div className="my-3 flex justify-center lg:hidden">
            {filterControls}
          </div>
          {data.biography && (
            <div className="relative text-left">
              {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
              <div
                className="group outline-none ring-0"
                onClick={() => setShowBio((show) => !show)}
                role="button"
                tabIndex={-1}
              >
                <TruncateMarkup
                  lines={showBio ? 200 : 6}
                  ellipsis={
                    <Ellipsis className="relative -top-0.5 ml-2 inline-block opacity-70 transition duration-300 group-hover:opacity-100" />
                  }
                >
                  <p className="pt-2 text-sm lg:text-base">{data.biography}</p>
                </TruncateMarkup>
              </div>
            </div>
          )}
        </div>
      </div>
      {data.knownForDepartment === 'Acting' ? [cast, crew] : [crew, cast]}
      {isLoading && <LoadingSpinner />}
    </>
  );
};

export default PersonDetails;

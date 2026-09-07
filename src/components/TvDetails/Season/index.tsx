import AirDateBadge from '@app/components/AirDateBadge';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import useToasts from '@app/hooks/useToasts';
import useWatchStatus from '@app/hooks/useWatchStatus';
import defineMessages from '@app/utils/defineMessages';
import type { SeasonWithEpisodes } from '@server/models/Tv';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.TvDetails.Season', {
  somethingwentwrong: 'Something went wrong while retrieving season data.',
  noepisodes: 'Episode list unavailable.',
});

type SeasonProps = {
  seasonNumber: number;
  tvId: number;
};

const Season = ({ seasonNumber, tvId }: SeasonProps) => {
  const intl = useIntl();
  const toasts = useToasts();
  const { data, error } = useSWR<SeasonWithEpisodes>(
    `/api/v1/tv/${tvId}/season/${seasonNumber}`
  );
  const { watchStatus, markWatchStatus, isUpdating } = useWatchStatus('tv', tvId);

  if (!data && !error) {
    return <LoadingSpinner />;
  }

  if (!data) {
    return <div>{intl.formatMessage(messages.somethingwentwrong)}</div>;
  }

  const seasonEpisodes = data.episodes;
  const seasonWatchedCount = seasonEpisodes.filter(
    (ep) => watchStatus?.episodes?.[`s${seasonNumber}e${ep.episodeNumber}`]?.played
  ).length;
  const isSeasonAllWatched =
    seasonEpisodes.length > 0 && seasonWatchedCount === seasonEpisodes.length;

  return (
    <div className="flex flex-col justify-center divide-y divide-gray-700">
      {watchStatus?.hasMedia && seasonEpisodes.length > 0 && (
        <div className="flex items-center justify-between pb-3 pt-1">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
            {seasonWatchedCount} / {seasonEpisodes.length} Episodes Watched
          </span>
          <button
            type="button"
            disabled={isUpdating}
            onClick={async () => {
              const newPlayed = !isSeasonAllWatched;
              await markWatchStatus({ played: newPlayed, seasonNumber });
              toasts.addToast(
                newPlayed
                  ? `Marked Season ${seasonNumber} as watched in Jellyfin`
                  : `Marked Season ${seasonNumber} as unwatched in Jellyfin`,
                { appearance: 'success', autoDismiss: true }
              );
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-gray-800/80 px-2.5 py-1 text-xs font-medium text-gray-200 ring-1 ring-inset ring-gray-700 hover:bg-gray-700 hover:text-white transition cursor-pointer"
          >
            <svg
              className={`h-3.5 w-3.5 ${isSeasonAllWatched ? 'text-green-400' : 'text-gray-400'}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            {isSeasonAllWatched ? 'Mark Season Unwatched' : 'Mark Season Watched'}
          </button>
        </div>
      )}

      {data.episodes.length === 0 ? (
        <p>{intl.formatMessage(messages.noepisodes)}</p>
      ) : (
        data.episodes
          .slice()
          .reverse()
          .map((episode) => {
            const epKey = `s${seasonNumber}e${episode.episodeNumber}`;
            const epWatch = watchStatus?.episodes?.[epKey];

            return (
              <div
                className="flex flex-col space-y-4 py-4 xl:flex-row xl:space-x-4 xl:space-y-4"
                key={`season-${seasonNumber}-episode-${episode.episodeNumber}`}
              >
                <div className="flex-1">
                  <div className="flex flex-col space-y-2 xl:flex-row xl:items-center xl:space-x-2 xl:space-y-0">
                    <h3 className="text-lg">
                      {episode.episodeNumber} - {episode.name}
                    </h3>
                    {watchStatus?.hasMedia && (
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const newPlayed = !epWatch?.played;
                          await markWatchStatus({
                            played: newPlayed,
                            seasonNumber,
                            episodeNumber: episode.episodeNumber,
                          });
                          toasts.addToast(
                            newPlayed
                              ? `Marked E${episode.episodeNumber} as watched in Jellyfin`
                              : `Marked E${episode.episodeNumber} as unwatched in Jellyfin`,
                            { appearance: 'info', autoDismiss: true }
                          );
                        }}
                        title={epWatch?.played ? 'Click to mark as unwatched' : 'Click to mark as watched'}
                        className={`group/btn inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition cursor-pointer ${
                          epWatch?.played
                            ? 'bg-green-900/60 text-green-300 ring-1 ring-inset ring-green-500/40 hover:bg-red-900/40 hover:text-red-300 hover:ring-red-500/40'
                            : 'bg-gray-800/80 text-gray-400 ring-1 ring-inset ring-gray-700 hover:bg-green-900/40 hover:text-green-300 hover:ring-green-500/40'
                        }`}
                      >
                        <svg
                          className={`h-3.5 w-3.5 ${
                            epWatch?.played
                              ? 'text-green-400 group-hover/btn:text-red-400'
                              : 'text-gray-500 group-hover/btn:text-green-400'
                          }`}
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span>
                          {epWatch?.played
                            ? `Watched ${epWatch.playCount > 1 ? `(${epWatch.playCount}x)` : ''}`
                            : 'Mark Watched'}
                        </span>
                      </button>
                    )}
                    {!epWatch?.played && (epWatch?.playbackPositionPercentage ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-900/60 px-2.5 py-0.5 text-xs font-medium text-blue-300 ring-1 ring-inset ring-blue-500/40">
                        In Progress ({epWatch?.playbackPositionPercentage}%)
                      </span>
                    )}
                    {episode.airDate && (
                      <AirDateBadge airDate={episode.airDate} />
                    )}
                  </div>
                  {episode.overview && <p>{episode.overview}</p>}
                </div>
                {episode.stillPath && (
                  <div className="relative aspect-video xl:h-32">
                    <CachedImage
                      type="tmdb"
                      className="rounded-lg object-contain"
                      src={episode.stillPath}
                      alt=""
                      fill
                    />
                    {watchStatus?.hasMedia && (
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const newPlayed = !epWatch?.played;
                          await markWatchStatus({
                            played: newPlayed,
                            seasonNumber,
                            episodeNumber: episode.episodeNumber,
                          });
                          toasts.addToast(
                            newPlayed
                              ? `Marked E${episode.episodeNumber} as watched in Jellyfin`
                              : `Marked E${episode.episodeNumber} as unwatched in Jellyfin`,
                            { appearance: 'info', autoDismiss: true }
                          );
                        }}
                        title={epWatch?.played ? 'Click to mark as unwatched' : 'Click to mark as watched'}
                        className={`absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full shadow backdrop-blur-sm ring-1 transition cursor-pointer ${
                          epWatch?.played
                            ? 'bg-black/70 text-green-400 ring-green-500/50 hover:bg-red-950/80 hover:text-red-400 hover:ring-red-500/50'
                            : 'bg-black/40 text-gray-400 opacity-60 hover:opacity-100 hover:bg-black/80 hover:text-green-400 ring-gray-600 hover:ring-green-500/50'
                        }`}
                      >
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
      )}
    </div>
  );
};

export default Season;


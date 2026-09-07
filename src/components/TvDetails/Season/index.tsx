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
  const { watchStatus, markWatchStatus, deleteWatchedMedia, isUpdating } = useWatchStatus('tv', tvId);

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
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 pt-1">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-400">
            {seasonWatchedCount} / {seasonEpisodes.length} Episodes Watched
          </span>
          <div className="flex items-center gap-2">
            {seasonWatchedCount > 0 && (
              <button
                type="button"
                disabled={isUpdating}
                onClick={async () => {
                  if (
                    window.confirm(
                      `Delete all ${seasonWatchedCount} watched episode files in Season ${seasonNumber}? Remaining/upcoming episodes will remain monitored and continue to auto-download.`
                    )
                  ) {
                    const res = await deleteWatchedMedia({ seasonNumber });
                    if (res) {
                      const mb = (res.freedBytes / (1024 * 1024)).toFixed(1);
                      toasts.addToast(
                        `Deleted watched files in Season ${seasonNumber} (${mb} MB freed). ${res.remainingMonitoredCount} remaining episodes stay monitored for download.`,
                        { appearance: 'success', autoDismiss: true }
                      );
                    }
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-red-900/40 px-2.5 py-1 text-xs font-medium text-red-300 ring-1 ring-inset ring-red-700/60 hover:bg-red-800/60 hover:text-white transition cursor-pointer"
                title="Delete watched files and free disk space. Remaining episodes will continue to auto-download."
              >
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                  />
                </svg>
                Clean Watched ({seasonWatchedCount})
              </button>
            )}

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
                    {watchStatus?.hasMedia && epWatch?.played && (
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (
                            window.confirm(
                              `Delete file for Episode ${episode.episodeNumber}? Remaining episodes will continue to auto-download.`
                            )
                          ) {
                            const res = await deleteWatchedMedia({
                              seasonNumber,
                              episodeNumber: episode.episodeNumber,
                            });
                            if (res) {
                              const mb = (res.freedBytes / (1024 * 1024)).toFixed(1);
                              toasts.addToast(
                                `Deleted Episode ${episode.episodeNumber} file (${mb} MB freed). ${res.remainingMonitoredCount} remaining episodes stay monitored.`,
                                { appearance: 'success', autoDismiss: true }
                              );
                            }
                          }
                        }}
                        title="Delete episode file from disk. Remaining episodes continue to auto-download."
                        className="inline-flex items-center gap-1 rounded-full bg-red-950/40 px-2 py-0.5 text-xs font-medium text-red-400 ring-1 ring-inset ring-red-800/50 hover:bg-red-900/60 hover:text-white transition cursor-pointer"
                      >
                        <svg
                          className="h-3.5 w-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                          />
                        </svg>
                        Delete File
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


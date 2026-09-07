import useSWR from 'swr';

export interface EpisodeWatchData {
  seasonNumber: number;
  episodeNumber: number;
  played: boolean;
  playCount: number;
  playbackPositionPercentage?: number;
}

export interface MediaWatchStatus {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  hasMedia: boolean;
  played: boolean;
  playCount: number;
  playbackPositionPercentage?: number;
  watchedEpisodesCount?: number;
  totalEpisodesCount?: number;
  episodes?: Record<string, EpisodeWatchData>;
}

export const useWatchStatus = (
  mediaType?: 'movie' | 'tv',
  tmdbId?: number,
  is4k = false
) => {
  const { data, error, mutate } = useSWR<MediaWatchStatus>(
    mediaType && tmdbId
      ? `/api/v1/media/${mediaType}/${tmdbId}/watch-status?is4k=${is4k}`
      : null,
    {
      revalidateOnFocus: true,
    }
  );

  return {
    watchStatus: data,
    isLoading: !data && !error,
    error,
    mutate,
  };
};

export default useWatchStatus;

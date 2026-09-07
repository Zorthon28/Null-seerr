import axios from 'axios';
import { useCallback, useState } from 'react';
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
  const [isUpdating, setIsUpdating] = useState(false);

  const { data, error, mutate } = useSWR<MediaWatchStatus>(
    mediaType && tmdbId
      ? `/api/v1/media/${mediaType}/${tmdbId}/watch-status?is4k=${is4k}`
      : null,
    {
      revalidateOnFocus: true,
    }
  );

  const markWatchStatus = useCallback(
    async ({
      played,
      seasonNumber,
      episodeNumber,
    }: {
      played: boolean;
      seasonNumber?: number;
      episodeNumber?: number;
    }) => {
      if (!mediaType || !tmdbId) return;

      setIsUpdating(true);
      try {
        const res = await axios.post<MediaWatchStatus>(
          `/api/v1/media/${mediaType}/${tmdbId}/watch-status`,
          {
            played,
            seasonNumber,
            episodeNumber,
            is4k,
          }
        );

        if (res.data) {
          await mutate(res.data, false);
        } else {
          await mutate();
        }
        return res.data;
      } finally {
        setIsUpdating(false);
      }
    },
    [mediaType, tmdbId, is4k, mutate]
  );

  return {
    watchStatus: data,
    isLoading: !data && !error,
    isUpdating,
    markWatchStatus,
    error,
    mutate,
  };
};

export default useWatchStatus;


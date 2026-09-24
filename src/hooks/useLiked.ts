import { useUser } from '@app/hooks/useUser';
import axios from 'axios';
import { useCallback, useMemo } from 'react';
import useSWR, { useSWRConfig } from 'swr';

export interface LikedIdItem {
  tmdbId: number;
  mediaType: string;
}

export interface LikedIdsResponse {
  results: LikedIdItem[];
}

export const useLiked = () => {
  const { user } = useUser();
  const { mutate } = useSWRConfig();

  const { data, error, mutate: revalidateLikedIds } = useSWR<LikedIdsResponse>(
    user ? '/api/v1/liked/ids' : null,
    {
      revalidateOnFocus: true,
      dedupingInterval: 10000,
    }
  );

  const likedSet = useMemo(() => {
    const set = new Set<string>();
    if (data?.results) {
      for (const item of data.results) {
        set.add(`${item.mediaType}-${item.tmdbId}`);
      }
    }
    return set;
  }, [data]);

  const isLiked = useCallback(
    (tmdbId: number | undefined, mediaType: string | undefined): boolean => {
      if (!tmdbId || !mediaType) return false;
      return likedSet.has(`${mediaType}-${tmdbId}`);
    },
    [likedSet]
  );

  const markLiked = useCallback(
    async (tmdbId: number, mediaType: 'movie' | 'tv', title?: string) => {
      await axios.post('/api/v1/liked', {
        tmdbId,
        mediaType,
        title,
      });

      // Optimistically update
      await revalidateLikedIds(
        (prev) => ({
          results: [...(prev?.results ?? []), { tmdbId, mediaType }],
        }),
        true
      );
      mutate('/api/v1/user/me/liked');
    },
    [revalidateLikedIds, mutate]
  );

  const unmarkLiked = useCallback(
    async (tmdbId: number, mediaType: 'movie' | 'tv') => {
      await axios.delete(`/api/v1/liked/${tmdbId}?mediaType=${mediaType}`);

      await revalidateLikedIds(
        (prev) => ({
          results: (prev?.results ?? []).filter(
            (i) => !(i.tmdbId === tmdbId && i.mediaType === mediaType)
          ),
        }),
        true
      );
      mutate('/api/v1/user/me/liked');
    },
    [revalidateLikedIds, mutate]
  );

  const toggleLiked = useCallback(
    async (tmdbId: number, mediaType: 'movie' | 'tv', title?: string) => {
      if (isLiked(tmdbId, mediaType)) {
        await unmarkLiked(tmdbId, mediaType);
      } else {
        await markLiked(tmdbId, mediaType, title);
      }
    },
    [isLiked, markLiked, unmarkLiked]
  );

  return {
    isLiked,
    markLiked,
    unmarkLiked,
    toggleLiked,
    likedCount: data?.results?.length ?? 0,
    isLoading: !data && !error,
  };
};

export default useLiked;

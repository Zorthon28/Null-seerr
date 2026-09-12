import { useUser } from '@app/hooks/useUser';
import axios from 'axios';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

export interface WatchedIdItem {
  tmdbId: number;
  mediaType: string;
}

export interface WatchedIdsResponse {
  results: WatchedIdItem[];
}

const HIDE_WATCHED_KEY = 'nullseerr_hide_watched';
const HIDE_WATCHED_EVENT = 'nullseerr:hide_watched_change';

export const useWatched = () => {
  const { user } = useUser();
  const { mutate } = useSWRConfig();

  const { data, error, mutate: revalidateWatchedIds } = useSWR<WatchedIdsResponse>(
    user ? '/api/v1/watched/ids' : null,
    {
      revalidateOnFocus: true,
      dedupingInterval: 10000,
    }
  );

  const watchedSet = useMemo(() => {
    const set = new Set<string>();
    if (data?.results) {
      for (const item of data.results) {
        set.add(`${item.mediaType}-${item.tmdbId}`);
      }
    }
    return set;
  }, [data]);

  const isWatched = useCallback(
    (tmdbId: number | undefined, mediaType: string | undefined): boolean => {
      if (!tmdbId || !mediaType) return false;
      return watchedSet.has(`${mediaType}-${tmdbId}`);
    },
    [watchedSet]
  );

  const markWatched = useCallback(
    async (tmdbId: number, mediaType: 'movie' | 'tv', title?: string) => {
      await axios.post('/api/v1/watched', {
        tmdbId,
        mediaType,
        title,
      });

      // Optimistically update
      await revalidateWatchedIds(
        (prev) => ({
          results: [...(prev?.results ?? []), { tmdbId, mediaType }],
        }),
        true
      );
      mutate('/api/v1/user/me/watched');
    },
    [revalidateWatchedIds, mutate]
  );

  const unmarkWatched = useCallback(
    async (tmdbId: number, mediaType: 'movie' | 'tv') => {
      await axios.delete(`/api/v1/watched/${tmdbId}?mediaType=${mediaType}`);

      await revalidateWatchedIds(
        (prev) => ({
          results: (prev?.results ?? []).filter(
            (i) => !(i.tmdbId === tmdbId && i.mediaType === mediaType)
          ),
        }),
        true
      );
      mutate('/api/v1/user/me/watched');
    },
    [revalidateWatchedIds, mutate]
  );

  // Synchronized persistent hideWatched state
  const [hideWatched, setHideWatchedState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(HIDE_WATCHED_KEY) === 'true';
  });

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === HIDE_WATCHED_KEY) {
        setHideWatchedState(e.newValue === 'true');
      }
    };

    const handleCustomChange = (e: Event) => {
      const customEvent = e as CustomEvent<boolean>;
      setHideWatchedState(customEvent.detail);
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(HIDE_WATCHED_EVENT, handleCustomChange);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(HIDE_WATCHED_EVENT, handleCustomChange);
    };
  }, []);

  const toggleHideWatched = useCallback(() => {
    setHideWatchedState((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem(HIDE_WATCHED_KEY, String(next));
        window.dispatchEvent(
          new CustomEvent(HIDE_WATCHED_EVENT, { detail: next })
        );
      }
      return next;
    });
  }, []);

  const setHideWatched = useCallback((value: boolean) => {
    setHideWatchedState(value);
    if (typeof window !== 'undefined') {
      localStorage.setItem(HIDE_WATCHED_KEY, String(value));
      window.dispatchEvent(
        new CustomEvent(HIDE_WATCHED_EVENT, { detail: value })
      );
    }
  }, []);

  return {
    isWatched,
    markWatched,
    unmarkWatched,
    hideWatched,
    toggleHideWatched,
    setHideWatched,
    watchedCount: data?.results?.length ?? 0,
    isLoading: !data && !error,
  };
};

export default useWatched;

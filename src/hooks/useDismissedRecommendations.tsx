import { useToasts } from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import axios from 'axios';
import React, { useCallback, useMemo } from 'react';
import useSWR, { useSWRConfig } from 'swr';

export interface DismissedItem {
  id: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title?: string;
  createdAt: string;
}

export interface DismissedResponse {
  results: DismissedItem[];
}

export const useDismissedRecommendations = () => {
  const { user } = useUser();
  const { mutate } = useSWRConfig();
  const { addToast } = useToasts();

  const { data, mutate: revalidate } = useSWR<DismissedResponse>(
    user ? '/api/v1/recommendations/dismissed' : null,
    {
      revalidateOnFocus: true,
      dedupingInterval: 10000,
    }
  );

  const dismissedSet = useMemo(() => {
    const set = new Set<string>();
    if (data?.results) {
      for (const item of data.results) {
        set.add(`${item.mediaType}-${item.tmdbId}`);
      }
    }
    return set;
  }, [data]);

  const isDismissed = useCallback(
    (tmdbId: number | undefined, mediaType?: string): boolean => {
      if (!tmdbId) return false;
      if (mediaType) {
        return dismissedSet.has(`${mediaType}-${tmdbId}`);
      }
      return (
        dismissedSet.has(`movie-${tmdbId}`) || dismissedSet.has(`tv-${tmdbId}`)
      );
    },
    [dismissedSet]
  );

  const undismiss = useCallback(
    async (tmdbId: number, mediaType?: 'movie' | 'tv') => {
      try {
        await axios.delete(
          `/api/v1/recommendations/dismiss/${tmdbId}${
            mediaType ? `?mediaType=${mediaType}` : ''
          }`
        );

        await revalidate(
          (prev) => ({
            results: (prev?.results ?? []).filter((r) => r.tmdbId !== tmdbId),
          }),
          true
        );

        // Revalidate recommendation feeds
        mutate((key: any) => typeof key === 'string' && key.includes('recommendation'));
      } catch {
        // Ignore error
      }
    },
    [revalidate, mutate]
  );

  const dismiss = useCallback(
    async (tmdbId: number, mediaType: 'movie' | 'tv', title?: string) => {
      try {
        // Optimistic update
        await revalidate(
          (prev) => ({
            results: [
              {
                id: Date.now(),
                tmdbId,
                mediaType,
                title,
                createdAt: new Date().toISOString(),
              },
              ...(prev?.results ?? []),
            ],
          }),
          false
        );

        await axios.post('/api/v1/recommendations/dismiss', {
          tmdbId,
          mediaType,
          title,
        });

        // Trigger background revalidation
        revalidate();
        mutate((key: any) => typeof key === 'string' && key.includes('recommendation'));

        // Show toast with undo button
        addToast(
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">
              Recomendación descartada{title ? `: ${title}` : ''}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                undismiss(tmdbId, mediaType);
              }}
              className="text-xs font-bold text-rose-400 hover:text-rose-300 underline uppercase tracking-wider cursor-pointer"
            >
              Deshacer
            </button>
          </div>,
          { appearance: 'info' }
        );
      } catch {
        revalidate();
      }
    },
    [revalidate, mutate, addToast, undismiss]
  );

  return {
    dismissedList: data?.results ?? [],
    isDismissed,
    dismiss,
    undismiss,
    revalidate,
  };
};

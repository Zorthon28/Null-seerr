import { MediaStatus } from '@server/constants/media';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

export interface PreviewMediaItem {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  summary?: string;
  image?: string;
  backdropPath?: string;
  year?: string;
  releaseDate?: string;
  userScore?: number;
  status?: MediaStatus;
  isWatched?: boolean;
  isAddedToWatchlist?: boolean | number;
  inProgress?: boolean;
  mutateParent?: () => void;
  basedOnTitle?: string;
  recommendationReason?: string;
}

export interface ActivePreviewState {
  item: PreviewMediaItem;
  rect: DOMRect;
  element: HTMLElement;
}

interface NetflixPreviewContextType {
  activePreview: ActivePreviewState | null;
  isPreviewEnabled: boolean;
  togglePreviewEnabled: () => void;
  isMuted: boolean;
  toggleMute: () => void;
  requestPreview: (item: PreviewMediaItem, element: HTMLElement) => void;
  cancelPreview: () => void;
  closePreviewNow: () => void;
  onMouseEnterPreview: () => void;
  onMouseLeavePreview: () => void;
}

const NetflixPreviewContext = createContext<NetflixPreviewContextType | undefined>(
  undefined
);

const PREVIEW_ENABLED_KEY = 'nullseerr_preview_enabled';
const PREVIEW_MUTED_KEY = 'nullseerr_preview_muted';

export const NetflixPreviewProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [activePreview, setActivePreview] = useState<ActivePreviewState | null>(
    null
  );
  const [isPreviewEnabled, setIsPreviewEnabled] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(true);

  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMouseOverPreviewRef = useRef<boolean>(false);

  // Load preferences from localStorage on mount
  useEffect(() => {
    try {
      const storedEnabled = localStorage.getItem(PREVIEW_ENABLED_KEY);
      if (storedEnabled !== null) {
        setIsPreviewEnabled(storedEnabled === 'true');
      }
      const storedMuted = localStorage.getItem(PREVIEW_MUTED_KEY);
      if (storedMuted !== null) {
        setIsMuted(storedMuted === 'true');
      }
    } catch {
      // Ignore localStorage errors (e.g. private browsing)
    }
  }, []);

  const togglePreviewEnabled = useCallback(() => {
    setIsPreviewEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PREVIEW_ENABLED_KEY, String(next));
      } catch {
        // Ignore
      }
      if (!next) {
        setActivePreview(null);
      }
      return next;
    });
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PREVIEW_MUTED_KEY, String(next));
      } catch {
        // Ignore
      }
      return next;
    });
  }, []);

  const closePreviewNow = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    isMouseOverPreviewRef.current = false;
    setActivePreview(null);
  }, []);

  const requestPreview = useCallback(
    (item: PreviewMediaItem, element: HTMLElement) => {
      if (!isPreviewEnabled) {
        return;
      }

      // If user moved off another card, cancel its close timer
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }

      // Netflix logic: if preview is ALREADY open, switch cards much faster (200ms)
      // If no preview is open yet, wait 450ms debounce so rapid mouse moves don't trigger it
      const delay = activePreview ? 200 : 450;

      hoverTimerRef.current = setTimeout(() => {
        if (!element || !document.body.contains(element)) return;
        const rect = element.getBoundingClientRect();
        setActivePreview({ item, rect, element });
      }, delay);
    },
    [isPreviewEnabled, activePreview]
  );

  const cancelPreview = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }

    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }

    // Give 250ms buffer so user can hover over the preview card itself
    closeTimerRef.current = setTimeout(() => {
      if (!isMouseOverPreviewRef.current) {
        setActivePreview(null);
      }
    }, 250);
  }, []);

  const onMouseEnterPreview = useCallback(() => {
    isMouseOverPreviewRef.current = true;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const onMouseLeavePreview = useCallback(() => {
    isMouseOverPreviewRef.current = false;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = setTimeout(() => {
      setActivePreview(null);
    }, 200);
  }, []);

  // Dismiss preview when user scrolls window or changes viewport
  useEffect(() => {
    if (!activePreview) return;

    const handleScroll = () => {
      closePreviewNow();
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [activePreview, closePreviewNow]);

  return (
    <NetflixPreviewContext.Provider
      value={{
        activePreview,
        isPreviewEnabled,
        togglePreviewEnabled,
        isMuted,
        toggleMute,
        requestPreview,
        cancelPreview,
        closePreviewNow,
        onMouseEnterPreview,
        onMouseLeavePreview,
      }}
    >
      {children}
    </NetflixPreviewContext.Provider>
  );
};

export const useNetflixPreview = (): NetflixPreviewContextType => {
  const context = useContext(NetflixPreviewContext);
  if (!context) {
    throw new Error(
      'useNetflixPreview must be used within a NetflixPreviewProvider'
    );
  }
  return context;
};

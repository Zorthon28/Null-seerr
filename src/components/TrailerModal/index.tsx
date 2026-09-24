import { useLockBodyScroll } from '@app/hooks/useLockBodyScroll';
import { Transition } from '@headlessui/react';
import {
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface TrailerVideo {
  key: string;
  name: string;
  size?: number;
  type: string;
  site: string;
  url?: string;
}

export const sortTrailerPriority = (videos: TrailerVideo[] = []): TrailerVideo[] => {
  return [...videos]
    .filter((r) => r.site === 'YouTube')
    .sort((a, b) => {
      // 1. Trailers and Teasers over clips/behind the scenes
      const aTypeScore = a.type === 'Trailer' ? 2 : a.type === 'Teaser' ? 1 : 0;
      const bTypeScore = b.type === 'Trailer' ? 2 : b.type === 'Teaser' ? 1 : 0;
      if (aTypeScore !== bTypeScore) return aTypeScore - bTypeScore;

      // 2. Deprioritize home video / blu-ray / dvd promo commercials (frequently geo-blocked)
      const aIsPromo = /blu-ray|dvd|home video|box set/i.test(a.name);
      const bIsPromo = /blu-ray|dvd|home video|box set/i.test(b.name);
      if (aIsPromo && !bIsPromo) return -1;
      if (!aIsPromo && bIsPromo) return 1;

      // 3. Higher resolution size
      return (a.size || 0) - (b.size || 0);
    });
};

interface TrailerModalProps {
  title: string;
  videos?: TrailerVideo[];
  show: boolean;
  onClose: () => void;
  initialKey?: string;
}

const TrailerModal: React.FC<TrailerModalProps> = ({
  title,
  videos = [],
  show,
  onClose,
  initialKey,
}) => {
  useLockBodyScroll(show);

  const youtubeVideos = useMemo(
    () => sortTrailerPriority(videos).reverse(), // highest priority first
    [videos]
  );

  const defaultTrailer = youtubeVideos[0];

  const [selectedKey, setSelectedKey] = useState<string>(
    initialKey || defaultTrailer?.key || ''
  );
  const [modalError, setModalError] = useState<boolean>(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const failedKeysRef = useRef<Set<string>>(new Set());
  const hasSearchedRef = useRef<boolean>(false);
  const hasConfirmedPlaybackRef = useRef<boolean>(false);
  const fallbackCooldownRef = useRef<number>(0);

  // Reset or initialize state when modal opens or closes
  useEffect(() => {
    if (!show) {
      setModalError(false);
      setStreamUrl(null);
      failedKeysRef.current.clear();
      hasSearchedRef.current = false;
      hasConfirmedPlaybackRef.current = false;
      return;
    }

    const keyToUse = initialKey || defaultTrailer?.key || '';
    setSelectedKey(keyToUse);
    setModalError(false);
    setStreamUrl(null);
    hasConfirmedPlaybackRef.current = false;
  }, [show, initialKey, defaultTrailer?.key]);

  const fetchModalStreamFallback = useCallback((key: string) => {
    fetch(`/api/v1/trailer/stream?key=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((data: { url: string }) => {
        setStreamUrl(data.url);
        setModalError(false);
      })
      .catch(() => {
        setStreamUrl(null);
        setModalError(true);
      });
  }, []);

  // Automatic fallback cascade: Next TMDb candidate -> YouTube Search -> Direct Stream -> Error Screen
  const triggerModalFallback = useCallback(
    (failedKey: string) => {
      if (!failedKey) return;
      // Prevent rapid cycling loops
      if (Date.now() - fallbackCooldownRef.current < 1200) return;
      fallbackCooldownRef.current = Date.now();

      failedKeysRef.current.add(failedKey);
      hasConfirmedPlaybackRef.current = false;

      // 1. Try next available candidate in youtubeVideos
      const nextCandidate = youtubeVideos.find(
        (v) => !failedKeysRef.current.has(v.key)
      );

      if (nextCandidate?.key) {
        setSelectedKey(nextCandidate.key);
        setStreamUrl(null);
        setModalError(false);
        return;
      }

      // 2. If no other TMDb videos, search YouTube for official trailer
      if (!hasSearchedRef.current && title) {
        hasSearchedRef.current = true;
        fetch(`/api/v1/trailer/search?title=${encodeURIComponent(title)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data?.key && !failedKeysRef.current.has(data.key)) {
              setSelectedKey(data.key);
              setStreamUrl(null);
              setModalError(false);
            } else {
              fetchModalStreamFallback(failedKey);
            }
          })
          .catch(() => {
            fetchModalStreamFallback(failedKey);
          });
        return;
      }

      // 3. Fallback to server yt-dlp stream
      fetchModalStreamFallback(failedKey);
    },
    [youtubeVideos, title, fetchModalStreamFallback]
  );

  // Close on ESC key
  useEffect(() => {
    if (!show) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [show, onClose]);

  // Listen to YouTube embed events for playback confirmation & errors / restrictions
  useEffect(() => {
    if (!show) return;

    const handleMessage = (event: MessageEvent) => {
      if (!event.origin || !event.origin.includes('youtube')) return;

      try {
        const data =
          typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (!data) return;

        // Playback confirmed
        if (
          (data.event === 'onStateChange' && (data.info === 1 || data.data === 1)) ||
          (data.event === 'infoDelivery' &&
            (data.info?.playerState === 1 || data.info?.playerState === 3))
        ) {
          hasConfirmedPlaybackRef.current = true;
          return;
        }

        const playabilityStatus =
          data.info?.playerResponse?.playabilityStatus?.status;

        const isRestrictedOrError =
          data.event === 'onError' ||
          (data.event === 'infoDelivery' &&
            Boolean(data.info?.errorCode && data.info.errorCode !== 0)) ||
          playabilityStatus === 'UNPLAYABLE' ||
          playabilityStatus === 'LOGIN_REQUIRED' ||
          playabilityStatus === 'ERROR';

        if (isRestrictedOrError) {
          triggerModalFallback(selectedKey);
        }
      } catch {
        // ignore
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [show, selectedKey, triggerModalFallback]);

  // Send listening handshake to YouTube iframe & start watchdog for unplayable videos
  useEffect(() => {
    if (!show || !selectedKey || streamUrl || modalError) return;

    hasConfirmedPlaybackRef.current = false;

    // Send handshake so YouTube delivers events to parent window
    const sendHandshake = () => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'listening' }),
          '*'
        );
      }
    };

    const h1 = setTimeout(sendHandshake, 400);
    const h2 = setTimeout(sendHandshake, 1200);

    // Watchdog: If after 4.5s playback hasn't started, check if key is unavailable/geo-blocked
    const watchdog = setTimeout(() => {
      if (!hasConfirmedPlaybackRef.current && show && !modalError && !streamUrl) {
        fetch(`/api/v1/trailer/stream?key=${encodeURIComponent(selectedKey)}`)
          .then((r) => {
            if (!r.ok) {
              // Video is genuinely unavailable/blocked! Trigger fallback
              triggerModalFallback(selectedKey);
            }
          })
          .catch(() => {
            triggerModalFallback(selectedKey);
          });
      }
    }, 4500);

    return () => {
      clearTimeout(h1);
      clearTimeout(h2);
      clearTimeout(watchdog);
    };
  }, [show, selectedKey, streamUrl, modalError, triggerModalFallback]);

  if (!selectedKey) {
    return null;
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  if (typeof document === 'undefined') {
    return null;
  }

  const youtubeUrl = `https://www.youtube.com/watch?v=${selectedKey}`;

  return createPortal(
    <Transition
      show={show}
      as={Fragment}
      appear
      enter="transition-all duration-300 ease-out"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-all duration-200 ease-in"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 md:p-10">
        {/* Dark blurred backdrop */}
        <div
          className="fixed inset-0 bg-black/85 backdrop-blur-md cursor-pointer transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />

        {/* Floating Video Card */}
        <div className="relative z-10 w-full max-w-5xl aspect-video rounded-2xl overflow-hidden bg-black shadow-[0_25px_70px_-15px_rgba(0,0,0,0.95)] border border-gray-700/80 ring-1 ring-white/10 flex flex-col justify-between">
          {/* Top action controls */}
          <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
            {/* Close X Button */}
            <button
              onClick={onClose}
              type="button"
              className="p-2 rounded-full bg-gray-950/80 hover:bg-gray-900 border border-gray-700/80 text-gray-300 hover:text-white backdrop-blur-md shadow-lg transition active:scale-95 cursor-pointer focus:outline-none"
              aria-label="Cerrar trailer"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          </div>

          {/* Age-restricted / embed error fallback screen */}
          {modalError ? (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gray-950/95 p-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600/20 text-red-500 mb-4 border border-red-500/30 shadow-lg">
                <ExclamationTriangleIcon className="h-8 w-8" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">
                Video no disponible o con restricción
              </h3>
              <p className="max-w-lg text-sm text-gray-300 mb-6">
                Este video no está disponible para reproducir dentro del navegador (bloqueo por país o restricción de edad). Puedes verlo directamente en YouTube o elegir otro de los videos disponibles:
              </p>
              <div className="flex flex-col items-center gap-4">
                <a
                  href={youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-red-500 active:scale-95"
                >
                  <span>Ver en YouTube</span>
                  <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                </a>
              </div>
            </div>
          ) : streamUrl ? (
            <video
              ref={videoRef}
              src={streamUrl}
              autoPlay
              controls
              playsInline
              className="w-full h-full object-contain bg-black"
              onError={() => {
                setStreamUrl(null);
                triggerModalFallback(selectedKey);
              }}
            />
          ) : (
            /* Clean 16:9 YouTube Embed */
            <iframe
              ref={iframeRef}
              src={`https://www.youtube.com/embed/${selectedKey}?autoplay=1&controls=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1${
                origin ? `&origin=${encodeURIComponent(origin)}` : ''
              }`}
              className="w-full h-full object-cover"
              title={title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          )}

          {/* Always-visible video selector pills at the bottom */}
          {youtubeVideos.length > 1 && (
            <div className="absolute bottom-3 inset-x-3 z-30 flex items-center justify-center gap-1.5 overflow-x-auto py-1.5 px-3 rounded-xl bg-gray-950/80 backdrop-blur-md border border-gray-800/80 shadow-lg scrollbar-none">
              <span className="text-[11px] font-medium text-gray-400 mr-1 flex-shrink-0 hidden sm:inline">
                Videos ({youtubeVideos.length}):
              </span>
              {youtubeVideos.map((v) => {
                const isSelected = v.key === selectedKey;
                const isFailed = failedKeysRef.current.has(v.key);
                return (
                  <button
                    key={v.key}
                    type="button"
                    onClick={() => {
                      if (v.key === selectedKey) return;
                      setSelectedKey(v.key);
                      setStreamUrl(null);
                      setModalError(false);
                      hasConfirmedPlaybackRef.current = false;
                    }}
                    title={v.name}
                    className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition flex-shrink-0 truncate max-w-[180px] sm:max-w-[220px] ${
                      isSelected
                        ? 'border-rose-500 bg-rose-600/30 text-rose-200 shadow-sm'
                        : isFailed
                        ? 'border-gray-800 bg-gray-900/60 text-gray-500 line-through opacity-60 hover:opacity-80'
                        : 'border-gray-700/80 bg-gray-800/80 text-gray-300 hover:bg-gray-700 hover:text-white'
                    }`}
                  >
                    {v.name || v.type}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Transition>,
    document.body
  );
};

export default TrailerModal;

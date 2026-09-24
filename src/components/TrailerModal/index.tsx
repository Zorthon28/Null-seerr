import { useLockBodyScroll } from '@app/hooks/useLockBodyScroll';
import { Transition } from '@headlessui/react';
import {
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface TrailerVideo {
  key: string;
  name: string;
  size?: number;
  type: string;
  site: string;
  url?: string;
}

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

  const youtubeVideos = videos.filter((v) => v.site === 'YouTube');

  // Match MovieDetails/TvDetails selection: highest resolution Trailer or Teaser
  const defaultTrailer =
    youtubeVideos
      .filter((r) => r.type === 'Trailer' || r.type === 'Teaser')
      .sort((a, b) => (a.size || 0) - (b.size || 0))
      .pop() ?? youtubeVideos[0];

  const [selectedKey, setSelectedKey] = useState<string>(
    initialKey || defaultTrailer?.key || ''
  );
  const [modalError, setModalError] = useState<boolean>(false);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Reset or initialize state when modal opens or closes
  useEffect(() => {
    if (!show) {
      setModalError(false);
      setStreamUrl(null);
      return;
    }

    const keyToUse = initialKey || defaultTrailer?.key || '';
    setSelectedKey(keyToUse);
    setModalError(false);
    setStreamUrl(null);
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

  // Fallback to proxy stream when a video fails (private, deleted, age-restricted, geo-blocked)
  // NEVER automatically change to a different video without user interaction!
  const handlePlaybackFailure = useCallback(
    (failedKey: string) => {
      fetchModalStreamFallback(failedKey);
    },
    [fetchModalStreamFallback]
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

  // Listen to YouTube embed events for errors / restrictions
  useEffect(() => {
    if (!show) return;

    const handleMessage = (event: MessageEvent) => {
      if (!event.origin || !event.origin.includes('youtube')) return;

      try {
        const data =
          typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (!data) return;

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
          handlePlaybackFailure(selectedKey);
        }
      } catch {
        // ignore
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [show, selectedKey, handlePlaybackFailure]);

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
        <div className="relative z-10 w-full max-w-5xl aspect-video rounded-2xl overflow-hidden bg-black shadow-[0_25px_70px_-15px_rgba(0,0,0,0.95)] border border-gray-700/80 ring-1 ring-white/10">
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
                Trailer con restricción de edad
              </h3>
              <p className="max-w-lg text-sm text-gray-300 mb-6">
                YouTube no permite reproducir este video dentro de reproductores externos debido a que contiene contenido para mayores de edad. Puedes verlo directamente en YouTube con tu cuenta:
              </p>
              <div className="flex flex-col items-center gap-4">
                <a
                  href={youtubeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-red-500 active:scale-95"
                >
                  <span>Ver Trailer en YouTube</span>
                  <ArrowTopRightOnSquareIcon className="w-4 h-4" />
                </a>

                {youtubeVideos.length > 1 && (
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                    <span className="text-xs text-gray-400 block w-full mb-1">
                      Otros videos disponibles:
                    </span>
                    {youtubeVideos.map((v) => (
                      <button
                        key={v.key}
                        onClick={() => {
                          setSelectedKey(v.key);
                          setModalError(false);
                        }}
                        className={`px-3 py-1 text-xs font-medium rounded-full border transition ${
                          v.key === selectedKey
                            ? 'border-indigo-500 bg-indigo-600/30 text-indigo-300'
                            : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
                        }`}
                      >
                        {v.name || v.type}
                      </button>
                    ))}
                  </div>
                )}
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
                setModalError(true);
              }}
            />
          ) : (
            /* Clean 16:9 YouTube Embed */
            <iframe
              src={`https://www.youtube.com/embed/${selectedKey}?autoplay=1&controls=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1${
                origin ? `&origin=${encodeURIComponent(origin)}` : ''
              }`}
              className="w-full h-full object-cover"
              title={title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          )}
        </div>
      </div>
    </Transition>,
    document.body
  );
};

export default TrailerModal;

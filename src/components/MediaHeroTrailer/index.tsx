import CachedImage from '@app/components/Common/CachedImage';
import Tooltip from '@app/components/Common/Tooltip';
import type { TrailerVideo } from '@app/components/TrailerModal';
import {
  ArrowTopRightOnSquareIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  PauseIcon,
  PlayIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
} from '@heroicons/react/24/solid';
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface MediaHeroTrailerProps {
  backdropPath?: string;
  title: string;
  trailerKey?: string;
  videos?: TrailerVideo[];
  isEnlarged?: boolean;
  onEnlargeChange?: (enlarged: boolean) => void;
  onOpenModal?: (key?: string) => void;
  isModalOpen?: boolean;
}

const MediaHeroTrailer: React.FC<MediaHeroTrailerProps> = ({
  backdropPath,
  title,
  trailerKey,
  videos = [],
  isEnlarged = false,
  onEnlargeChange,
  onOpenModal,
  isModalOpen = false,
}) => {
  const [activeKey, setActiveKey] = useState<string>(trailerKey ?? '');
  const [hasError, setHasError] = useState<boolean>(false);
  const failedKeysRef = useRef<Set<string>>(new Set());

  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [origin, setOrigin] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.origin : ''
  );
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (trailerKey) {
      setActiveKey(trailerKey);
      setHasError(false);
      failedKeysRef.current.clear();
    }
  }, [trailerKey]);

  useEffect(() => {
    if (typeof window !== 'undefined' && !origin) {
      setOrigin(window.location.origin);
    }
  }, [origin]);

  const backdropUrl = backdropPath
    ? `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${backdropPath}`
    : null;

  const sendIframeCommand = useCallback((func: string, args: any = '') => {
    if (iframeRef.current?.contentWindow) {
      const payload = JSON.stringify({
        event: 'command',
        func,
        args: args !== undefined ? args : '',
      });
      iframeRef.current.contentWindow.postMessage(payload, '*');
    }
  }, []);

  const lastEnlargeTime = useRef(0);

  const handleEnlarge = useCallback(() => {
    lastEnlargeTime.current = Date.now();
    if (onEnlargeChange) {
      onEnlargeChange(true);
    }
    setIsMuted(false);
    setIsPlaying(true);
    sendIframeCommand('unMute');
    sendIframeCommand('setVolume', [100]);
    sendIframeCommand('playVideo');
    // Ensure video never pauses due to browser audio/autoplay policies
    setTimeout(() => {
      sendIframeCommand('playVideo');
    }, 150);
    setTimeout(() => {
      sendIframeCommand('playVideo');
    }, 350);
  }, [onEnlargeChange, sendIframeCommand]);

  const handleCollapse = useCallback(() => {
    if (onEnlargeChange) {
      onEnlargeChange(false);
    }
    setIsMuted(true);
    sendIframeCommand('mute');
    // Keep playing in background (muted), never pause!
    sendIframeCommand('playVideo');
  }, [onEnlargeChange, sendIframeCommand]);

  const handleToggleEnlarge = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (isEnlarged) {
      handleCollapse();
    } else {
      handleEnlarge();
    }
  };

  const handleToggleMute = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const nextMuted = !isMuted;
    setIsMuted(nextMuted);

    if (nextMuted) {
      sendIframeCommand('mute');
    } else {
      sendIframeCommand('unMute');
      sendIframeCommand('setVolume', [100]);
      sendIframeCommand('playVideo');
    }
  };

  const handleTogglePlay = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const nextPlaying = !isPlaying;
    setIsPlaying(nextPlaying);

    if (nextPlaying) {
      sendIframeCommand('playVideo');
    } else {
      sendIframeCommand('pauseVideo');
    }
  };

  const handleOpenFullscreen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (onOpenModal) {
      onOpenModal(activeKey);
    }
  };

  // Pause background playback when modal is active
  useEffect(() => {
    if (isModalOpen) {
      sendIframeCommand('pauseVideo');
    } else if (isPlaying) {
      sendIframeCommand('playVideo');
    }
  }, [isModalOpen, isPlaying, sendIframeCommand]);

  // Scroll and touch detection: enlarge & unmute when scrolling up to the hero
  const isEnlargedRef = useRef(isEnlarged);
  isEnlargedRef.current = isEnlarged;
  const lastScrollY = useRef(0);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    if (!trailerKey) return;

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollDiff = currentScrollY - lastScrollY.current;

      // If user scrolls back UP into the hero section
      if (scrollDiff < -8 && currentScrollY < 120) {
        if (!isEnlargedRef.current) {
          handleEnlarge();
        }
      }

      // If enlarged and user scrolls DOWN to continue reading details (with cooldown)
      if (
        isEnlargedRef.current &&
        scrollDiff > 15 &&
        currentScrollY > 200 &&
        Date.now() - lastEnlargeTime.current > 1200
      ) {
        handleCollapse();
      }

      lastScrollY.current = currentScrollY;
    };

    // Wheeling UP when already sitting at the top of the page
    const handleWheel = (e: WheelEvent) => {
      if (window.scrollY <= 20 && e.deltaY < -15) {
        if (!isEnlargedRef.current) {
          handleEnlarge();
        }
      } else if (
        isEnlargedRef.current &&
        e.deltaY > 35 &&
        window.scrollY > 160 &&
        Date.now() - lastEnlargeTime.current > 1200
      ) {
        handleCollapse();
      }
    };

    // Touch gesture support for tablets and mobile touch screens
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        touchStartY.current = e.touches[0].clientY;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (touchStartY.current === null || e.touches.length === 0) return;
      const currentTouchY = e.touches[0].clientY;
      const diffY = currentTouchY - touchStartY.current;

      // Swiping DOWN near the top of the page (pulling down = scrolling up)
      if (window.scrollY <= 25 && diffY > 40) {
        if (!isEnlargedRef.current) {
          handleEnlarge();
          touchStartY.current = null;
        }
      } else if (
        isEnlargedRef.current &&
        diffY < -50 &&
        Date.now() - lastEnlargeTime.current > 1200
      ) {
        // Swiping UP while enlarged = scroll down into details
        handleCollapse();
        touchStartY.current = null;
      }
    };

    const handleTouchEnd = () => {
      touchStartY.current = null;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [trailerKey, handleEnlarge, handleCollapse]);

  const triggerFallback = useCallback(() => {
    if (!activeKey) return;
    failedKeysRef.current.add(activeKey);

    const nextCandidate = videos.find(
      (v) => v.site === 'YouTube' && !failedKeysRef.current.has(v.key)
    );

    if (nextCandidate?.key) {
      setActiveKey(nextCandidate.key);
    } else {
      setHasError(true);
      setIsPlaying(false);
    }
  }, [activeKey, videos]);

  // Listen for YouTube IFrame API messages (playback confirmation, genuine errors, restriction)
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.origin || !event.origin.includes('youtube')) return;

      try {
        const data =
          typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (!data) return;

        let rawStr = '';
        try {
          rawStr =
            typeof event.data === 'string'
              ? event.data
              : JSON.stringify(event.data);
        } catch {
          // ignore
        }

        // Genuine YouTube restriction / error indicators (avoid false positives on bundle JS / null error codes)
        const isRestrictedOrError =
          data.event === 'onError' ||
          rawStr.includes('Viewer discretion is advised') ||
          rawStr.includes('"LOGIN_REQUIRED"') ||
          rawStr.includes('"UNPLAYABLE"') ||
          (data.event === 'infoDelivery' &&
            Boolean(data.info?.errorCode && data.info.errorCode !== 0));

        if (isRestrictedOrError) {
          triggerFallback();
          return;
        }
      } catch {
        // ignore
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [activeKey, triggerFallback]);

  const iframeSrc =
    activeKey && !hasError
      ? `https://www.youtube.com/embed/${activeKey}?autoplay=1&mute=1&controls=0&modestbranding=1&loop=1&playlist=${activeKey}&playsinline=1&rel=0&iv_load_policy=3&start=7&enablejsapi=1${
          origin ? `&origin=${encodeURIComponent(origin)}` : ''
        }`
      : '';

  return (
    <>
      {/* Background Visual Layer */}
      <div className="absolute inset-0 h-full w-full overflow-hidden pointer-events-none -z-10">
        {/* Fallback Static / Ken-Burns Backdrop Image */}
        {backdropUrl && (
          <CachedImage
            type="tmdb"
            alt={title}
            src={backdropUrl}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            fill
            priority
            className={`transition-opacity duration-700 ${
              isPlaying && activeKey && !hasError
                ? 'opacity-0'
                : 'opacity-100 animate-kenburns'
            }`}
          />
        )}

        {/* Ambient Background Video Iframe */}
        {activeKey && (
          <div
            className={`absolute inset-0 z-0 overflow-hidden pointer-events-none transition-opacity duration-700 ${
              isPlaying && !hasError ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <iframe
              ref={iframeRef}
              src={iframeSrc}
              className={`w-full h-full object-cover pointer-events-none transition-transform duration-700 ${
                isEnlarged ? 'scale-[1.42]' : 'scale-[1.38]'
              }`}
              title={title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            />
          </div>
        )}

        {/* Dark Gradient Overlay for text readability */}
        <div
          className="absolute inset-0 pointer-events-none z-10 transition-all duration-500"
          style={{
            backgroundImage: isEnlarged
              ? 'linear-gradient(180deg, rgba(17, 24, 39, 0.08) 0%, rgba(17, 24, 39, 0.3) 50%, rgba(17, 24, 39, 0.96) 100%)'
              : 'linear-gradient(180deg, rgba(17, 24, 39, 0.4) 0%, rgba(17, 24, 39, 0.82) 65%, rgba(17, 24, 39, 1) 100%)',
          }}
        />
      </div>

      {/* Prominent Floating Controls (Displayed when user scrolls up to enlarge / focus on video) */}
      {activeKey && (
        <div
          className={`absolute top-20 right-4 sm:top-24 sm:right-6 md:right-8 z-40 flex items-center gap-1.5 sm:gap-2 bg-gray-950/85 backdrop-blur-md px-3 sm:px-4 py-2 rounded-full border border-gray-700/80 shadow-[0_10px_25px_-5px_rgba(0,0,0,0.8)] ring-1 ring-white/10 transition-all duration-500 ${
            isEnlarged
              ? 'opacity-100 translate-y-0 pointer-events-auto'
              : 'opacity-0 -translate-y-4 pointer-events-none'
          }`}
        >
          {hasError ? (
            /* Age-restricted / Embed blocked fallback controls */
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-300 bg-amber-950/60 border border-amber-500/40 px-2.5 py-1 rounded-full">
                <ExclamationTriangleIcon className="w-3.5 h-3.5 text-amber-400" />
                <span>Restricción de edad</span>
              </div>
              <a
                href={`https://www.youtube.com/watch?v=${activeKey}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-600 hover:bg-red-500 text-white transition active:scale-95 shadow-md cursor-pointer"
                aria-label="Ver trailer en YouTube"
              >
                <span>Ver en YouTube</span>
                <ArrowTopRightOnSquareIcon className="w-3.5 h-3.5" />
              </a>
              {onOpenModal && (
                <button
                  onClick={handleOpenFullscreen}
                  type="button"
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-600/50 transition active:scale-95 cursor-pointer"
                >
                  <span>Ver trailers</span>
                </button>
              )}
            </div>
          ) : (
            /* Normal video playback controls */
            <>
              {/* Mute / Unmute Button with label */}
              <button
                onClick={handleToggleMute}
                type="button"
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition active:scale-95 cursor-pointer ${
                  isMuted
                    ? 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
                    : 'bg-emerald-600/30 text-emerald-400 border border-emerald-500/50 hover:bg-emerald-600/40'
                }`}
                aria-label={isMuted ? 'Activar sonido' : 'Silenciar'}
              >
                {isMuted ? (
                  <SpeakerXMarkIcon className="w-4 h-4 text-gray-400" />
                ) : (
                  <SpeakerWaveIcon className="w-4 h-4 text-emerald-400" />
                )}
                <span className="hidden sm:inline">
                  {isMuted ? 'Activar Sonido' : 'Silenciar'}
                </span>
              </button>

              <div className="h-4 w-px bg-gray-700" />

              {/* Pause / Play Button */}
              <Tooltip content={isPlaying ? 'Pausar video de fondo' : 'Reproducir video de fondo'}>
                <button
                  onClick={handleTogglePlay}
                  type="button"
                  className="p-1.5 rounded-full text-gray-300 hover:text-white hover:bg-gray-800 transition active:scale-95 cursor-pointer"
                  aria-label={isPlaying ? 'Pausar video' : 'Reproducir video'}
                >
                  {isPlaying ? (
                    <PauseIcon className="w-4 h-4" />
                  ) : (
                    <PlayIcon className="w-4 h-4 text-indigo-400" />
                  )}
                </button>
              </Tooltip>

              {/* Enlarge / Reduce size Button */}
              {onEnlargeChange && (
                <>
                  <div className="h-4 w-px bg-gray-700" />
                  <button
                    onClick={handleToggleEnlarge}
                    type="button"
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition active:scale-95 cursor-pointer ${
                      isEnlarged
                        ? 'bg-indigo-600/40 text-indigo-200 border border-indigo-500/60 shadow-[0_0_15px_rgba(99,102,241,0.3)] hover:bg-indigo-600/50'
                        : 'bg-gray-800 text-gray-200 border border-gray-600/60 hover:bg-gray-700 hover:text-white'
                    }`}
                    aria-label={isEnlarged ? 'Reducir tamaño' : 'Hacer más grande y con sonido'}
                  >
                    {isEnlarged ? (
                      <ArrowsPointingInIcon className="w-4 h-4 text-indigo-300" />
                    ) : (
                      <ArrowsPointingOutIcon className="w-4 h-4 text-indigo-400" />
                    )}
                    <span>
                      {isEnlarged ? 'Reducir' : 'Hacer más grande'}
                    </span>
                  </button>
                </>
              )}

              {onOpenModal && (
                <>
                  <div className="h-4 w-px bg-gray-700" />
                  {/* Fullscreen / Open Modal Button */}
                  <button
                    onClick={handleOpenFullscreen}
                    type="button"
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-600/20 text-rose-300 border border-rose-500/40 hover:bg-rose-600/30 hover:text-rose-200 transition active:scale-95 cursor-pointer"
                    aria-label="Ver trailer en pantalla completa"
                  >
                    <ArrowsPointingOutIcon className="w-3.5 h-3.5 text-rose-400" />
                    <span className="hidden sm:inline">Pantalla Completa</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
};

export default MediaHeroTrailer;

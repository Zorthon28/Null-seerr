import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import Tooltip from '@app/components/Common/Tooltip';
import RequestModal from '@app/components/RequestModal';
import { useNetflixPreview } from '@app/context/NetflixPreviewContext';
import useToasts from '@app/hooks/useToasts';
import { useUser, Permission, UserType } from '@app/hooks/useUser';
import useWatched from '@app/hooks/useWatched';
import globalMessages from '@app/i18n/globalMessages';
import { MediaStatus } from '@server/constants/media';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';
import {
  ArrowDownTrayIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  MinusCircleIcon,
  PlayIcon,
  SpeakerWaveIcon,
  SpeakerXMarkIcon,
  StarIcon,
  SparklesIcon,
} from '@heroicons/react/24/solid';
import {
  CheckCircleIcon as CheckCircleOutlineIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useDismissedRecommendations } from '@app/hooks/useDismissedRecommendations';
import axios from 'axios';
import { useRouter } from 'next/router';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

export const NetflixPreviewCard: React.FC = () => {
  const intl = useIntl();
  const router = useRouter();
  const { user, hasPermission } = useUser();
  const { addToast } = useToasts();
  const {
    activePreview,
    closePreviewNow,
    onMouseEnterPreview,
    onMouseLeavePreview,
    isMuted,
    toggleMute,
  } = useNetflixPreview();

  const [mounted, setMounted] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);

  const handleToggleMute = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const nextMuted = !isMuted;
    toggleMute();

    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({
          event: 'command',
          func: nextMuted ? 'mute' : 'unMute',
          args: [],
        }),
        '*'
      );
      if (!nextMuted) {
        iframeRef.current.contentWindow.postMessage(
          JSON.stringify({
            event: 'command',
            func: 'setVolume',
            args: [100],
          }),
          '*'
        );
      }
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  const item = activePreview?.item;
  const rect = activePreview?.rect;

  const { isWatched: checkIsWatched, markWatched, unmarkWatched } =
    useWatched();
  const isWatched = item
    ? item.isWatched ?? checkIsWatched(item.id, item.mediaType)
    : false;

  // Query details (cached with SWR)
  const apiUrl = item
    ? item.mediaType === 'movie'
      ? `/api/v1/movie/${item.id}`
      : `/api/v1/tv/${item.id}`
    : null;

  const { data: mediaDetails } = useSWR<MovieDetails | TvDetails>(
    apiUrl,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  );

  // Auto-delay video playback by 450ms once card opens
  useEffect(() => {
    setShowVideo(false);
    if (!activePreview) return;

    const timer = setTimeout(() => {
      setShowVideo(true);
    }, 450);

    const iframe = iframeRef.current;
    return () => {
      clearTimeout(timer);
      if (iframe?.contentWindow) {
        try {
          iframe.contentWindow.postMessage(
            JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }),
            '*'
          );
          iframe.contentWindow.postMessage(
            JSON.stringify({ event: 'command', func: 'mute', args: [] }),
            '*'
          );
        } catch {
          // ignore
        }
      }
    };
  }, [activePreview]);

  // Find the primary YouTube trailer or teaser
  const trailer = useMemo(() => {
    if (!mediaDetails?.relatedVideos) return null;
    return (
      mediaDetails.relatedVideos.find(
        (v) => v.site === 'YouTube' && v.type === 'Trailer'
      ) ??
      mediaDetails.relatedVideos.find(
        (v) =>
          v.site === 'YouTube' &&
          (v.type === 'Teaser' || v.type === 'Clip')
      ) ??
      mediaDetails.relatedVideos.find((v) => v.site === 'YouTube')
    );
  }, [mediaDetails]);

  const currentStatus =
    mediaDetails?.mediaInfo?.status ?? item?.status ?? MediaStatus.UNKNOWN;
  const isAvailable =
    currentStatus === MediaStatus.AVAILABLE ||
    currentStatus === MediaStatus.PARTIALLY_AVAILABLE;
  const isDownloading =
    (mediaDetails?.mediaInfo?.downloadStatus ?? []).length > 0;
  const isProcessing = currentStatus === MediaStatus.PROCESSING;
  const isRequested =
    currentStatus === MediaStatus.PENDING ||
    currentStatus === MediaStatus.PROCESSING;

  const showRequestButton = hasPermission(
    [
      Permission.REQUEST,
      item?.mediaType === 'movie'
        ? Permission.REQUEST_MOVIE
        : Permission.REQUEST_TV,
    ],
    { type: 'or' }
  );

  const [inWatchlist, setInWatchlist] = useState<boolean>(
    Boolean(item?.isAddedToWatchlist)
  );

  useEffect(() => {
    if (item) {
      setInWatchlist(Boolean(item.isAddedToWatchlist));
    }
  }, [item]);

  const onClickWatchlist = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!item) return;
    setIsUpdating(true);
    try {
      if (inWatchlist) {
        await axios.delete(`/api/v1/watchlist/${item.id}?mediaType=${item.mediaType}`);
        setInWatchlist(false);
        addToast(
          <span>
            Removed <strong>{item.title}</strong> from watchlist
          </span>,
          { appearance: 'info', autoDismiss: true }
        );
      } else {
        await axios.post('/api/v1/watchlist', {
          tmdbId: item.id,
          mediaType: item.mediaType,
          title: item.title,
        });
        setInWatchlist(true);
        addToast(
          <span>
            Added <strong>{item.title}</strong> to watchlist
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
      mutate('/api/v1/discover/watchlist');
      if (item.mutateParent) item.mutateParent();
    } catch {
      addToast('Error updating watchlist', {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const onClickWatched = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!item) return;
    setIsUpdating(true);
    try {
      if (isWatched) {
        await unmarkWatched(item.id, item.mediaType);
        addToast(
          <span>
            Marked <strong>{item.title}</strong> as unwatched
          </span>,
          { appearance: 'info', autoDismiss: true }
        );
      } else {
        await markWatched(item.id, item.mediaType, item.title);
        addToast(
          <span>
            Marked <strong>{item.title}</strong> as watched!
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
      if (item.mutateParent) item.mutateParent();
    } catch {
      addToast('Error updating watch status', {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDetailsClick = useCallback(() => {
    if (!item) return;
    closePreviewNow();
    const query = item.basedOnTitle
      ? `?basedOn=${encodeURIComponent(item.basedOnTitle)}`
      : '';
    router.push(
      item.mediaType === 'movie'
        ? `/movie/${item.id}${query}`
        : `/tv/${item.id}${query}`
    );
  }, [item, closePreviewNow, router]);

  const { dismiss } = useDismissedRecommendations();

  const handleDismissClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!item) return;
      closePreviewNow();
      dismiss(item.id, item.mediaType, item.title);
    },
    [item, closePreviewNow, dismiss]
  );

  const handlePlayClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!item) return;
      closePreviewNow();
      router.push(`/watch/${item.id}?type=${item.mediaType}`);
    },
    [item, closePreviewNow, router]
  );

  if (!mounted || !activePreview || !item || !rect) {
    return null;
  }

  // Calculate fixed viewport placement with boundary clamping
  const targetWidth = Math.max(340, Math.min(410, rect.width * 1.55));
  const estimatedHeight = 390;
  const padding = 16;

  let left = rect.left + rect.width / 2 - targetWidth / 2;
  if (left < padding) {
    left = padding;
  } else if (left + targetWidth > window.innerWidth - padding) {
    left = window.innerWidth - targetWidth - padding;
  }

  let top = rect.top - 24;
  if (top < 70) {
    top = 70;
  }
  if (top + estimatedHeight > window.innerHeight - padding) {
    top = Math.max(70, window.innerHeight - estimatedHeight - padding);
  }

  const backdrop =
    mediaDetails?.backdropPath || item.backdropPath || item.image;
  const backdropUrl = backdrop
    ? `https://image.tmdb.org/t/p/w780${backdrop}`
    : `/images/seerr_poster_not_found_logo_top.png`;

  const score = mediaDetails?.voteAverage ?? item.userScore ?? 7.5;
  const matchPercent = Math.min(99, Math.max(50, Math.round(score * 10)));
  const year = (
    (mediaDetails as MovieDetails)?.releaseDate ??
    (mediaDetails as TvDetails)?.firstAirDate ??
    item.releaseDate ??
    item.year ??
    ''
  ).slice(0, 4);

  const durationStr =
    item.mediaType === 'movie'
      ? (mediaDetails as MovieDetails)?.runtime
        ? `${Math.floor((mediaDetails as MovieDetails).runtime! / 60)}h ${(mediaDetails as MovieDetails).runtime! % 60}m`
        : null
      : (mediaDetails as TvDetails)?.numberOfSeasons
        ? `${(mediaDetails as TvDetails).numberOfSeasons} Season${(mediaDetails as TvDetails).numberOfSeasons! > 1 ? 's' : ''}`
        : null;

  const genres = (mediaDetails?.genres ?? []).slice(0, 3);

  return createPortal(
    <div
      className="fixed z-[9999] pointer-events-auto transition-all duration-300 ease-out"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        width: `${targetWidth}px`,
      }}
      onMouseEnter={onMouseEnterPreview}
      onMouseLeave={onMouseLeavePreview}
    >
      {showRequestModal && (
        <RequestModal
          tmdbId={item.id}
          show={showRequestModal}
          type={item.mediaType}
          onComplete={() => {
            setShowRequestModal(false);
            if (item.mutateParent) item.mutateParent();
          }}
          onCancel={() => setShowRequestModal(false)}
        />
      )}

      <div className="relative overflow-hidden rounded-2xl bg-gray-900 border border-gray-700/80 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.9)] ring-1 ring-white/10 transform-gpu animate-in fade-in zoom-in-95 duration-200">
        {/* Media Preview Area (16:9) */}
        <div
          role="button"
          tabIndex={0}
          className="relative w-full aspect-video overflow-hidden bg-gray-950 cursor-pointer focus:outline-none"
          onClick={handleDetailsClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleDetailsClick();
            }
          }}
        >
          {/* Backdrop Image with Ken Burns animation */}
          <CachedImage
            type="tmdb"
            src={backdropUrl}
            alt={item.title}
            fill
            className={`w-full h-full object-cover transition-transform duration-700 ${
              showVideo && trailer?.key ? 'opacity-0 scale-105' : 'opacity-100 animate-kenburns'
            }`}
          />

          {/* YouTube Trailer Video Snippet */}
          {showVideo && trailer?.key && (
            <div className="absolute inset-0 z-10 overflow-hidden pointer-events-none transition-opacity duration-500 opacity-100">
              <iframe
                ref={iframeRef}
                src={`https://www.youtube.com/embed/${trailer.key}?autoplay=1&mute=1&controls=0&modestbranding=1&loop=1&playlist=${trailer.key}&playsinline=1&rel=0&iv_load_policy=3&start=7&enablejsapi=1${
                  typeof window !== 'undefined'
                    ? `&origin=${encodeURIComponent(window.location.origin)}`
                    : ''
                }`}
                className="w-full h-full object-cover scale-[1.38] pointer-events-none"
                title={item.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              />
            </div>
          )}

          {/* Sound Mute/Unmute toggle */}
          {showVideo && trailer?.key && (
            <button
              onClick={handleToggleMute}
              aria-label={isMuted ? 'Activar sonido' : 'Silenciar'}
              className="absolute bottom-3 right-3 z-30 p-2 rounded-full bg-gray-950/70 hover:bg-gray-900/90 border border-gray-700/80 text-white backdrop-blur-md transition-transform active:scale-95"
            >
              {isMuted ? (
                <SpeakerXMarkIcon className="w-4 h-4 text-gray-300" />
              ) : (
                <SpeakerWaveIcon className="w-4 h-4 text-emerald-400" />
              )}
            </button>
          )}

          {/* Bottom Gradient Fade */}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-gray-900 via-gray-900/60 to-transparent z-20 pointer-events-none" />

          {/* Title on Media */}
          <div className="absolute bottom-2 left-3 right-12 z-20 pointer-events-none">
            <h3 className="text-lg font-extrabold text-white leading-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] line-clamp-1">
              {item.title}
            </h3>
          </div>
        </div>

        {/* Card Body / Controls & Metadata */}
        <div className="p-4 space-y-3 bg-gray-900">
          {/* Action Buttons Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isAvailable ? (
                <Button
                  buttonType="primary"
                  buttonSize="sm"
                  onClick={handlePlayClick}
                  className="!bg-white !text-gray-950 hover:!bg-gray-200 !border-white font-bold flex items-center gap-1.5 px-3.5 py-1.5 rounded-full shadow-lg"
                >
                  <PlayIcon className="h-4 w-4 fill-current" />
                  <span>Play</span>
                </Button>
              ) : isDownloading || isProcessing ? (
                <div className="flex items-center gap-1.5 bg-indigo-600/90 text-white text-xs font-semibold px-3 py-1.5 rounded-full backdrop-blur-sm">
                  <span className="h-2 w-2 rounded-full bg-indigo-300 animate-ping" />
                  <span>{isDownloading ? 'Downloading...' : 'Processing'}</span>
                </div>
              ) : isRequested ? (
                <div className="flex items-center gap-1 bg-amber-500/90 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow">
                  <span>Requested ✓</span>
                </div>
              ) : showRequestButton ? (
                <Button
                  buttonType="primary"
                  buttonSize="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowRequestModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full"
                >
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  <span>{intl.formatMessage(globalMessages.request)}</span>
                </Button>
              ) : null}

              {/* Watched Toggle */}
              {user && (
                <Tooltip
                  content={isWatched ? 'Mark as Unwatched' : 'Mark as Watched'}
                >
                  <button
                    onClick={onClickWatched}
                    disabled={isUpdating}
                    className={`p-2 rounded-full border transition active:scale-95 ${
                      isWatched
                        ? 'bg-emerald-600/30 border-emerald-500 text-emerald-400 hover:bg-emerald-600/40'
                        : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white'
                    }`}
                  >
                    {isWatched ? (
                      <CheckCircleIcon className="h-4 w-4" />
                    ) : (
                      <CheckCircleOutlineIcon className="h-4 w-4" />
                    )}
                  </button>
                </Tooltip>
              )}

              {/* Watchlist Toggle */}
              {user?.userType !== UserType.PLEX && (
                <Tooltip
                  content={
                    inWatchlist
                      ? 'Remove from Watchlist'
                      : 'Add to Watchlist'
                  }
                >
                  <button
                    onClick={onClickWatchlist}
                    disabled={isUpdating}
                    className={`p-2 rounded-full border transition active:scale-95 ${
                      inWatchlist
                        ? 'bg-amber-500/30 border-amber-500 text-amber-300 hover:bg-amber-500/40'
                        : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700 hover:text-white'
                    }`}
                  >
                    {inWatchlist ? (
                      <MinusCircleIcon className="h-4 w-4" />
                    ) : (
                      <StarIcon className="h-4 w-4 text-amber-400" />
                    )}
                  </button>
                </Tooltip>
              )}

              {/* Dismiss / Not Interested */}
              {user && (
                <Tooltip content="Not interested">
                  <button
                    onClick={handleDismissClick}
                    className="p-2 rounded-full border border-gray-700 bg-gray-800 text-gray-400 hover:text-rose-400 hover:border-rose-500/50 hover:bg-gray-700 transition active:scale-95 shadow"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                </Tooltip>
              )}
            </div>

            {/* Expand / Details Arrow */}
            <Tooltip content="Ver detalles completos">
              <button
                onClick={handleDetailsClick}
                className="p-2 rounded-full border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition active:scale-95 shadow"
              >
                <ChevronDownIcon className="h-4 w-4" />
              </button>
            </Tooltip>
          </div>

          {/* Recommendation Reason Pill */}
          {(item?.basedOnTitle || item?.recommendationReason) && (
            <div className="flex items-center gap-1.5 rounded-md bg-rose-500/20 border border-rose-500/35 px-2.5 py-1 text-xs font-medium text-rose-200">
              <SparklesIcon className="h-3.5 w-3.5 text-rose-400 flex-shrink-0" />
              <span>
                Because you liked{' '}
                <strong className="text-white font-semibold">
                  {item.basedOnTitle || item.recommendationReason}
                </strong>
              </span>
            </div>
          )}

          {/* Metadata Row: Match %, Year, Duration/Seasons, Quality Pill */}
          <div className="flex items-center gap-2 text-xs font-medium">
            <span className="font-bold text-emerald-400">
              {matchPercent}% Match
            </span>
            {year && <span className="text-gray-400">{year}</span>}
            {durationStr && (
              <span className="text-gray-400">{durationStr}</span>
            )}
            <span className="rounded border border-gray-600 px-1 py-0.2 text-[10px] text-gray-300 font-bold">
              HD
            </span>
            {mediaDetails?.status === 'Ended' ? (
              <span className="text-[10px] font-bold text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">
                Ended
              </span>
            ) : mediaDetails?.status === 'Returning Series' ? (
              <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded">
                Returning
              </span>
            ) : null}
          </div>

          {/* Genres Line */}
          {genres.length > 0 && (
            <div className="text-xs text-gray-300 flex items-center gap-1.5 flex-wrap">
              {genres.map((g, idx) => (
                <React.Fragment key={g.id}>
                  <span>{g.name}</span>
                  {idx < genres.length - 1 && (
                    <span className="text-gray-500 text-[10px]">•</span>
                  )}
                </React.Fragment>
              ))}
            </div>
          )}

          {/* Short Overview Clamped */}
          {(mediaDetails?.overview || item.summary) && (
            <p className="text-xs text-gray-400 line-clamp-2 leading-relaxed">
              {mediaDetails?.overview || item.summary}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

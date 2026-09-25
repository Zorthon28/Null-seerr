import Spinner from '@app/assets/spinner.svg';
import BlocklistModal from '@app/components/BlocklistModal';
import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import StatusBadgeMini from '@app/components/Common/StatusBadgeMini';
import Tooltip from '@app/components/Common/Tooltip';
import RequestModal from '@app/components/RequestModal';
import ErrorCard from '@app/components/TitleCard/ErrorCard';
import Placeholder from '@app/components/TitleCard/Placeholder';
import { useIsTouch } from '@app/hooks/useIsTouch';
import useToasts from '@app/hooks/useToasts';
import { Permission, UserType, useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { withProperties } from '@app/utils/typeHelpers';
import { Transition } from '@headlessui/react';
import {
  ArrowDownTrayIcon,
  CalendarIcon,
  EyeIcon,
  EyeSlashIcon,
  MinusCircleIcon,
  StarIcon,
  PlayIcon,
  TicketIcon,
  CheckCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { CheckCircleIcon as CheckCircleSolidIcon, SparklesIcon } from '@heroicons/react/24/solid';
import { useNetflixPreview } from '@app/context/NetflixPreviewContext';
import useWatched from '@app/hooks/useWatched';
import { useDismissedRecommendations } from '@app/hooks/useDismissedRecommendations';
import { MediaStatus } from '@server/constants/media';
import type { Watchlist } from '@server/entity/Watchlist';
import type { RatingResponse } from '@server/api/ratings';
import type { MediaType } from '@server/models/Search';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

interface TitleCardProps {
  id: number;
  image?: string;
  backdropPath?: string;
  summary?: string;
  year?: string;
  releaseDate?: string;
  title: string;
  userScore?: number;
  mediaType: MediaType;
  status?: MediaStatus;
  canExpand?: boolean;
  inProgress?: boolean;
  isAddedToWatchlist?: number | boolean;
  isWatchedItem?: boolean;
  mutateParent?: () => void;
  recommendationReason?: string;
  basedOnTitle?: string;
  ratings?: RatingResponse;
}

const messages = defineMessages('components.TitleCard', {
  addToWatchList: 'Add to watchlist',
  watchlistSuccess:
    '<strong>{title}</strong> added to watchlist  successfully!',
  watchlistDeleted:
    '<strong>{title}</strong> Removed from watchlist  successfully!',
  watchlistCancel: 'watchlist for <strong>{title}</strong> canceled.',
  watchlistError: 'Something went wrong. Please try again.',
  upcoming: 'Upcoming',
  inCinemas: 'In Cinemas',
  becauseYouLiked: 'Because you liked {title}',
  becauseYouLikedShort: 'Because you liked',
  notInterested: 'Not interested',
});

const getReleaseStatus = (
  dateStr?: string,
  type?: MediaType,
  isAvailable?: boolean
): 'upcoming' | 'inCinemas' | null => {
  if (!dateStr || isAvailable) {
    return null;
  }

  const parts = dateStr.split('-');
  const y = parseInt(parts[0], 10);
  if (isNaN(y) || y < 1900) {
    return null;
  }

  const m = parts.length > 1 ? parseInt(parts[1], 10) - 1 : 0;
  const d = parts.length > 2 ? parseInt(parts[2], 10) : 1;

  const releaseDate = new Date(y, m, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffMs = releaseDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays > 0) {
    return 'upcoming';
  }

  if (type === 'movie' && parts.length >= 2 && diffDays >= -75) {
    return 'inCinemas';
  }

  return null;
};

const TitleCard = ({
  id,
  image,
  backdropPath,
  summary,
  year,
  releaseDate,
  title,
  userScore,
  status,
  mediaType,
  isAddedToWatchlist = false,
  isWatchedItem,
  inProgress = false,
  canExpand = false,
  mutateParent,
  recommendationReason,
  basedOnTitle,
  ratings,
}: TitleCardProps) => {
  const isTouch = useIsTouch();
  const intl = useIntl();
  const { user, hasPermission } = useUser();
  const router = useRouter();
  const { requestPreview, cancelPreview, isPreviewEnabled } = useNetflixPreview();
  const { isWatched: checkIsWatched, markWatched, unmarkWatched } = useWatched();
  const isWatched = isWatchedItem ?? checkIsWatched(id, mediaType);
  const isRecommendation = Boolean(basedOnTitle || recommendationReason);
  const { isDismissed, dismiss } = useDismissedRecommendations();
  const isCardDismissed = isRecommendation && isDismissed(id, mediaType);

  const onClickDismissBtn = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      dismiss(id, mediaType as 'movie' | 'tv', title);
    },
    [dismiss, id, mediaType, title]
  );

  const { data: queueData } = useSWR<{ queue: Record<number, any> }>(
    '/api/v1/media/queue',
    { refreshInterval: 15000 }
  );

  const activeQueueItem = queueData?.queue?.[id];
  const [isUpdating, setIsUpdating] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(status);
  const [showDetail, setShowDetail] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const { addToast } = useToasts();
  const [toggleWatchlist, setToggleWatchlist] =
    useState<boolean>(!isAddedToWatchlist);
  const [showBlocklistModal, setShowBlocklistModal] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const onClickWatchedBtn = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    setIsUpdating(true);
    try {
      if (isWatched) {
        await unmarkWatched(id, mediaType as 'movie' | 'tv');
        addToast(
          <span>
            Marked <strong>{title}</strong> as unwatched
          </span>,
          { appearance: 'info', autoDismiss: true }
        );
      } else {
        await markWatched(id, mediaType as 'movie' | 'tv', title);
        addToast(
          <span>
            Marked <strong>{title}</strong> as watched!
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
      if (mutateParent) {
        mutateParent();
      }
    } catch {
      addToast('Something went wrong updating watched status', {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const dateString = releaseDate || year;
  const displayYear = year ? year.slice(0, 4) : undefined;

  useEffect(() => {
    setCurrentStatus(status);
  }, [status]);

  const isDownloading = activeQueueItem?.status === 'downloading';
  const isProcessing = activeQueueItem?.status === 'processing';
  const isRequested = !isDownloading && !isProcessing && (currentStatus === MediaStatus.PROCESSING || currentStatus === MediaStatus.PENDING);
  const isAvailable = currentStatus === MediaStatus.AVAILABLE || currentStatus === MediaStatus.PARTIALLY_AVAILABLE;
  const releaseStatus = getReleaseStatus(dateString, mediaType, isAvailable);
  const downloadProgress = activeQueueItem?.progress ?? 0;
  const downloadTimeLeft = activeQueueItem?.timeLeft ?? '';

  const requestComplete = useCallback((newStatus: MediaStatus) => {
    setCurrentStatus(newStatus);
    setShowRequestModal(false);
  }, []);

  const requestUpdating = useCallback(
    (status: boolean) => setIsUpdating(status),
    []
  );

  const closeBlocklistModal = useCallback(
    () => setShowBlocklistModal(false),
    []
  );

  const onClickWatchlistBtn = async (): Promise<void> => {
    setIsUpdating(true);
    try {
      const response = await axios.post<Watchlist>('/api/v1/watchlist', {
        tmdbId: id,
        mediaType,
        title,
      });
      mutate('/api/v1/discover/watchlist');
      if (response.data) {
        addToast(
          <span>
            {intl.formatMessage(messages.watchlistSuccess, {
              title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
    } catch {
      addToast(intl.formatMessage(messages.watchlistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
      setToggleWatchlist((prevState) => !prevState);
    }
  };

  const onClickDeleteWatchlistBtn = async (): Promise<void> => {
    setIsUpdating(true);
    try {
      const response = await axios.delete<Watchlist>(
        `/api/v1/watchlist/${id}?mediaType=${mediaType}`
      );

      if (response.status === 204) {
        addToast(
          <span>
            {intl.formatMessage(messages.watchlistDeleted, {
              title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'info', autoDismiss: true }
        );
      }
    } catch {
      addToast(intl.formatMessage(messages.watchlistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
      mutate('/api/v1/discover/watchlist');
      if (mutateParent) {
        mutateParent();
      }
      setToggleWatchlist((prevState) => !prevState);
    }
  };

  const onClickHideItemBtn = async (): Promise<void> => {
    setIsUpdating(true);
    const topNode = cardRef.current;

    if (topNode) {
      try {
        if (mediaType === 'collection') {
          await axios.post(`/api/v1/blocklist/collection/${id}`);
        } else {
          await axios.post('/api/v1/blocklist', {
            tmdbId: id,
            mediaType,
            title,
            user: user?.id,
          });
        }
        addToast(
          <span>
            {intl.formatMessage(globalMessages.blocklistSuccess, {
              title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
        setCurrentStatus(MediaStatus.BLOCKLISTED);
        if (mutateParent) {
          mutateParent();
        }
      } catch (e) {
        if (e?.response?.status === 412) {
          addToast(
            <span>
              {intl.formatMessage(globalMessages.blocklistDuplicateError, {
                title,
                strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
              })}
            </span>,
            { appearance: 'info', autoDismiss: true }
          );
        } else {
          addToast(intl.formatMessage(globalMessages.blocklistError), {
            appearance: 'error',
            autoDismiss: true,
          });
        }
      }

      setIsUpdating(false);
      closeBlocklistModal();
    } else {
      addToast(intl.formatMessage(globalMessages.blocklistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    }
  };

  const onClickShowBlocklistBtn = async (): Promise<void> => {
    setIsUpdating(true);
    const topNode = cardRef.current;

    if (topNode) {
      try {
        if (mediaType === 'collection') {
          const res = await axios.delete(`/api/v1/blocklist/collection/${id}`);

          if (res.status === 204) {
            addToast(
              <span>
                {intl.formatMessage(globalMessages.removeFromBlocklistSuccess, {
                  title,
                  strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
                })}
              </span>,
              { appearance: 'success', autoDismiss: true }
            );
            setCurrentStatus(MediaStatus.UNKNOWN);
            if (mutateParent) {
              mutateParent();
            }
          } else {
            addToast(intl.formatMessage(globalMessages.blocklistError), {
              appearance: 'error',
              autoDismiss: true,
            });
          }
        } else {
          const res = await axios.delete(
            `/api/v1/blocklist/${id}?mediaType=${mediaType}`
          );

          if (res.status === 204) {
            addToast(
              <span>
                {intl.formatMessage(globalMessages.removeFromBlocklistSuccess, {
                  title,
                  strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
                })}
              </span>,
              { appearance: 'success', autoDismiss: true }
            );
            setCurrentStatus(MediaStatus.UNKNOWN);
            if (mutateParent) {
              mutateParent();
            }
          } else {
            addToast(intl.formatMessage(globalMessages.blocklistError), {
              appearance: 'error',
              autoDismiss: true,
            });
          }
        }
      } catch {
        addToast(intl.formatMessage(globalMessages.blocklistError), {
          appearance: 'error',
          autoDismiss: true,
        });
      }
    } else {
      addToast(intl.formatMessage(globalMessages.blocklistError), {
        appearance: 'error',
        autoDismiss: true,
      });
    }

    setIsUpdating(false);
  };

  const closeModal = useCallback(() => setShowRequestModal(false), []);

  const showRequestButton = hasPermission(
    [
      Permission.REQUEST,
      mediaType === 'movie' || mediaType === 'collection'
        ? Permission.REQUEST_MOVIE
        : Permission.REQUEST_TV,
    ],
    { type: 'or' }
  );

  const showHideButton = hasPermission([Permission.MANAGE_BLOCKLIST], {
    type: 'or',
  });

  const hasBottomButton =
    isAvailable ||
    isDownloading ||
    isProcessing ||
    isRequested ||
    Boolean(
      showRequestButton &&
        (!currentStatus ||
          currentStatus === MediaStatus.UNKNOWN ||
          currentStatus === MediaStatus.DELETED)
    );

  const statusBadgeElement = (isDownloading ||
    isProcessing ||
    isRequested ||
    (currentStatus && currentStatus !== MediaStatus.UNKNOWN)) && (
    <div className="flex flex-col items-center gap-1">
      <div className="pointer-events-none z-40 flex">
        {isDownloading ? (
          <div className="bg-indigo-600/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow flex items-center gap-1 backdrop-blur-sm">
            <span>{downloadProgress}%</span>
            {downloadTimeLeft && (
              <span className="opacity-80">({downloadTimeLeft})</span>
            )}
          </div>
        ) : isProcessing ? (
          <div className="bg-indigo-500/95 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow flex items-center gap-1 backdrop-blur-sm">
            <span>Processing</span>
          </div>
        ) : isRequested ? (
          <div className="bg-amber-500/90 text-white text-[10px] font-bold px-1.5 py-0.5 rounded shadow flex items-center gap-1 backdrop-blur-sm">
            <span>Requested ✓</span>
          </div>
        ) : (
          <StatusBadgeMini
            status={currentStatus ?? MediaStatus.UNKNOWN}
            inProgress={inProgress}
            shrink
          />
        )}
      </div>
    </div>
  );

  if (isCardDismissed) {
    return null;
  }

  return (
    <div
      className={canExpand ? 'w-full' : 'w-36 sm:w-36 md:w-44'}
      data-testid="title-card"
      ref={cardRef}
    >
      <RequestModal
        tmdbId={id}
        show={showRequestModal}
        type={
          mediaType === 'movie'
            ? 'movie'
            : mediaType === 'collection'
              ? 'collection'
              : 'tv'
        }
        onComplete={requestComplete}
        onUpdating={requestUpdating}
        onCancel={closeModal}
      />
      <BlocklistModal
        tmdbId={id}
        type={
          mediaType === 'movie'
            ? 'movie'
            : mediaType === 'collection'
              ? 'collection'
              : 'tv'
        }
        show={showBlocklistModal}
        onCancel={closeBlocklistModal}
        onComplete={onClickHideItemBtn}
        isUpdating={isUpdating}
      />
      <div
        className={`relative transform-gpu cursor-default overflow-hidden rounded-xl bg-gray-800 bg-cover outline-none ring-1 transition duration-300 ${
          showDetail
            ? 'scale-105 shadow-lg ring-gray-500'
            : 'scale-100 shadow ring-gray-700'
        }`}
        style={{
          paddingBottom: '150%',
        }}
        onMouseEnter={() => {
          if (!isTouch) {
            setShowDetail(true);
            if (isPreviewEnabled && cardRef.current) {
              requestPreview(
                {
                  id,
                  mediaType: mediaType as 'movie' | 'tv',
                  title,
                  summary,
                  image,
                  backdropPath,
                  year: displayYear,
                  releaseDate: dateString,
                  userScore,
                  status: currentStatus,
                  isWatched,
                  isAddedToWatchlist: !toggleWatchlist,
                  inProgress,
                  mutateParent,
                  basedOnTitle,
                  recommendationReason,
                },
                cardRef.current
              );
            }
          }
        }}
        onMouseLeave={() => {
          setShowDetail(false);
          if (isPreviewEnabled) {
            cancelPreview();
          }
        }}
        onClick={() => setShowDetail(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setShowDetail(true);
          }
        }}
        role="link"
        tabIndex={0}
      >
        <div className="absolute inset-0 h-full w-full overflow-hidden">
          <CachedImage
            type="tmdb"
            className="absolute inset-0 h-full w-full"
            alt=""
            src={
              image
                ? `https://image.tmdb.org/t/p/w300_and_h450_face${image}`
                : `/images/seerr_poster_not_found_logo_top.png`
            }
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            fill
          />
          {isDownloading && (
            <div className="absolute bottom-0 left-0 w-full h-1.5 bg-gray-900/60 z-40">
              <div
                className="h-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
          )}
          {basedOnTitle && !showDetail && (
            <div className="absolute bottom-1.5 inset-x-1.5 pointer-events-none z-30">
              <div className="flex flex-col rounded-lg bg-gray-950/95 backdrop-blur-md border border-rose-500/50 px-2 py-1 shadow-xl">
                <div className="text-[9px] uppercase tracking-wider font-bold text-rose-400">
                  <span className="truncate">
                    {intl.formatMessage(messages.becauseYouLikedShort)}
                  </span>
                </div>
                <div
                  className="truncate text-[11px] sm:text-xs font-semibold text-white leading-tight"
                  title={basedOnTitle}
                >
                  {basedOnTitle}
                </div>
              </div>
            </div>
          )}
          <div className="absolute left-0 right-0 top-0 flex items-start justify-between p-2 pointer-events-none z-40">
            <div className="flex flex-col items-start gap-1">
              {releaseStatus === 'inCinemas' ? (
                <div className="pointer-events-none z-40 self-start rounded-full border border-rose-500 bg-rose-600/80 shadow-md backdrop-blur-sm">
                  <div className="flex h-4 items-center gap-1 px-2 py-2 text-center text-xs font-medium uppercase tracking-wider text-white sm:h-5">
                    <TicketIcon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                    <span>{intl.formatMessage(messages.inCinemas)}</span>
                  </div>
                </div>
              ) : releaseStatus === 'upcoming' ? (
                <div className="pointer-events-none z-40 self-start rounded-full border border-amber-500 bg-amber-600/80 shadow-md backdrop-blur-sm">
                  <div className="flex h-4 items-center gap-1 px-2 py-2 text-center text-xs font-medium uppercase tracking-wider text-white sm:h-5">
                    <CalendarIcon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                    <span>{intl.formatMessage(messages.upcoming)}</span>
                  </div>
                </div>
              ) : (
                <div
                  className={`pointer-events-none z-40 self-start rounded-full border shadow-md ${
                    mediaType === 'movie' || mediaType === 'collection'
                      ? 'border-blue-500 bg-blue-600/80'
                      : 'border-purple-600 bg-purple-600/80'
                  }`}
                >
                  <div className="flex h-4 items-center px-2 py-2 text-center text-xs font-medium uppercase tracking-wider text-white sm:h-5">
                    {mediaType === 'movie'
                      ? intl.formatMessage(globalMessages.movie)
                      : mediaType === 'collection'
                        ? intl.formatMessage(globalMessages.collection)
                        : intl.formatMessage(globalMessages.tvshow)}
                  </div>
                </div>
              )}
              {Boolean(releaseStatus) && statusBadgeElement}
              {isWatched && (
                <div className="pointer-events-none z-40 self-start rounded-full border border-emerald-500/80 bg-emerald-600/90 shadow-md">
                  <div className="flex h-4 items-center px-1.5 py-1 text-center text-[10px] font-bold uppercase tracking-wider text-white sm:h-5 sm:text-xs">
                    ✓ Seen
                  </div>
                </div>
              )}
            </div>
            <div className="pointer-events-auto flex flex-col items-end gap-1.5">
              {!Boolean(releaseStatus) && statusBadgeElement}
              {showDetail && currentStatus !== MediaStatus.BLOCKLISTED && (
                <div className="flex items-center gap-1 rounded-lg border border-gray-700/60 bg-gray-900/80 p-0.5 shadow-md backdrop-blur-sm">
                  {user && (
                    <Tooltip
                      content={isWatched ? 'Mark as Unwatched' : 'Mark as Watched'}
                    >
                      <Button
                        buttonType={isWatched ? 'primary' : 'ghost'}
                        className={`z-40 !p-1 ${
                          isWatched
                            ? '!bg-emerald-600 hover:!bg-emerald-700 text-white'
                            : ''
                        }`}
                        buttonSize={'sm'}
                        onClick={onClickWatchedBtn}
                      >
                        {isWatched ? (
                          <CheckCircleSolidIcon className={'h-3.5 w-3.5 text-white'} />
                        ) : (
                          <CheckCircleIcon className={'h-3.5 w-3.5 text-emerald-400'} />
                        )}
                      </Button>
                    </Tooltip>
                  )}
                  {user?.userType !== UserType.PLEX &&
                    (toggleWatchlist ? (
                      <Button
                        buttonType={'ghost'}
                        className="z-40 !p-1"
                        buttonSize={'sm'}
                        onClick={onClickWatchlistBtn}
                      >
                        <StarIcon className={'h-3.5 w-3.5 text-amber-300'} />
                      </Button>
                    ) : (
                      <Button
                        className="z-40 !p-1"
                        buttonSize={'sm'}
                        onClick={onClickDeleteWatchlistBtn}
                      >
                        <MinusCircleIcon className={'h-3.5 w-3.5'} />
                      </Button>
                    ))}
                  {showHideButton &&
                    currentStatus !== MediaStatus.PROCESSING &&
                    currentStatus !== MediaStatus.AVAILABLE &&
                    currentStatus !== MediaStatus.PARTIALLY_AVAILABLE &&
                    currentStatus !== MediaStatus.PENDING && (
                      <Button
                        buttonType={'ghost'}
                        className="z-40 !p-1"
                        buttonSize={'sm'}
                        onClick={() => setShowBlocklistModal(true)}
                      >
                        <EyeSlashIcon className={'h-3.5 w-3.5'} />
                      </Button>
                    )}
                  {user && isRecommendation && (
                    <Tooltip content={intl.formatMessage(messages.notInterested)}>
                      <Button
                        buttonType={'ghost'}
                        className="z-40 !p-1 text-gray-400 hover:!text-rose-400 hover:!bg-rose-500/20"
                        buttonSize={'sm'}
                        onClick={onClickDismissBtn}
                      >
                        <XMarkIcon className={'h-3.5 w-3.5'} />
                      </Button>
                    </Tooltip>
                  )}
                </div>
              )}
              {showDetail &&
                showHideButton &&
                currentStatus == MediaStatus.BLOCKLISTED && (
                  <Tooltip
                    content={intl.formatMessage(
                      globalMessages.removefromBlocklist
                    )}
                  >
                    <Button
                      buttonType={'ghost'}
                      className="z-40 !p-1"
                      buttonSize={'sm'}
                      onClick={() => onClickShowBlocklistBtn()}
                    >
                      <EyeIcon className={'h-3.5 w-3.5'} />
                    </Button>
                  </Tooltip>
                )}
            </div>
          </div>
          <Transition
            as={Fragment}
            show={isUpdating}
            enter="transition-opacity ease-in-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity ease-in-out duration-300"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="absolute inset-0 z-40 flex items-center justify-center rounded-xl bg-gray-800/75 text-white">
              <Spinner className="h-10 w-10" />
            </div>
          </Transition>

          <Transition
            as={Fragment}
            show={!image || showDetail || showRequestModal}
            enter="transition-opacity"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="absolute inset-0 overflow-hidden rounded-xl">
              <Link
                href={
                  mediaType === 'movie'
                    ? `/movie/${id}${basedOnTitle ? `?basedOn=${encodeURIComponent(basedOnTitle)}` : ''}`
                    : mediaType === 'collection'
                      ? `/collection/${id}`
                      : `/tv/${id}${basedOnTitle ? `?basedOn=${encodeURIComponent(basedOnTitle)}` : ''}`
                }
                className="absolute inset-0 h-full w-full cursor-pointer overflow-hidden text-left"
                style={{
                  background:
                    'linear-gradient(180deg, rgba(45, 55, 72, 0.4) 0%, rgba(45, 55, 72, 0.9) 100%)',
                }}
              >
                <div className="flex h-full w-full items-end">
                  <div
                    className={`px-2 text-white ${
                      hasBottomButton ? 'pb-12' : 'pb-2'
                    }`}
                  >
                    {(basedOnTitle || recommendationReason) && (
                      <div className="mb-1.5 flex flex-col rounded-md bg-rose-950/80 border border-rose-500/40 px-2 py-1 backdrop-blur-md">
                        <div className="text-[9px] uppercase tracking-wider font-bold text-rose-300">
                          <span>
                            {intl.formatMessage(messages.becauseYouLikedShort)}
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-white line-clamp-2 leading-snug">
                          {basedOnTitle ||
                            recommendationReason?.replace(
                              /^Because you liked\s+/i,
                              ''
                            )}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {displayYear && <div>{displayYear}</div>}
                      {ratings?.rt?.criticsScore !== undefined && (
                        <div
                          className="flex items-center gap-0.5 rounded bg-black/40 px-1 py-0.5 text-xs font-bold text-rose-400 border border-rose-500/30"
                          title="Rotten Tomatoes Tomatometer"
                        >
                          🍅 {ratings.rt.criticsScore}%
                        </div>
                      )}
                      {ratings?.imdb?.criticsScore !== undefined && (
                        <div
                          className="flex items-center gap-0.5 rounded bg-black/40 px-1 py-0.5 text-xs font-bold text-yellow-400 border border-yellow-500/30"
                          title="IMDb Rating"
                        >
                          ★ {ratings.imdb.criticsScore.toFixed(1)}
                        </div>
                      )}
                      {!ratings?.imdb?.criticsScore &&
                        userScore !== undefined &&
                        userScore > 0 && (
                          <div
                            className="flex items-center gap-0.5 rounded bg-black/40 px-1 py-0.5 text-xs font-bold text-amber-400 border border-amber-500/30"
                            title="TMDB Rating"
                          >
                            ★ {userScore.toFixed(1)}
                          </div>
                        )}
                    </div>

                    <h1
                      className="whitespace-normal text-xl font-bold leading-tight"
                      style={{
                        WebkitLineClamp: 3,
                        display: '-webkit-box',
                        overflow: 'hidden',
                        WebkitBoxOrient: 'vertical',
                        wordBreak: 'break-word',
                      }}
                      data-testid="title-card-title"
                    >
                      {title}
                    </h1>
                    <div
                      className="whitespace-normal text-xs"
                      style={{
                        WebkitLineClamp: hasBottomButton ? 2 : 4,
                        display: '-webkit-box',
                        overflow: 'hidden',
                        WebkitBoxOrient: 'vertical',
                        wordBreak: 'break-word',
                      }}
                    >
                      {summary}
                    </div>
                  </div>
                </div>
              </Link>

              <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 py-2">
                {isAvailable ? (
                  <Button
                    buttonType="primary"
                    buttonSize="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      router.push(`/watch/${id}?type=${mediaType}`);
                    }}
                    className="h-7 w-full bg-green-600 hover:bg-green-500 border-green-600 hover:border-green-500 flex items-center justify-center gap-1"
                  >
                    <PlayIcon className="h-4 w-4" />
                    <span>Play</span>
                  </Button>
                ) : isDownloading || isProcessing ? (
                  <Button
                    buttonType="default"
                    buttonSize="sm"
                    disabled
                    className="h-7 w-full opacity-70 cursor-not-allowed flex items-center justify-center gap-1"
                  >
                    <span>{isDownloading ? `Downloading (${downloadProgress}%)` : 'Processing'}</span>
                  </Button>
                ) : isRequested ? (
                  <Button
                    buttonType="default"
                    buttonSize="sm"
                    disabled
                    className="h-7 w-full opacity-70 cursor-not-allowed flex items-center justify-center gap-1"
                  >
                    <span>Requested ✓</span>
                  </Button>
                ) : (
                  showRequestButton &&
                  (!currentStatus ||
                    currentStatus === MediaStatus.UNKNOWN ||
                    currentStatus === MediaStatus.DELETED) && (
                    <Button
                      buttonType="primary"
                      buttonSize="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        setShowRequestModal(true);
                      }}
                      className="h-7 w-full"
                    >
                      <ArrowDownTrayIcon />
                      <span>{intl.formatMessage(globalMessages.request)}</span>
                    </Button>
                  )
                )}
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </div>
  );
};

export default withProperties(TitleCard, { Placeholder, ErrorCard });

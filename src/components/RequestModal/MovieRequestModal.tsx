import Alert from '@app/components/Common/Alert';
import Modal from '@app/components/Common/Modal';
import type { RequestOverrides } from '@app/components/RequestModal/AdvancedRequester';
import AdvancedRequester from '@app/components/RequestModal/AdvancedRequester';
import QuotaDisplay from '@app/components/RequestModal/QuotaDisplay';
import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import globalMessages from '@app/i18n/globalMessages';
import defineMessages from '@app/utils/defineMessages';
import { MediaStatus } from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { NonFunctionProperties } from '@server/interfaces/api/common';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import { Permission } from '@server/lib/permissions';
import type { MovieDetails } from '@server/models/Movie';
import axios from 'axios';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';
import {
  ClockIcon,
  FilmIcon,
  SparklesIcon,
  CheckCircleIcon,
  ArrowDownTrayIcon,
  GlobeAltIcon,
} from '@heroicons/react/24/outline';

const messages = defineMessages('components.RequestModal', {
  requestadmin: 'This request will be approved automatically.',
  requestSuccess: '<strong>{title}</strong> requested successfully!',
  requestCancel: 'Request for <strong>{title}</strong> canceled.',
  requestmovietitle: 'Request Movie',
  requestmovie4ktitle: 'Request Movie in 4K',
  edit: 'Edit Request',
  approve: 'Approve Request',
  cancel: 'Cancel Request',
  pendingrequest: 'Pending Movie Request',
  pending4krequest: 'Pending 4K Movie Request',
  requestfrom: "{username}'s request is pending approval.",
  errorediting: 'Something went wrong while editing the request.',
  requestedited: 'Request for <strong>{title}</strong> edited successfully!',
  requestApproved: 'Request for <strong>{title}</strong> approved!',
  requesterror: 'Something went wrong while submitting the request.',
  pendingapproval: 'Your request is pending approval.',
});

interface RequestModalProps extends React.HTMLAttributes<HTMLDivElement> {
  tmdbId: number;
  is4k?: boolean;
  editRequest?: NonFunctionProperties<MediaRequest>;
  onCancel?: () => void;
  onComplete?: (newStatus: MediaStatus) => void;
  onUpdating?: (isUpdating: boolean) => void;
}

const MovieRequestModal = ({
  onCancel,
  onComplete,
  tmdbId,
  onUpdating,
  editRequest,
  is4k = false,
}: RequestModalProps) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [requestOverrides, setRequestOverrides] =
    useState<RequestOverrides | null>(null);
  const { addToast } = useToasts();
  const { data, error } = useSWR<MovieDetails>(`/api/v1/movie/${tmdbId}`, {
    revalidateOnMount: true,
  });
  const intl = useIntl();
  const { user, hasPermission } = useUser();
  const { data: quota } = useSWR<QuotaResponse>(
    user &&
      (!requestOverrides?.user?.id || hasPermission(Permission.MANAGE_USERS))
      ? `/api/v1/user/${requestOverrides?.user?.id ?? user.id}/quota`
      : null
  );

  const [availability, setAvailability] = useState<{
    checking: boolean;
    multiTorrentFound?: boolean;
    multiTorrent?: { title: string; seeders: number; size: number };
    streamAvailable?: boolean;
    stream?: { source: string; streamUrl: string; quality: string; audio: string };
    englishTorrentAvailable?: boolean;
    englishTorrent?: { title: string; seeders: number; size: number };
  }>({ checking: true });
  const [downloadMode, setDownloadMode] = useState<'stream' | 'torrent'>('torrent');

  useEffect(() => {
    if (!data?.id) return;
    let isMounted = true;
    const year = data.releaseDate
      ? new Date(data.releaseDate).getFullYear()
      : undefined;

    axios
      .post('/api/v1/stream/check', {
        tmdbId: data.id,
        englishTitle: data.originalTitle,
        spanishTitle: data.title,
        year,
      })
      .then((res) => {
        if (isMounted) {
          setAvailability({
            checking: false,
            ...res.data,
          });
          if (res.data.multiTorrentFound) {
            setDownloadMode('torrent');
          } else if (res.data.streamAvailable) {
            setDownloadMode('stream');
          } else {
            setDownloadMode('torrent');
          }
        }
      })
      .catch(() => {
        if (isMounted) {
          setAvailability({
            checking: false,
            multiTorrentFound: false,
            streamAvailable: false,
          });
          setDownloadMode('torrent');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [data?.id, data?.originalTitle, data?.title, data?.releaseDate]);

  useEffect(() => {
    if (onUpdating) {
      onUpdating(isUpdating);
    }
  }, [isUpdating, onUpdating]);

  const sendRequest = useCallback(async () => {
    setIsUpdating(true);

    try {
      let overrideParams = {};
      if (requestOverrides) {
        overrideParams = {
          serverId: requestOverrides.server,
          profileId: requestOverrides.profile,
          rootFolder: requestOverrides.folder,
          userId: requestOverrides.user?.id,
          tags: requestOverrides.tags,
        };
      }
      const response = await axios.post<MediaRequest>('/api/v1/request', {
        mediaId: data?.id,
        mediaType: 'movie',
        is4k,
        ignoreQuota: requestOverrides?.ignoreQuota,
        ...overrideParams,
      });
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      if (response.data) {
        if (onComplete) {
          onComplete(
            hasPermission(
              is4k ? Permission.AUTO_APPROVE_4K : Permission.AUTO_APPROVE
            ) ||
              hasPermission(
                is4k
                  ? Permission.AUTO_APPROVE_4K_MOVIE
                  : Permission.AUTO_APPROVE_MOVIE
              )
              ? MediaStatus.PROCESSING
              : MediaStatus.PENDING
          );
        }
        addToast(
          <span>
            {intl.formatMessage(messages.requestSuccess, {
              title: data?.title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
    } catch {
      addToast(intl.formatMessage(messages.requesterror), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  }, [
    requestOverrides,
    data?.id,
    data?.title,
    is4k,
    onComplete,
    addToast,
    intl,
    hasPermission,
  ]);

  const handleDownload = useCallback(async () => {
    if (downloadMode === 'stream' && availability.stream?.streamUrl && data) {
      setIsUpdating(true);
      try {
        const year = data.releaseDate
          ? new Date(data.releaseDate).getFullYear()
          : undefined;

        await axios.post('/api/v1/stream/download', {
          tmdbId: data.id,
          title: data.title,
          year,
          streamUrl: availability.stream.streamUrl,
        });

        mutate('/api/v1/media/queue');

        addToast(
          <span>
            Descarga de stream en <strong>Español Latino</strong> iniciada para{' '}
            <strong>{data.title}</strong>. Puedes seguir el progreso en{' '}
            <a
              href="/downloads"
              className="underline font-bold text-indigo-300 hover:text-indigo-200"
            >
              Descargas
            </a>
            .
          </span>,
          { appearance: 'success', autoDismiss: true }
        );

        if (onComplete) {
          onComplete(MediaStatus.PROCESSING);
        }
      } catch (e: any) {
        addToast(
          <span>
            Error en stream: {e.message}. Cambiando a torrent en inglés...
          </span>,
          { appearance: 'error', autoDismiss: true }
        );
        await sendRequest();
      } finally {
        setIsUpdating(false);
      }
    } else {
      await sendRequest();
    }
  }, [
    downloadMode,
    availability.stream,
    data,
    sendRequest,
    addToast,
    onComplete,
  ]);

  const cancelRequest = async () => {
    setIsUpdating(true);

    try {
      const response = await axios.delete<MediaRequest>(
        `/api/v1/request/${editRequest?.id}`
      );
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      if (response.status === 204) {
        if (onComplete) {
          onComplete(MediaStatus.UNKNOWN);
        }
        addToast(
          <span>
            {intl.formatMessage(messages.requestCancel, {
              title: data?.title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            })}
          </span>,
          { appearance: 'success', autoDismiss: true }
        );
      }
    } catch {
      setIsUpdating(false);
    }
  };

  const updateRequest = async (alsoApproveRequest = false) => {
    setIsUpdating(true);

    try {
      await axios.put(`/api/v1/request/${editRequest?.id}`, {
        mediaType: 'movie',
        serverId: requestOverrides?.server,
        profileId: requestOverrides?.profile,
        rootFolder: requestOverrides?.folder,
        userId: requestOverrides?.user?.id,
        tags: requestOverrides?.tags,
      });

      if (alsoApproveRequest) {
        await axios.post(`/api/v1/request/${editRequest?.id}/approve`);
      }
      mutate('/api/v1/request?filter=all&take=10&sort=modified&skip=0');
      mutate('/api/v1/request/count');

      addToast(
        <span>
          {intl.formatMessage(
            alsoApproveRequest
              ? messages.requestApproved
              : messages.requestedited,
            {
              title: data?.title,
              strong: (msg: React.ReactNode) => <strong>{msg}</strong>,
            }
          )}
        </span>,
        {
          appearance: 'success',
          autoDismiss: true,
        }
      );

      if (onComplete) {
        onComplete(MediaStatus.PENDING);
      }
    } catch {
      addToast(<span>{intl.formatMessage(messages.errorediting)}</span>, {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  if (editRequest) {
    const isOwner = editRequest.requestedBy.id === user?.id;

    return (
      <Modal
        loading={!data && !error}
        backgroundClickable
        onCancel={onCancel}
        title={intl.formatMessage(
          is4k ? messages.pending4krequest : messages.pendingrequest
        )}
        subTitle={data?.title}
        onOk={() =>
          hasPermission(Permission.MANAGE_REQUESTS)
            ? updateRequest(true)
            : hasPermission(Permission.REQUEST_ADVANCED)
              ? updateRequest()
              : cancelRequest()
        }
        okDisabled={isUpdating}
        okText={
          hasPermission(Permission.MANAGE_REQUESTS)
            ? intl.formatMessage(messages.approve)
            : hasPermission(Permission.REQUEST_ADVANCED)
              ? intl.formatMessage(messages.edit)
              : intl.formatMessage(messages.cancel)
        }
        okButtonType={
          hasPermission(Permission.MANAGE_REQUESTS)
            ? 'success'
            : hasPermission(Permission.REQUEST_ADVANCED)
              ? 'primary'
              : 'danger'
        }
        onSecondary={
          isOwner &&
          hasPermission(
            [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
            { type: 'or' }
          )
            ? () => cancelRequest()
            : undefined
        }
        secondaryDisabled={isUpdating}
        secondaryText={
          isOwner &&
          hasPermission(
            [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
            { type: 'or' }
          )
            ? intl.formatMessage(messages.cancel)
            : undefined
        }
        secondaryButtonType="danger"
        cancelText={intl.formatMessage(globalMessages.close)}
        backdrop={`https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${data?.backdropPath}`}
      >
        {isOwner
          ? intl.formatMessage(messages.pendingapproval)
          : intl.formatMessage(messages.requestfrom, {
              username: editRequest.requestedBy.displayName,
            })}
        {(hasPermission(Permission.REQUEST_ADVANCED) ||
          hasPermission(Permission.MANAGE_REQUESTS)) && (
          <AdvancedRequester
            type="movie"
            is4k={is4k}
            requestUser={editRequest.requestedBy}
            defaultOverrides={{
              folder: editRequest.rootFolder,
              profile: editRequest.profileId,
              server: editRequest.serverId,
              tags: editRequest.tags,
            }}
            onChange={(overrides) => {
              setRequestOverrides(overrides);
            }}
          />
        )}
      </Modal>
    );
  }

  const hasAutoApprove = hasPermission(
    [
      Permission.MANAGE_REQUESTS,
      is4k ? Permission.AUTO_APPROVE_4K : Permission.AUTO_APPROVE,
      is4k ? Permission.AUTO_APPROVE_4K_MOVIE : Permission.AUTO_APPROVE_MOVIE,
    ],
    { type: 'or' }
  );

  return (
    <Modal
      loading={(!data && !error) || !quota}
      backgroundClickable
      onCancel={onCancel}
      onOk={handleDownload}
      okDisabled={
        isUpdating ||
        (quota?.movie.restricted && !requestOverrides?.ignoreQuota)
      }
      title={intl.formatMessage(
        is4k ? messages.requestmovie4ktitle : messages.requestmovietitle
      )}
      subTitle={data?.title}
      okText={
        isUpdating
          ? intl.formatMessage(globalMessages.requesting)
          : downloadMode === 'stream'
          ? 'Descargar Stream Latino'
          : intl.formatMessage(
              is4k ? globalMessages.request4k : globalMessages.request
            )
      }
      okButtonType={'primary'}
      backdrop={`https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${data?.backdropPath}`}
    >
      {/* Smart Availability / Latino Fallback Card */}
      <div className="mt-4">
        {availability.checking ? (
          <div className="bg-gray-800/60 border border-gray-700/60 rounded-xl p-3 flex items-center gap-3 text-xs text-gray-400 animate-pulse">
            <SparklesIcon className="w-5 h-5 text-indigo-400 shrink-0 animate-spin" />
            <span>Verificando disponibilidad de torrents multi-audio y streams en español...</span>
          </div>
        ) : availability.multiTorrentFound ? (
          <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-xl p-3 flex items-start gap-3 text-xs text-emerald-300">
            <CheckCircleIcon className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-emerald-200">Torrent con Audio Latino Disponible</div>
              <div className="text-emerald-400/90">
                Se detectó una versión con doblaje latino ({availability.multiTorrent?.seeders || 1} semillas). Se descargará automáticamente vía Radarr.
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
              <SparklesIcon className="w-4 h-4 text-amber-400" />
              <span>Opciones de Descarga (Sin torrent en audio latino)</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Option 1: Latino Stream */}
              <button
                type="button"
                onClick={() => setDownloadMode('stream')}
                disabled={!availability.streamAvailable}
                className={`flex flex-col text-left p-3.5 rounded-xl border transition-all ${
                  downloadMode === 'stream'
                    ? 'border-indigo-500 bg-indigo-950/40 ring-2 ring-indigo-500/30'
                    : availability.streamAvailable
                    ? 'border-gray-800 bg-gray-900/60 hover:border-gray-700'
                    : 'border-gray-800/40 bg-gray-900/20 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <FilmIcon className="w-4 h-4 text-emerald-400" />
                    <span className="font-bold text-sm text-gray-100">Doblaje Latino (Stream)</span>
                  </div>
                  {availability.streamAvailable && (
                    <span className="px-1.5 py-0.5 text-[10px] uppercase font-bold bg-emerald-900/60 text-emerald-300 rounded border border-emerald-700/50">
                      Recomendado
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-400 flex-1">
                  {availability.streamAvailable
                    ? `Descarga directa en ${availability.stream?.quality || 'HD'} con audio latino desde servidor de streaming.`
                    : 'No disponible en streaming en este momento.'}
                </p>
                {availability.streamAvailable && (
                  <div className="mt-2 text-[11px] text-indigo-300 font-medium">
                    ⚡ Descarga ultrarrápida (~3-5 mins)
                  </div>
                )}
              </button>

              {/* Option 2: English Torrent */}
              <button
                type="button"
                onClick={() => setDownloadMode('torrent')}
                className={`flex flex-col text-left p-3.5 rounded-xl border transition-all ${
                  downloadMode === 'torrent'
                    ? 'border-indigo-500 bg-indigo-950/40 ring-2 ring-indigo-500/30'
                    : 'border-gray-800 bg-gray-900/60 hover:border-gray-700'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <GlobeAltIcon className="w-4 h-4 text-blue-400" />
                    <span className="font-bold text-sm text-gray-100">Inglés + Subtítulos</span>
                  </div>
                  <span className="px-1.5 py-0.5 text-[10px] uppercase font-bold bg-blue-900/60 text-blue-300 rounded border border-blue-700/50">
                    Torrent
                  </span>
                </div>
                <p className="text-xs text-gray-400 flex-1">
                  Descarga torrent en calidad nativa en inglés. Bazarr sincronizará subtítulos en español.
                </p>
                <div className="mt-2 text-[11px] text-blue-300 font-medium">
                  {availability.englishTorrent?.seeders
                    ? `Torrent activo (${availability.englishTorrent.seeders} semillas)`
                    : 'Torrent estándar'}
                </div>
              </button>
            </div>
          </div>
        )}
      </div>
      {hasAutoApprove && !quota?.movie.restricted && (
        <div className="mt-6">
          <Alert
            title={intl.formatMessage(messages.requestadmin)}
            type="info"
          />
        </div>
      )}
      {(quota?.movie.limit ?? 0) > 0 && (
        <QuotaDisplay
          mediaType="movie"
          quota={quota?.movie}
          userOverride={
            requestOverrides?.user && requestOverrides.user.id !== user?.id
              ? requestOverrides?.user?.id
              : undefined
          }
        />
      )}
      {(hasPermission(Permission.REQUEST_ADVANCED) ||
        hasPermission(Permission.MANAGE_REQUESTS)) && (
        <AdvancedRequester
          type="movie"
          is4k={is4k}
          quota={quota}
          onChange={(overrides) => {
            setRequestOverrides(overrides);
          }}
        />
      )}
      
      {/* Estimated Download Time Card */}
      <div className="mt-4 bg-gray-900/60 border border-gray-800 rounded-2xl p-4 flex items-start gap-3 text-gray-300">
        <ClockIcon className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
        <div className="text-xs leading-normal">
          <div className="font-bold text-gray-200 text-sm mb-0.5">Estimated Download Time</div>
          <div>
            Approximately <strong className="text-indigo-400">{is4k ? '~50 mins' : '~10 mins'}</strong> to download this movie
            <span className="text-gray-400"> (est. size: {is4k ? '20 GB' : '4 GB'} at 50 Mbps connection speed).</span>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default MovieRequestModal;

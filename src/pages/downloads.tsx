import Badge from '@app/components/Common/Badge';
import CachedImage from '@app/components/Common/CachedImage';
import Header from '@app/components/Common/Header';
import PageTitle from '@app/components/Common/PageTitle';
import useToasts from '@app/hooks/useToasts';
import axios from 'axios';
import useSWR from 'swr';
import type { NextPage } from 'next';
import { useIntl } from 'react-intl';
import { useState, useEffect, useCallback } from 'react';
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  ExclamationCircleIcon,
  MagnifyingGlassIcon,
  PauseIcon,
  ServerIcon,
  SparklesIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';

export interface WatchedEpisodeItem {
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  size: number;
}

export interface ReclaimableMediaItem {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  posterPath?: string;
  releaseDate?: string;
  reclaimableBytes: number;
  played?: boolean;
  watchedEpisodesCount?: number;
  totalEpisodesCount?: number;
  remainingMonitoredCount?: number;
  watchedEpisodes?: WatchedEpisodeItem[];
}

export interface StorageReclaimResponse {
  totalReclaimableBytes: number;
  items: ReclaimableMediaItem[];
}

interface QueueItem {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  status: 'searching' | 'downloading' | 'processing' | 'paused' | 'queued' | 'failed';
  progress: number;
  timeLeft: string;
  estimatedCompletionTime: string | null;
  title: string;
  size: string;
  sizeLeft: string;
  downloadClient: string;
  downloadSpeed?: string;
  protocol: string;
  is4k: boolean;
  downloadId?: string | null;
  seedsConnected?: number | null;
  seedsTotal?: number | null;
  peersConnected?: number | null;
  peersTotal?: number | null;
  torrentState?: string | null;
  swarmHealth?: 'healthy' | 'slow' | 'stalled' | 'idle' | null;
  details?: {
    monitored: boolean;
    status: string;
    nextAiring?: string;
    episodeCount?: number;
    episodeFileCount?: number;
    totalEpisodeCount?: number;
    hasFile?: boolean;
    minimumAvailability?: string;
  };
  healthWarnings?: string[];
}

const DownloadCard = ({ item }: { item: QueueItem }) => {
  const url = item.mediaType === 'movie' ? `/api/v1/movie/${item.tmdbId}` : `/api/v1/tv/${item.tmdbId}`;
  const { data: details } = useSWR<MovieDetails | TvDetails>(url);

  const { data: retentionData, mutate: mutateRetention } = useSWR<{ policy: string }>(
    `/api/v1/media/${item.mediaType}/${item.tmdbId}/retention`
  );
  const policy = retentionData?.policy || 'dont_delete';

  const handlePolicyChange = async (newPolicy: string) => {
    try {
      await fetch(`/api/v1/media/${item.mediaType}/${item.tmdbId}/retention`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policy: newPolicy }),
      });
      mutateRetention({ policy: newPolicy });
    } catch {
      // ignore
    }
  };

  const displayTitle = details
    ? ('title' in details ? details.title : details.name)
    : (item.mediaType === 'movie' ? 'Movie' : 'Series');

  const releaseDate = details
    ? ('releaseDate' in details ? details.releaseDate : details.firstAirDate)
    : '';
  const year = releaseDate ? `(${new Date(releaseDate).getFullYear()})` : '';
  const poster = details?.posterPath;

  // Status rendering properties
  let statusColor = 'bg-gray-600/20 text-gray-400 border-gray-500/30';
  let statusText = 'Unknown';
  let StatusIcon = ClockIcon;

  const isDownloaded = item.mediaType === 'movie' 
    ? item.details?.hasFile === true 
    : (item.details?.episodeFileCount !== undefined && 
       item.details?.totalEpisodeCount !== undefined && 
       item.details.totalEpisodeCount > 0 &&
       item.details.episodeFileCount === item.details.totalEpisodeCount);

  switch (item.status) {
    case 'searching':
      if (isDownloaded) {
        statusColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
        statusText = 'Downloaded (Awaiting Plex)';
        StatusIcon = CheckCircleIcon;
      } else {
        statusColor = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
        statusText = 'Searching Indexers...';
        StatusIcon = MagnifyingGlassIcon;
      }
      break;
    case 'downloading':
      statusColor = 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      statusText = `Downloading (${item.progress}%)`;
      StatusIcon = ArrowDownTrayIcon;
      break;
    case 'processing':
      statusColor = 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      statusText = 'Importing & Renaming...';
      StatusIcon = CheckCircleIcon;
      break;
    case 'paused':
      statusColor = 'bg-gray-500/10 text-gray-400 border-gray-500/20';
      statusText = 'Paused';
      StatusIcon = PauseIcon;
      break;
    case 'queued':
      statusColor = 'bg-teal-500/10 text-teal-400 border-teal-500/20';
      statusText = 'Queued';
      StatusIcon = ClockIcon;
      break;
    case 'failed':
      statusColor = 'bg-red-500/10 text-red-400 border-red-500/20';
      statusText = 'Stalled / Failed';
      StatusIcon = ExclamationCircleIcon;
      break;
  }

  return (
    <div className="flex flex-col md:flex-row bg-gray-800/40 backdrop-blur-md rounded-2xl border border-gray-700/50 p-4 gap-4 shadow-xl hover:border-gray-600/70 hover:bg-gray-800/60 transition duration-300">
      {/* Poster */}
      <div className="relative w-24 h-36 flex-shrink-0 rounded-xl overflow-hidden shadow-lg bg-gray-900 border border-gray-700/50">
        <CachedImage
          type="tmdb"
          src={poster ? `https://image.tmdb.org/t/p/w300_and_h450_face${poster}` : '/images/seerr_poster_not_found_logo_top.png'}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          fill
        />
      </div>

      {/* Info & Stats */}
      <div className="flex flex-col justify-between flex-grow min-w-0">
        <div>
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-2">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h2 className="text-lg font-bold text-white truncate max-w-md">
                  {displayTitle} <span className="text-gray-400 font-normal text-sm">{year}</span>
                </h2>
                <Badge badgeType={item.is4k ? 'warning' : 'primary'}>
                  {item.is4k ? '4K' : 'HD'}
                </Badge>
                <Badge badgeType={item.mediaType === 'movie' ? 'success' : 'danger'}>
                  {item.mediaType === 'movie' ? 'Movie' : 'Series'}
                </Badge>
                {item.protocol === 'stream' && (
                  <Badge badgeType="warning">
                    Audio Latino
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Status Badge */}
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${statusColor}`}>
                  <StatusIcon className="w-3.5 h-3.5" />
                  <span>{statusText}</span>
                </div>

                {/* Protocol: Stream vs Swarm Health Badge */}
                {item.protocol === 'stream' ? (
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border bg-gradient-to-r from-purple-500/15 via-pink-500/15 to-purple-500/15 text-pink-300 border-pink-500/30">
                    <span className="relative flex h-2 w-2">
                      <span
                        className={`inline-flex h-full w-full rounded-full bg-pink-400 ${
                          item.status === 'downloading' ? 'animate-ping' : ''
                        }`}
                      />
                    </span>
                    <span>
                      ⚡ {item.status === 'downloading' ? 'Stream Latino en vivo' : item.status === 'processing' ? 'Stream Listo / Importado' : 'Stream Latino'}
                    </span>
                  </div>
                ) : (
                  item.swarmHealth && item.status !== 'searching' && (
                    <div
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                        item.swarmHealth === 'healthy'
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : item.swarmHealth === 'slow'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : item.swarmHealth === 'stalled'
                          ? 'bg-red-500/10 text-red-400 border-red-500/20'
                          : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                      }`}
                      title={
                        item.swarmHealth === 'stalled'
                          ? 'No active seeders sending data. Torrent is stalled.'
                          : item.swarmHealth === 'healthy'
                          ? 'Strong swarm with active seeders.'
                          : 'Moderate or slow swarm speed.'
                      }
                    >
                      <span className="relative flex h-2 w-2">
                        <span
                          className={`inline-flex h-full w-full rounded-full ${
                            item.swarmHealth === 'healthy'
                              ? 'bg-emerald-400'
                              : item.swarmHealth === 'slow'
                              ? 'bg-amber-400'
                              : item.swarmHealth === 'stalled'
                              ? 'bg-red-400 animate-ping'
                              : 'bg-gray-400'
                          }`}
                        />
                      </span>
                      <span>
                        {item.swarmHealth === 'healthy'
                          ? `Swarm Healthy (${item.seedsConnected ?? 0} seeds)`
                          : item.swarmHealth === 'slow'
                          ? `Slow Swarm (${item.seedsConnected ?? 0} seeds)`
                          : item.swarmHealth === 'stalled'
                          ? 'Stalled (0 Seeds)'
                          : 'Seeding / Idle'}
                      </span>
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Actions & Retention Selector */}
            <div className="flex flex-col gap-2 items-start sm:items-end">
              <div className="flex flex-col gap-1 items-start sm:items-end">
                <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Retention Policy</span>
                <select
                  value={policy}
                  onChange={(e) => handlePolicyChange(e.target.value)}
                  className="text-xs bg-gray-900 border border-gray-700/60 hover:border-gray-600 text-gray-300 rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-indigo-500 transition duration-200 cursor-pointer"
                >
                  <option value="dont_delete">💾 Keep Indefinitely</option>
                  <option value="delete_after_watched">🗑️ Delete After Watched</option>
                  <option value="delete_after_7_days">🕒 Delete After 7 Days</option>
                </select>
              </div>

              {item.protocol === 'stream' && item.status === 'downloading' && item.downloadId && (
                <button
                  onClick={async () => {
                    if (confirm(`¿Deseas cancelar la descarga de "${item.title}"?`)) {
                      await axios.post(`/api/v1/stream/cancel/${item.downloadId}`);
                    }
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-400 hover:text-red-300 bg-red-950/30 hover:bg-red-900/50 border border-red-800/40 px-2.5 py-1 rounded-lg transition cursor-pointer"
                  title="Cancelar descarga del stream"
                >
                  <span>⏹ Cancelar Stream</span>
                </button>
              )}
            </div>
          </div>

          {/* Release Title (torrent filename or stream details) */}
          {item.title && (
            <div className="text-xs font-mono text-gray-400/80 line-clamp-1 break-all mb-2" title={item.title}>
              {item.title}
            </div>
          )}
        </div>

        {/* Progress details */}
        <div>
          {item.status !== 'searching' && (
            <>
              {/* Progress Bar */}
              <div className="relative w-full h-2.5 bg-gray-900/60 rounded-full overflow-hidden mb-2">
                <div
                  className={`h-full ${
                    item.protocol === 'stream'
                      ? 'bg-gradient-to-r from-purple-500 via-pink-500 to-indigo-500'
                      : 'bg-gradient-to-r from-blue-500 to-indigo-600'
                  } rounded-full transition-all duration-500 ${
                    item.status === 'downloading' ? 'animate-pulse' : ''
                  }`}
                  style={{ width: `${item.progress}%` }}
                />
              </div>

              {/* Swarm Stalled Warning Banner */}
              {item.swarmHealth === 'stalled' && (
                <div className="mb-2 rounded-lg border border-red-500/20 bg-red-950/20 px-3 py-1.5 text-xs text-red-400 flex items-center gap-2">
                  <ExclamationCircleIcon className="h-4 w-4 shrink-0 text-red-400" />
                  <span>
                    <strong>Swarm Stalled:</strong> 0 seeders currently connected ({item.seedsTotal ?? 0} listed in tracker). Public tracker seeds may be offline or unconnectable.
                  </span>
                </div>
              )}

              {/* Stats Footer */}
              <div className="flex flex-wrap justify-between text-xs text-gray-400 gap-y-1">
                <div className="flex flex-wrap gap-4">
                  {item.size && (
                    <span>
                      Size: <strong className="text-gray-200">{item.sizeLeft}</strong> left of <strong className="text-gray-200">{item.size}</strong>
                    </span>
                  )}
                  {item.downloadSpeed && (
                    <span className="text-green-400 font-semibold">
                      ↓ {item.downloadSpeed}
                    </span>
                  )}
                  {item.seedsConnected !== undefined && item.seedsConnected !== null && (
                    <span
                      className="inline-flex items-center gap-1"
                      title={`${item.seedsConnected} seeds connected out of ${item.seedsTotal ?? 0} in swarm`}
                    >
                      <span className="text-gray-400">🌱 Seeds:</span>
                      <strong
                        className={
                          (item.seedsConnected ?? 0) > 0
                            ? 'text-emerald-400'
                            : 'text-red-400 font-bold'
                        }
                      >
                        {item.seedsConnected}
                      </strong>
                      <span className="text-gray-500">
                        /{item.seedsTotal ?? 0}
                      </span>
                    </span>
                  )}
                  {item.peersConnected !== undefined && item.peersConnected !== null && (
                    <span
                      className="inline-flex items-center gap-1"
                      title={`${item.peersConnected} peers connected out of ${item.peersTotal ?? 0} in swarm`}
                    >
                      <span className="text-gray-400">👥 Peers:</span>
                      <strong className="text-gray-200">
                        {item.peersConnected}
                      </strong>
                      <span className="text-gray-500">
                        /{item.peersTotal ?? 0}
                      </span>
                    </span>
                  )}
                  {item.downloadClient && (
                    <span>
                      Client: <strong className="text-gray-200">{item.downloadClient}</strong>
                    </span>
                  )}
                </div>
                {item.timeLeft && (
                  <span
                    className={`font-semibold ${
                      item.swarmHealth === 'stalled'
                        ? 'text-red-400'
                        : 'text-blue-400'
                    }`}
                  >
                    ETA: {item.timeLeft}
                  </span>
                )}
              </div>
            </>
          )}

          {item.status === 'searching' && (
            <div className="flex flex-col gap-2 mt-2">
              <div className={`text-xs font-medium flex items-center gap-1.5 ${isDownloaded ? 'text-emerald-400/95' : 'text-amber-400/95'}`}>
                {isDownloaded ? (
                  <>
                    <CheckCircleIcon className="w-4 h-4 shrink-0 text-emerald-400" />
                    Downloaded on disk! Click "Scan Library" in the top right to import into Jellyfin & Plex.
                  </>
                ) : (
                  <>
                    <ClockIcon className="w-4 h-4 shrink-0" />
                    Null-seerr has submitted the request. Radarr/Sonarr is searching trackers for a matching release...
                  </>
                )}
              </div>

              {/* Servarr details */}
              {item.details && (
                <div className="text-xs bg-gray-900/60 border border-gray-800 rounded-xl p-3 space-y-1.5 text-gray-300">
                  <div className="flex justify-between items-center border-b border-gray-850 pb-1.5 mb-1.5">
                    <span className="font-semibold text-gray-400">DVR Integration Status</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${item.details.monitored ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                      {item.details.monitored ? 'Monitored' : 'Not Monitored'}
                    </span>
                  </div>
                  {item.mediaType === 'tv' ? (
                    <>
                      <div>
                        Airing Status: <strong className="text-white capitalize">{item.details.status}</strong>
                      </div>
                      <div>
                        Episodes Downloaded: <strong className="text-white">{item.details.episodeFileCount}</strong> of <strong className="text-white">{item.details.totalEpisodeCount}</strong>
                      </div>
                      {item.details.nextAiring && (
                        <div className="text-indigo-300 font-semibold mt-1">
                          📅 Next episode airs: {new Date(item.details.nextAiring).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div>
                        Availability Stage: <strong className="text-white capitalize">{item.details.status}</strong>
                      </div>
                      <div>
                        File Present: <strong className={item.details.hasFile ? 'text-green-400' : 'text-amber-400'}>{item.details.hasFile ? 'Yes' : 'No'}</strong>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Health Warnings */}
              {item.healthWarnings && item.healthWarnings.length > 0 && (
                <div className="text-xs bg-red-950/20 border border-red-900/40 rounded-xl p-3 space-y-1 text-red-400 font-medium">
                  <div className="font-bold flex items-center gap-1.5 text-red-300 mb-1">
                    <ExclamationCircleIcon className="w-4 h-4 shrink-0" />
                    Active Server Health Warnings:
                  </div>
                  {item.healthWarnings.map((warn: string, i: number) => (
                    <div key={i} className="flex gap-1.5 items-start pl-1 text-[11px] leading-relaxed">
                      <span>•</span>
                      <span>{warn}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const DownloadsPage: NextPage = () => {
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<'title' | 'status' | 'progress' | 'eta' | 'size'>('status');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [onlyDownload, setOnlyDownload] = useState(false);

  useEffect(() => {
    fetch('/api/v1/media/qbittorrent-seeding')
      .then((res) => res.json())
      .then((data) => setOnlyDownload(data.onlyDownload))
      .catch(() => {});
  }, []);

  const handleSeedingToggle = async (val: boolean) => {
    setOnlyDownload(val);
    try {
      await fetch('/api/v1/media/qbittorrent-seeding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onlyDownload: val }),
      });
    } catch {
      // ignore error
    }
  };

  const { data, mutate, isValidating } = useSWR<{
    queue: Record<number, any>;
    items: QueueItem[];
    completedIds?: number[];
  }>('/api/v1/media/queue', {
    refreshInterval: 3000,
    revalidateOnMount: true,
    revalidateOnFocus: true,
  });

  // When a download completes, trigger an extra immediate re-fetch so UI updates fast
  useEffect(() => {
    if (data?.completedIds && data.completedIds.length > 0) {
      // Re-fetch a couple times to catch the status update
      const t1 = setTimeout(() => mutate(), 3000);
      const t2 = setTimeout(() => mutate(), 8000);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [data?.completedIds?.join(','), mutate]);

  const handleScanNow = useCallback(async () => {
    setIsScanning(true);
    setScanMessage('');
    try {
      // Trigger all active media server and DVR scanner jobs
      const jobsToTrigger = [
        'jellyfin-recently-added-scan',
        'plex-recently-added-scan',
        'radarr-scan',
        'sonarr-scan',
        'availability-sync',
      ];
      await Promise.allSettled(
        jobsToTrigger.map((jobId) =>
          fetch(`/api/v1/settings/jobs/${jobId}/run`, { method: 'POST' })
        )
      );
      setScanMessage('✅ Library scan started (Jellyfin & Plex)!');
      // Re-fetch after scan has had time to run
      setTimeout(() => mutate(), 4000);
      setTimeout(() => mutate(), 10000);
    } catch {
      setScanMessage('❌ Failed to trigger scan.');
    } finally {
      setIsScanning(false);
      setTimeout(() => setScanMessage(''), 6000);
    }
  }, [mutate]);

  const items = data?.items || [];

  // Filter items
  const filteredItems = items.filter((item) => {
    // Status Filter
    if (statusFilter !== 'all') {
      if (statusFilter === 'stream') {
        if (item.protocol !== 'stream') {
          return false;
        }
      } else if (statusFilter === 'stalled') {
        if (item.swarmHealth !== 'stalled' && item.status !== 'failed') {
          return false;
        }
      } else if (item.status !== statusFilter) {
        return false;
      }
    }
    // Search filter
    if (searchFilter) {
      const term = searchFilter.toLowerCase();
      return (
        item.title.toLowerCase().includes(term) ||
        item.downloadClient.toLowerCase().includes(term) ||
        (item.protocol && item.protocol.toLowerCase().includes(term)) ||
        (item.protocol === 'stream' && ('latino'.includes(term) || 'stream'.includes(term))) ||
        item.tmdbId.toString().includes(term)
      );
    }
    return true;
  });

  // Sort items
  const STATUS_ORDER: Record<string, number> = {
    downloading: 0, processing: 1, queued: 2, searching: 3, paused: 4, failed: 5,
  };

  const sortedItems = [...filteredItems].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case 'title':    cmp = a.title.localeCompare(b.title); break;
      case 'status':   cmp = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9); break;
      case 'progress': cmp = a.progress - b.progress; break;
      case 'size':     cmp = parseFloat(a.size) - parseFloat(b.size); break;
      case 'eta': {
        const etaA = a.estimatedCompletionTime ? new Date(a.estimatedCompletionTime).getTime() : Infinity;
        const etaB = b.estimatedCompletionTime ? new Date(b.estimatedCompletionTime).getTime() : Infinity;
        cmp = etaA - etaB;
        break;
      }
    }
    return sortDirection === 'asc' ? cmp : -cmp;
  });

  const [activeTab, setActiveTab] = useState<'downloads' | 'reclaim'>('downloads');
  const [isDeletingReclaim, setIsDeletingReclaim] = useState(false);
  const [expandedShowIds, setExpandedShowIds] = useState<number[]>([]);
  const { addToast } = useToasts();

  const {
    data: reclaimData,
    mutate: mutateReclaim,
    isValidating: isReclaimValidating,
  } = useSWR<StorageReclaimResponse>('/api/v1/media/storage-reclaim', {
    revalidateOnFocus: true,
  });

  const handleDeleteReclaimItem = async (params: {
    mediaType: 'movie' | 'tv';
    tmdbId: number;
    seasonNumber?: number;
    episodeNumber?: number;
    title: string;
  }) => {
    const isSingleEp =
      params.seasonNumber !== undefined && params.episodeNumber !== undefined;
    const confirmMsg = isSingleEp
      ? `Delete file for Episode ${params.episodeNumber} of "${params.title}"? Remaining episodes will stay monitored.`
      : params.mediaType === 'tv'
      ? `Delete all watched episode files for "${params.title}"? Remaining episodes will stay monitored for auto-download.`
      : `Delete watched movie file for "${params.title}"?`;

    if (!window.confirm(confirmMsg)) return;

    setIsDeletingReclaim(true);
    try {
      const q = new URLSearchParams();
      if (params.seasonNumber !== undefined)
        q.set('seasonNumber', String(params.seasonNumber));
      if (params.episodeNumber !== undefined)
        q.set('episodeNumber', String(params.episodeNumber));

      const res = await axios.delete<{
        freedBytes: number;
        remainingMonitoredCount: number;
      }>(
        `/api/v1/media/${params.mediaType}/${params.tmdbId}/watched?${q.toString()}`
      );
      const mb = ((res.data?.freedBytes ?? 0) / (1024 * 1024)).toFixed(1);
      addToast(
        `Deleted watched file(s) (${mb} MB freed). ${
          params.mediaType === 'tv'
            ? `${res.data?.remainingMonitoredCount ?? 0} remaining episodes stay monitored.`
            : ''
        }`,
        { appearance: 'success', autoDismiss: true }
      );
      await mutateReclaim();
    } catch {
      addToast('Failed to delete watched media', {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsDeletingReclaim(false);
    }
  };

  const handleBatchDeleteReclaim = async () => {
    if (!reclaimData?.items?.length) return;
    if (
      !window.confirm(
        `Delete all watched files across ${reclaimData.items.length} titles and free ${(
          reclaimData.totalReclaimableBytes /
          (1024 * 1024 * 1024)
        ).toFixed(
          2
        )} GB? All remaining TV episodes will remain monitored for auto-download.`
      )
    ) {
      return;
    }

    setIsDeletingReclaim(true);
    try {
      const payloadItems = reclaimData.items.map((it) => ({
        mediaType: it.mediaType,
        tmdbId: it.tmdbId,
      }));
      const res = await axios.post<{
        freedBytes: number;
        deletedCount: number;
      }>('/api/v1/media/storage-reclaim/batch-delete', {
        items: payloadItems,
      });
      const gb = ((res.data?.freedBytes ?? 0) / (1024 * 1024 * 1024)).toFixed(2);
      addToast(
        `Batch cleanup complete! Freed ${gb} GB across ${
          res.data?.deletedCount ?? 0
        } titles.`,
        {
          appearance: 'success',
          autoDismiss: true,
        }
      );
      await mutateReclaim();
    } catch {
      addToast('Failed to batch delete watched media', {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsDeletingReclaim(false);
    }
  };

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  return (
    <>
      <PageTitle title={['Downloads & Queue']} />
      <div className="mb-6 flex flex-col justify-between md:flex-row md:items-end gap-4">
        <div>
          <Header>Downloads & Storage Management</Header>
          <p className="text-sm text-gray-400 mt-1">
            Monitor active torrent client downloads, renaming tasks, and reclaim storage from watched media.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeTab === 'downloads' && (
            <>
              <label className="flex items-center gap-2 bg-gray-800/80 text-gray-200 border border-gray-700/60 rounded-xl px-4 py-2 hover:bg-gray-700 hover:text-white transition duration-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={onlyDownload}
                  onChange={(e) => handleSeedingToggle(e.target.checked)}
                  className="w-4 h-4 text-indigo-600 bg-gray-900 border-gray-700 rounded focus:ring-indigo-500 focus:ring-2 focus:ring-offset-gray-800 focus:outline-none cursor-pointer"
                />
                <span className="text-xs font-semibold select-none">Only Download (No Seeding)</span>
              </label>

              <button
                onClick={() => mutate()}
                disabled={isValidating}
                className="flex items-center gap-1.5 bg-gray-800 text-gray-200 border border-gray-700/60 rounded-xl px-4 py-2 hover:bg-gray-700 hover:text-white transition duration-200 disabled:opacity-50 cursor-pointer"
              >
                <ArrowPathIcon className={`w-4 h-4 ${isValidating ? 'animate-spin' : ''}`} />
                <span>{isValidating ? 'Refreshing...' : 'Refresh'}</span>
              </button>

              <button
                onClick={handleScanNow}
                disabled={isScanning}
                className="flex items-center gap-1.5 bg-indigo-700/80 text-white border border-indigo-600/60 rounded-xl px-4 py-2 hover:bg-indigo-600 transition duration-200 disabled:opacity-50 cursor-pointer"
                title="Force Jellyfin & Plex library scans, and synchronize media availability"
              >
                <ServerIcon className={`w-4 h-4 ${isScanning ? 'animate-pulse' : ''}`} />
                <span>{isScanning ? 'Scanning...' : 'Scan Library'}</span>
              </button>
            </>
          )}

          {activeTab === 'reclaim' && (
            <button
              onClick={() => mutateReclaim()}
              disabled={isReclaimValidating}
              className="flex items-center gap-1.5 bg-gray-800 text-gray-200 border border-gray-700/60 rounded-xl px-4 py-2 hover:bg-gray-700 hover:text-white transition duration-200 disabled:opacity-50 cursor-pointer"
            >
              <ArrowPathIcon className={`w-4 h-4 ${isReclaimValidating ? 'animate-spin' : ''}`} />
              <span>{isReclaimValidating ? 'Scanning...' : 'Refresh Watched'}</span>
            </button>
          )}

          {scanMessage && (
            <span className="text-xs text-gray-300 animate-pulse">{scanMessage}</span>
          )}
        </div>
      </div>

      {/* Primary Tab Navigation */}
      <div className="flex border-b border-gray-700/60 mb-6 gap-2">
        <button
          onClick={() => setActiveTab('downloads')}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 transition duration-200 cursor-pointer ${
            activeTab === 'downloads'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          Active Queue & Downloads ({items.length})
        </button>
        <button
          onClick={() => setActiveTab('reclaim')}
          className={`pb-3 px-4 text-sm font-semibold border-b-2 flex items-center gap-2 transition duration-200 cursor-pointer ${
            activeTab === 'reclaim'
              ? 'border-purple-500 text-purple-400'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          }`}
        >
          <SparklesIcon className="w-4 h-4" />
          <span>Storage Reclaim</span>
          {(reclaimData?.totalReclaimableBytes ?? 0) > 0 && (
            <span className="rounded-full bg-purple-900/60 text-purple-300 px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ring-purple-500/40">
              {((reclaimData?.totalReclaimableBytes ?? 0) / (1024 * 1024 * 1024)).toFixed(1)} GB
            </span>
          )}
        </button>
      </div>

      {activeTab === 'downloads' && (
        <>
          {/* Controls: Search, Filter */}
          <div className="flex flex-col lg:flex-row gap-4 mb-6">
            {/* Search */}
            <div className="flex flex-grow relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-500">
                <MagnifyingGlassIcon className="w-5 h-5" />
              </span>
              <input
                type="text"
                placeholder="Search release file names..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700/50 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition duration-200"
              />
            </div>

            {/* Filter Status */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-xl bg-gray-900 border border-gray-700/50 p-1">
                {['all', 'downloading', 'stream', 'stalled', 'searching', 'processing', 'failed'].map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-semibold uppercase tracking-wider transition duration-200 ${
                      statusFilter === status
                        ? 'bg-indigo-600 text-white shadow-md'
                        : 'text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {status === 'all'
                      ? 'All'
                      : status === 'stream'
                      ? '⚡ Stream Latino'
                      : status === 'processing'
                      ? 'Importing'
                      : status === 'stalled'
                      ? 'Stalled (0 Seeds)'
                      : status}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Sort Bar */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider mr-1">Sort by:</span>
            {(['status', 'progress', 'title', 'eta', 'size'] as const).map((field) => (
              <button
                key={field}
                onClick={() => handleSort(field)}
                className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-semibold transition duration-200 border ${
                  sortField === field
                    ? 'bg-indigo-600/80 border-indigo-500 text-white'
                    : 'bg-gray-900 border-gray-700/50 text-gray-400 hover:text-white hover:border-gray-500'
                }`}
              >
                {field === 'eta' ? 'ETA' : field.charAt(0).toUpperCase() + field.slice(1)}
                {sortField === field && (
                  <span className="text-[10px]">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                )}
              </button>
            ))}
          </div>

          {/* Grid List */}
          {sortedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center bg-gray-800/10 border border-dashed border-gray-700/60 rounded-2xl p-12 text-center text-gray-400">
              <ArrowDownTrayIcon className="w-12 h-12 text-gray-500 mb-3" />
              <h3 className="text-lg font-bold text-gray-300 mb-1">No active downloads or searches found</h3>
              <p className="text-sm text-gray-500 max-w-sm">
                {searchFilter || statusFilter !== 'all'
                  ? 'Try modifying your search query or status filter criteria.'
                  : 'Requests that are currently downloading or searching indexers will show up here.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {sortedItems.map((item, idx) => (
                <DownloadCard key={`${item.tmdbId}-${item.status}-${idx}`} item={item} />
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'reclaim' && (
        <div>
          {/* Hero Banner */}
          <div className="mb-6 overflow-hidden rounded-2xl border border-purple-500/30 bg-gradient-to-r from-purple-950/60 via-indigo-950/40 to-gray-900/80 p-6 shadow-xl backdrop-blur-md">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/30">
                    <SparklesIcon className="h-5 w-5" />
                  </span>
                  <h2 className="text-xl font-bold text-white">
                    {((reclaimData?.totalReclaimableBytes ?? 0) / (1024 * 1024 * 1024)).toFixed(2)} GB Recoverable Space
                  </h2>
                </div>
                <p className="mt-1.5 max-w-2xl text-sm text-gray-300 leading-relaxed">
                  Found <span className="font-semibold text-white">{reclaimData?.items?.length ?? 0} titles</span> with watched content taking up local storage. Deleting watched files frees disk space while <span className="text-indigo-300 font-semibold">keeping series & remaining episodes monitored for auto-download</span>.
                </p>
              </div>

              {reclaimData && reclaimData.items.length > 0 && (
                <button
                  type="button"
                  disabled={isDeletingReclaim}
                  onClick={handleBatchDeleteReclaim}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition duration-200 hover:bg-red-500 disabled:opacity-50 cursor-pointer"
                >
                  <TrashIcon className="h-4 w-4" />
                  <span>Clean All Watched ({((reclaimData.totalReclaimableBytes) / (1024 * 1024 * 1024)).toFixed(1)} GB)</span>
                </button>
              )}
            </div>
          </div>

          {/* Empty State */}
          {!reclaimData || reclaimData.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-700/60 bg-gray-800/10 p-12 text-center text-gray-400">
              <CheckCircleIcon className="mb-3 h-12 w-12 text-green-400" />
              <h3 className="mb-1 text-lg font-bold text-gray-200">Storage is Clean!</h3>
              <p className="max-w-md text-sm text-gray-400">
                No watched media files are currently taking up disk space. As you watch movies and episodes on Jellyfin, they will appear here with one-click cleanup options.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {reclaimData.items.map((item) => {
                const isExpanded = expandedShowIds.includes(item.tmdbId);
                const itemGb = (item.reclaimableBytes / (1024 * 1024 * 1024)).toFixed(2);

                return (
                  <div
                    key={`${item.mediaType}-${item.tmdbId}`}
                    className="overflow-hidden rounded-2xl border border-gray-700/50 bg-gray-800/40 p-5 backdrop-blur-md transition duration-200 hover:border-gray-600/60"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      {/* Poster & Info */}
                      <div className="flex items-center gap-4">
                        {item.posterPath ? (
                          <div className="relative h-20 w-14 flex-shrink-0 overflow-hidden rounded-lg shadow ring-1 ring-gray-700">
                            <CachedImage
                              type="tmdb"
                              src={`https://image.tmdb.org/t/p/w600_and_h900_bestv2${item.posterPath}`}
                              alt={item.title}
                              fill
                              style={{ objectFit: 'cover' }}
                            />
                          </div>
                        ) : (
                          <div className="flex h-20 w-14 flex-shrink-0 items-center justify-center rounded-lg bg-gray-800 text-gray-500 ring-1 ring-gray-700">
                            🎬
                          </div>
                        )}

                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-bold text-white">
                              {item.title}
                              {item.releaseDate && (
                                <span className="ml-1.5 font-normal text-gray-400">
                                  ({item.releaseDate.slice(0, 4)})
                                </span>
                              )}
                            </h3>
                            <span className="rounded-full bg-gray-700/60 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider text-gray-300">
                              {item.mediaType === 'movie' ? 'Movie' : 'TV Series'}
                            </span>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 rounded-full bg-purple-900/60 px-2.5 py-0.5 text-xs font-semibold text-purple-300 ring-1 ring-inset ring-purple-500/40">
                              {itemGb} GB Recoverable
                            </span>

                            {item.mediaType === 'tv' && (
                              <>
                                <span className="inline-flex items-center gap-1 rounded-full bg-green-900/60 px-2.5 py-0.5 text-xs font-medium text-green-300 ring-1 ring-inset ring-green-500/40">
                                  ✓ {item.watchedEpisodesCount} Watched Episodes
                                </span>

                                {(item.remainingMonitoredCount ?? 0) > 0 && (
                                  <span
                                    className="inline-flex items-center gap-1 rounded-full bg-blue-900/60 px-2.5 py-0.5 text-xs font-medium text-blue-300 ring-1 ring-inset ring-blue-500/40"
                                    title="Sonarr is monitoring remaining and upcoming episodes to auto-download them"
                                  >
                                    ⚡ {item.remainingMonitoredCount} Monitored for Auto-Download
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex flex-wrap items-center gap-2">
                        {item.mediaType === 'tv' && (item.watchedEpisodes?.length ?? 0) > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedShowIds((prev) =>
                                prev.includes(item.tmdbId)
                                  ? prev.filter((id) => id !== item.tmdbId)
                                  : [...prev, item.tmdbId]
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-xl bg-gray-800 px-3.5 py-2 text-xs font-semibold text-gray-300 ring-1 ring-inset ring-gray-700 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                          >
                            <span>Episodes ({item.watchedEpisodes?.length})</span>
                            {isExpanded ? (
                              <ChevronUpIcon className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronDownIcon className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={isDeletingReclaim}
                          onClick={() =>
                            handleDeleteReclaimItem({
                              mediaType: item.mediaType,
                              tmdbId: item.tmdbId,
                              title: item.title,
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-xl bg-red-900/50 px-3.5 py-2 text-xs font-semibold text-red-300 ring-1 ring-inset ring-red-700/60 hover:bg-red-800/70 hover:text-white transition cursor-pointer disabled:opacity-50"
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                          <span>
                            {item.mediaType === 'tv'
                              ? `Delete Watched Files (${itemGb} GB)`
                              : `Delete Movie (${itemGb} GB)`}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Accordion: Watched Episode Breakdown for TV */}
                    {item.mediaType === 'tv' && isExpanded && item.watchedEpisodes && (
                      <div className="mt-4 border-t border-gray-700/60 pt-3">
                        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                          Watched Episode Files on Disk
                        </h4>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {item.watchedEpisodes.map((ep) => {
                            const epMb = (ep.size / (1024 * 1024)).toFixed(1);
                            return (
                              <div
                                key={`ep-${ep.seasonNumber}-${ep.episodeNumber}`}
                                className="flex items-center justify-between rounded-xl bg-gray-900/60 px-3 py-2 text-xs ring-1 ring-gray-800"
                              >
                                <div className="truncate mr-2">
                                  <span className="font-bold text-gray-200">
                                    S{ep.seasonNumber}E{ep.episodeNumber}
                                  </span>
                                  <span className="ml-1.5 text-gray-400 truncate">
                                    {ep.title || 'Episode'}
                                  </span>
                                  <span className="ml-1.5 text-gray-500 font-mono">
                                    ({epMb} MB)
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  disabled={isDeletingReclaim}
                                  onClick={() =>
                                    handleDeleteReclaimItem({
                                      mediaType: 'tv',
                                      tmdbId: item.tmdbId,
                                      seasonNumber: ep.seasonNumber,
                                      episodeNumber: ep.episodeNumber,
                                      title: item.title,
                                    })
                                  }
                                  className="flex-shrink-0 text-red-400 hover:text-red-300 transition p-1 hover:bg-red-950/60 rounded-lg cursor-pointer"
                                  title="Delete this episode file and keep remaining monitored"
                                >
                                  <TrashIcon className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default DownloadsPage;

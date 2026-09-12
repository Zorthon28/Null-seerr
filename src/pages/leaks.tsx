import Badge from '@app/components/Common/Badge';
import CachedImage from '@app/components/Common/CachedImage';
import Header from '@app/components/Common/Header';
import PageTitle from '@app/components/Common/PageTitle';
import useToasts from '@app/hooks/useToasts';
import axios from 'axios';
import useSWR from 'swr';
import type { NextPage } from 'next';
import { useState } from 'react';
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  CheckCircleIcon,
  ClockIcon,
  FireIcon,
  MagnifyingGlassIcon,
  PlusCircleIcon,
  RadioIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';

interface LeakAlert {
  id: string;
  title: string;
  mediaTitle: string;
  year?: number;
  leakType: 'workprint' | 'screener' | 'web-leak' | 'internal' | 'unconfirmed';
  confidence: 'high' | 'medium' | 'low';
  sourcePlatform: string;
  subreddit: string;
  redditUrl: string;
  description: string;
  detectedAt: string;
  matchedMedia?: {
    id: number;
    tmdbId: number;
    mediaType: 'movie' | 'tv';
    title: string;
    posterPath?: string;
    status: number;
  };
}

interface LeaksResponse {
  alerts: LeakAlert[];
  total: number;
  matchedCount: number;
}

const LeaksPage: NextPage = () => {
  const { addToast } = useToasts();
  const [isScanning, setIsScanning] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Ingest Modal state
  const [showIngestModal, setShowIngestModal] = useState(false);
  const [ingestTitle, setIngestTitle] = useState('');
  const [ingestYear, setIngestYear] = useState('');
  const [ingestUrl, setIngestUrl] = useState('');
  const [ingestTmdbId, setIngestTmdbId] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);

  const { data, mutate } = useSWR<LeaksResponse>('/api/v1/leaks', {
    refreshInterval: 15000,
  });

  const alerts = data?.alerts || [];

  const handleScan = async () => {
    setIsScanning(true);
    try {
      const res = await axios.post('/api/v1/leaks/scan');
      addToast(
        `Escaneo completado: ${res.data.newAlertsCount} nuevas filtraciones detectadas.`,
        { autoDismiss: true, appearance: 'success' }
      );
      mutate();
    } catch (e: any) {
      addToast(`Error al escanear: ${e.message}`, {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setIsScanning(false);
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      await axios.delete(`/api/v1/leaks/${id}`);
      mutate({
        ...data!,
        alerts: alerts.filter((a) => a.id !== id),
        total: (data?.total || 1) - 1,
      });
      addToast('Alerta descartada.', { autoDismiss: true, appearance: 'info' });
    } catch (e: any) {
      addToast(`Error al descartar: ${e.message}`, {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  const openIngest = (prefill?: { title: string; tmdbId?: number }) => {
    if (prefill) {
      setIngestTitle(prefill.title);
      setIngestTmdbId(prefill.tmdbId ? String(prefill.tmdbId) : '');
    } else {
      setIngestTitle('');
      setIngestTmdbId('');
    }
    setIngestYear('');
    setIngestUrl('');
    setShowIngestModal(true);
  };

  const submitIngest = async () => {
    if (!ingestTitle.trim() || !ingestUrl.trim()) {
      addToast('El título y la URL de descarga son obligatorios.', {
        autoDismiss: true,
        appearance: 'warning',
      });
      return;
    }

    setIsIngesting(true);
    try {
      const res = await axios.post('/api/v1/leaks/ingest', {
        title: ingestTitle.trim(),
        year: ingestYear ? Number(ingestYear) : undefined,
        tmdbId: ingestTmdbId ? Number(ingestTmdbId) : undefined,
        downloadUrl: ingestUrl.trim(),
      });

      if (res.data.success) {
        addToast(res.data.message, { autoDismiss: true, appearance: 'success' });
        setShowIngestModal(false);
      } else {
        addToast(res.data.message, { autoDismiss: true, appearance: 'error' });
      }
    } catch (e: any) {
      addToast(`Error al procesar: ${e.message}`, {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setIsIngesting(false);
    }
  };

  const filteredAlerts = alerts.filter((a) => {
    if (filterType === 'matched' && !a.matchedMedia) return false;
    if (filterType === 'workprint' && a.leakType !== 'workprint') return false;
    if (filterType === 'screener' && a.leakType !== 'screener') return false;
    if (filterType === 'web-leak' && a.leakType !== 'web-leak') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        a.mediaTitle.toLowerCase().includes(q) ||
        a.title.toLowerCase().includes(q) ||
        a.sourcePlatform.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <>
      <PageTitle title="Radar de Filtraciones" />
      <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <Header>
            <span className="flex items-center gap-2">
              <RadioIcon className="h-7 w-7 text-red-500 animate-pulse" />
              Radar de Filtraciones & Leaks
            </span>
          </Header>
          <p className="text-sm text-gray-400">
            Monitoreo proactivo de la red (Reddit r/Piracy, r/AnimePiracy, Scene) para detectar workprints, filtraciones de estudio y prelanzamientos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openIngest()}
            className="flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 shadow-md transition"
          >
            <PlusCircleIcon className="h-5 w-5" />
            Ingestar Enlace / DDL
          </button>
          <button
            onClick={handleScan}
            disabled={isScanning}
            className="flex items-center gap-2 rounded-md bg-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:bg-gray-600 disabled:opacity-50 transition"
          >
            <ArrowPathIcon className={`h-5 w-5 ${isScanning ? 'animate-spin' : ''}`} />
            {isScanning ? 'Escaneando...' : 'Escanear Ahora'}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
        <div className="rounded-lg bg-gray-800/80 p-4 border border-gray-700 shadow">
          <div className="text-xs uppercase font-semibold text-gray-400">Filtraciones Detectadas</div>
          <div className="mt-1 text-2xl font-bold text-white">{alerts.length}</div>
          <div className="text-xs text-gray-400 mt-1">Activas en feeds comunitarios</div>
        </div>
        <div className="rounded-lg bg-gray-800/80 p-4 border border-gray-700 shadow">
          <div className="text-xs uppercase font-semibold text-red-400">Coincidencias en tu Servidor</div>
          <div className="mt-1 text-2xl font-bold text-red-400">
            {alerts.filter((a) => Boolean(a.matchedMedia)).length}
          </div>
          <div className="text-xs text-gray-400 mt-1">Películas o series que tienes pedidas</div>
        </div>
        <div className="rounded-lg bg-gray-800/80 p-4 border border-gray-700 shadow">
          <div className="text-xs uppercase font-semibold text-indigo-400">Protección Servarr</div>
          <div className="mt-1 text-sm font-medium text-emerald-400 flex items-center gap-1.5 mt-2">
            <CheckCircleIcon className="h-5 w-5" />
            Anti-CAM (-10k) Activo
          </div>
          <div className="text-xs text-gray-400 mt-1">Radarr y Sonarr filtran cams falsos</div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: 'all', label: 'Todas' },
            { id: 'matched', label: 'En mi Biblioteca / Solicitadas' },
            { id: 'workprint', label: 'Workprints' },
            { id: 'screener', label: 'Screeners' },
            { id: 'web-leak', label: 'Web Leaks' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setFilterType(f.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                filterType === f.id
                  ? 'bg-red-600 text-white shadow'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar en radar..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-900 py-1.5 pl-9 pr-3 text-sm text-white placeholder-gray-500 focus:border-red-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Leak Cards */}
      {filteredAlerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-700 py-12 text-center">
          <RadioIcon className="h-12 w-12 text-gray-600" />
          <h3 className="mt-3 text-base font-semibold text-gray-300">
            No hay alertas en este filtro
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Haz clic en "Escanear Ahora" para buscar nuevas menciones en los foros.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredAlerts.map((alert) => (
            <div
              key={alert.id}
              className={`relative flex flex-col justify-between rounded-lg border p-4 shadow-lg transition hover:border-gray-600 ${
                alert.matchedMedia
                  ? 'border-red-500/50 bg-gray-800/90'
                  : 'border-gray-700/80 bg-gray-800/60'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {alert.matchedMedia?.posterPath ? (
                      <div className="h-16 w-11 flex-shrink-0 overflow-hidden rounded border border-gray-700">
                        <CachedImage
                          type="tmdb"
                          src={`https://image.tmdb.org/t/p/w185_and_h278_bestv2${alert.matchedMedia.posterPath}`}
                          alt={alert.mediaTitle}
                          width={44}
                          height={64}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-md bg-red-950/40 text-red-400 border border-red-800/40">
                        <FireIcon className="h-6 w-6" />
                      </div>
                    )}
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold text-white text-base">
                          {alert.mediaTitle}
                        </span>
                        {alert.matchedMedia && (
                          <Badge badgeType="danger">Monitoreado en Null-seerr</Badge>
                        )}
                        <Badge
                          badgeType={
                            alert.leakType === 'workprint'
                              ? 'warning'
                              : alert.leakType === 'screener'
                              ? 'primary'
                              : 'default'
                          }
                        >
                          {alert.leakType.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-gray-400 flex items-center gap-2">
                        <span className="text-gray-300 font-medium">
                          Fuente: {alert.sourcePlatform}
                        </span>
                        <span>•</span>
                        <span>r/{alert.subreddit}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <ClockIcon className="h-3 w-3" />
                          {new Date(alert.detectedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDismiss(alert.id)}
                    title="Descartar alerta"
                    className="text-gray-500 hover:text-gray-300 transition p-1"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>

                <p className="mt-3 text-xs text-gray-300 line-clamp-3 bg-gray-900/60 p-2.5 rounded border border-gray-800 font-mono">
                  {alert.title}
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between pt-3 border-t border-gray-700/60">
                <a
                  href={alert.redditUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                >
                  <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                  Ver hilo en Reddit
                </a>
                <button
                  onClick={() =>
                    openIngest({
                      title: alert.mediaTitle,
                      tmdbId: alert.matchedMedia?.tmdbId,
                    })
                  }
                  className="flex items-center gap-1.5 rounded bg-red-600/90 hover:bg-red-600 px-3 py-1 text-xs font-medium text-white transition shadow"
                >
                  <PlusCircleIcon className="h-4 w-4" />
                  Ingestar Descarga
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Ingest Modal */}
      {showIngestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl bg-gray-800 p-6 shadow-2xl border border-gray-700">
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <PlusCircleIcon className="h-6 w-6 text-red-500" />
              Ingestar Filtración o Descarga Directa (DDL)
            </h3>
            <p className="mt-1 text-xs text-gray-400">
              Pega un enlace de descarga directa (MP4, MKV, stream) o un enlace Magnet. Null-seerr lo descargará directamente al almacenamiento del servidor.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-300">
                  Título de la Película o Serie *
                </label>
                <input
                  type="text"
                  value={ingestTitle}
                  onChange={(e) => setIngestTitle(e.target.value)}
                  placeholder="Ej: Avatar The Last Airbender"
                  className="mt-1 w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-red-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-300">
                    Año (Opcional)
                  </label>
                  <input
                    type="number"
                    value={ingestYear}
                    onChange={(e) => setIngestYear(e.target.value)}
                    placeholder="2026"
                    className="mt-1 w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-red-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300">
                    TMDB ID (Opcional)
                  </label>
                  <input
                    type="number"
                    value={ingestTmdbId}
                    onChange={(e) => setIngestTmdbId(e.target.value)}
                    placeholder="Ej: 969681"
                    className="mt-1 w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-red-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300">
                  URL de Descarga Directa o Magnet *
                </label>
                <textarea
                  rows={3}
                  value={ingestUrl}
                  onChange={(e) => setIngestUrl(e.target.value)}
                  placeholder="https://... o magnet:?xt=urn:btih:..."
                  className="mt-1 w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-mono text-white placeholder-gray-500 focus:border-red-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowIngestModal(false)}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={submitIngest}
                disabled={isIngesting}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50 transition shadow"
              >
                {isIngesting ? 'Iniciando...' : 'Comenzar Ingesta'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default LeaksPage;

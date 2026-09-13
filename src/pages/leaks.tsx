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
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  BellAlertIcon,
  BoltIcon,
  CheckCircleIcon,
  ClockIcon,
  EyeIcon,
  FireIcon,
  MagnifyingGlassIcon,
  PlusCircleIcon,
  RadioIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
  SpeakerWaveIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

interface LeakMediaInspection {
  watermark: { detected: boolean; label?: string };
  hardcodedSubs: { detected: boolean; label?: string };
  audioProfile: { isOriginal: boolean; type: string; language?: string };
  qualityGrade: 'A' | 'B' | 'C' | 'D';
  cleanVideo: boolean;
  flags: string[];
}

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
  downloadUrl?: string;
  description: string;
  detectedAt: string;
  autoDownloaded?: boolean;
  inspection?: LeakMediaInspection;
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
  settings?: {
    autoDownloadLibraryLeaks: boolean;
    minQualityGrade: string;
    notifyOnDiscord: boolean;
    notifyOnTelegram: boolean;
  };
}

const LeaksPage: NextPage = () => {
  const { addToast } = useToasts();
  const [isScanning, setIsScanning] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Live On-Demand Search state
  const [liveQuery, setLiveQuery] = useState('');
  const [isSearchingLive, setIsSearchingLive] = useState(false);
  const [liveResults, setLiveResults] = useState<{
    query: string;
    sceneResults: any[];
    prowlarrResults: any[];
    redditResults: any[];
  } | null>(null);

  // Ingest Modal state
  const [showIngestModal, setShowIngestModal] = useState(false);
  const [ingestTitle, setIngestTitle] = useState('');
  const [ingestYear, setIngestYear] = useState('');
  const [ingestUrl, setIngestUrl] = useState('');
  const [ingestTmdbId, setIngestTmdbId] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [grabbingId, setGrabbingId] = useState<string | null>(null);

  const { data, mutate } = useSWR<LeaksResponse>('/api/v1/leaks', {
    refreshInterval: 15000,
  });

  const alerts = data?.alerts || [];
  const autoDownloadEnabled = data?.settings?.autoDownloadLibraryLeaks || false;

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

  const handleToggleAutoDownload = async () => {
    try {
      const nextVal = !autoDownloadEnabled;
      await axios.post('/api/v1/leaks/settings', {
        autoDownloadLibraryLeaks: nextVal,
      });
      mutate();
      addToast(
        nextVal
          ? '🤖 Auto-descarga activada: Las filtraciones de tus películas se descargarán automáticamente.'
          : 'Auto-descarga desactivada.',
        { autoDismiss: true, appearance: nextVal ? 'success' : 'info' }
      );
    } catch (e: any) {
      addToast(`Error al cambiar ajuste: ${e.message}`, {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  const handleTestNotification = async () => {
    try {
      const res = await axios.post('/api/v1/leaks/test-notification');
      if (res.data.discordSent || res.data.telegramSent) {
        addToast('Notificación de prueba enviada exitosamente.', {
          autoDismiss: true,
          appearance: 'success',
        });
      } else {
        addToast(
          'Aviso: Discord o Telegram no están habilitados en tus Ajustes de Notificaciones de Null-seerr.',
          { autoDismiss: true, appearance: 'warning' }
        );
      }
    } catch (e: any) {
      addToast(`Error al enviar notificación: ${e.message}`, {
        autoDismiss: true,
        appearance: 'error',
      });
    }
  };

  const handleLiveSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!liveQuery.trim()) return;
    setIsSearchingLive(true);
    try {
      const res = await axios.get(
        `/api/v1/leaks/search?query=${encodeURIComponent(liveQuery.trim())}`
      );
      setLiveResults(res.data);
    } catch (e: any) {
      addToast(`Error al buscar en vivo: ${e.message}`, {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setIsSearchingLive(false);
    }
  };

  const handle1ClickGrab = async (alertId: string) => {
    setGrabbingId(alertId);
    try {
      const res = await axios.post(`/api/v1/leaks/${alertId}/grab`);
      if (res.data.success) {
        addToast(res.data.message || 'Descarga iniciada exitosamente.', {
          autoDismiss: true,
          appearance: 'success',
        });
        mutate();
      } else {
        addToast(res.data.message || 'No se pudo iniciar la descarga.', {
          autoDismiss: true,
          appearance: 'warning',
        });
      }
    } catch (e: any) {
      addToast(`Error al procesar descarga: ${e.message}`, {
        autoDismiss: true,
        appearance: 'error',
      });
    } finally {
      setGrabbingId(null);
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

  const openIngest = (prefill?: { title: string; tmdbId?: number; downloadUrl?: string }) => {
    if (prefill) {
      setIngestTitle(prefill.title);
      setIngestTmdbId(prefill.tmdbId ? String(prefill.tmdbId) : '');
      setIngestUrl(prefill.downloadUrl || '');
    } else {
      setIngestTitle('');
      setIngestYear('');
      setIngestUrl('');
      setIngestTmdbId('');
    }
    setShowIngestModal(true);
  };

  const handleIngestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
    if (filterType === 'clean' && !a.inspection?.cleanVideo) return false;

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
          <p className="mt-1 text-sm text-gray-400">
            Monitoreo en tiempo real de copias de estudio (Workprints, Screeners, Leaks) y PreDB de The Scene.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={handleToggleAutoDownload}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold shadow transition ${
              autoDownloadEnabled
                ? 'border-emerald-500/50 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/50'
                : 'border-gray-700 bg-gray-800 text-gray-400 hover:text-white'
            }`}
            title="Descarga automáticamente filtraciones de grado A/B para películas que tienes pedidas en Null-seerr"
          >
            <BoltIcon className={`h-4 w-4 ${autoDownloadEnabled ? 'text-emerald-400' : 'text-gray-500'}`} />
            Auto-Descarga: {autoDownloadEnabled ? 'Activada' : 'Desactivada'}
          </button>

          <button
            onClick={handleTestNotification}
            className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs font-medium text-gray-300 transition hover:bg-gray-700 hover:text-white shadow"
            title="Enviar alerta de prueba a Discord o Telegram"
          >
            <BellAlertIcon className="h-4 w-4 text-amber-400" />
            Probar Notificación
          </button>

          <button
            onClick={() => openIngest()}
            className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs font-medium text-gray-200 transition hover:bg-gray-700 hover:text-white shadow"
          >
            <PlusCircleIcon className="h-4 w-4 text-indigo-400" />
            Ingestar Enlace / DDL
          </button>

          <button
            onClick={handleScan}
            disabled={isScanning}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg transition hover:bg-red-500 disabled:opacity-50"
          >
            <ArrowPathIcon
              className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`}
            />
            {isScanning ? 'Escaneando...' : 'Escanear Ahora'}
          </button>
        </div>
      </div>

      {/* Feature 6: LIVE ON-DEMAND LEAK SEARCH BAR */}
      <div className="mb-6 rounded-xl border border-indigo-500/30 bg-gradient-to-r from-gray-900 via-indigo-950/20 to-gray-900 p-4 shadow-xl">
        <form onSubmit={handleLiveSearch} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-5 w-5 text-indigo-400" />
            <input
              type="text"
              value={liveQuery}
              onChange={(e) => setLiveQuery(e.target.value)}
              placeholder="Buscar filtración en vivo bajo demanda (ej. Spider-Man, Avatar Aang, Avengers)..."
              className="w-full rounded-lg border border-indigo-500/40 bg-gray-900/80 py-2 pl-10 pr-4 text-sm text-white placeholder-gray-400 backdrop-blur focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={isSearchingLive}
            className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 text-xs font-bold text-white shadow transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {isSearchingLive ? (
              <>
                <ArrowPathIcon className="h-4 w-4 animate-spin" />
                Consultando Red...
              </>
            ) : (
              <>
                <MagnifyingGlassIcon className="h-4 w-4" />
                Buscar en Vivo
              </>
            )}
          </button>
        </form>

        {/* Live Search Results Container */}
        {liveResults && (
          <div className="mt-4 border-t border-indigo-900/60 pt-3 text-xs">
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold text-indigo-300 text-sm">
                Resultados en vivo para "{liveResults.query}":
              </span>
              <button
                onClick={() => setLiveResults(null)}
                className="text-gray-400 hover:text-white transition flex items-center gap-1"
              >
                <XMarkIcon className="h-4 w-4" /> Cerrar
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Scene PreDB */}
              <div className="rounded-lg bg-gray-900/80 p-3 border border-gray-800">
                <span className="font-bold text-emerald-400 flex items-center gap-1 mb-2">
                  <ShieldCheckIcon className="h-4 w-4" /> The Scene (PreDB) ({liveResults.sceneResults.length})
                </span>
                {liveResults.sceneResults.length === 0 ? (
                  <p className="text-gray-500 text-xs">No hay registros oficiales de la Scene.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {liveResults.sceneResults.map((r, i) => (
                      <div key={i} className="p-2 rounded bg-gray-800/80 border border-gray-700/60">
                        <div className="font-mono text-gray-200 break-all">{r.release}</div>
                        <div className="mt-1 flex items-center justify-between text-gray-400">
                          <span>{r.date ? new Date(r.date).toLocaleDateString() : 'N/A'}</span>
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-400 hover:underline"
                          >
                            Ver en srrdb
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Prowlarr Swarm */}
              <div className="rounded-lg bg-gray-900/80 p-3 border border-gray-800">
                <span className="font-bold text-indigo-400 flex items-center gap-1 mb-2">
                  <ArrowDownTrayIcon className="h-4 w-4" /> Trackers Prowlarr ({liveResults.prowlarrResults.length})
                </span>
                {liveResults.prowlarrResults.length === 0 ? (
                  <p className="text-gray-500 text-xs">No hay torrents activos en tus indexadores.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {liveResults.prowlarrResults.map((r, i) => (
                      <div key={i} className="p-2 rounded bg-gray-800/80 border border-gray-700/60">
                        <div className="font-medium text-white line-clamp-1">{r.title}</div>
                        <div className="mt-1 flex items-center justify-between text-gray-400">
                          <span>{r.indexer} • {r.seeders ?? 0} seeds</span>
                          {r.downloadUrl && (
                            <button
                              onClick={() => openIngest({ title: r.title, downloadUrl: r.downloadUrl })}
                              className="text-red-400 hover:text-red-300 font-semibold"
                            >
                              Descargar
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Reddit Community */}
              <div className="rounded-lg bg-gray-900/80 p-3 border border-gray-800">
                <span className="font-bold text-amber-400 flex items-center gap-1 mb-2">
                  <EyeIcon className="h-4 w-4" /> Comunidad Reddit ({liveResults.redditResults.length})
                </span>
                {liveResults.redditResults.length === 0 ? (
                  <p className="text-gray-500 text-xs">No se encontraron hilos de debate recientes.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {liveResults.redditResults.map((r, i) => (
                      <div key={i} className="p-2 rounded bg-gray-800/80 border border-gray-700/60">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium text-gray-200 line-clamp-2 hover:text-amber-300"
                        >
                          {r.title}
                        </a>
                        <div className="mt-1 text-gray-400 flex justify-between">
                          <span>r/{r.subreddit}</span>
                          <span>{r.comments} comentarios</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Metrics Row */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-gray-700/80 bg-gray-800/70 p-4 shadow-lg backdrop-blur">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            Total Alertas Activas
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-white">{alerts.length}</span>
            <span className="text-xs text-red-400">Año en curso (2026+)</span>
          </div>
        </div>

        <div className="rounded-xl border border-gray-700/80 bg-gray-800/70 p-4 shadow-lg backdrop-blur">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            En tu Biblioteca
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-red-400">
              {alerts.filter((a) => Boolean(a.matchedMedia)).length}
            </span>
            <span className="text-xs text-gray-400">Títulos monitoreados</span>
          </div>
        </div>

        <div className="rounded-xl border border-gray-700/80 bg-gray-800/70 p-4 shadow-lg backdrop-blur">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            Workprints de Estudio
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-amber-400">
              {alerts.filter((a) => a.leakType === 'workprint').length}
            </span>
            <span className="text-xs text-gray-400">Copias internas</span>
          </div>
        </div>

        <div className="rounded-xl border border-gray-700/80 bg-gray-800/70 p-4 shadow-lg backdrop-blur">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            Screeners Oficiales
          </span>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-blue-400">
              {alerts.filter((a) => a.leakType === 'screener').length}
            </span>
            <span className="text-xs text-gray-400">Para votantes / prensa</span>
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: 'all', label: 'Todas' },
            { id: 'matched', label: 'Solo en mi Biblioteca' },
            { id: 'clean', label: 'Límpias (Sin 1XBET)' },
            { id: 'workprint', label: 'Workprints' },
            { id: 'screener', label: 'Screeners' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                filterType === tab.id
                  ? 'bg-red-600 text-white shadow-md'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <MagnifyingGlassIcon className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrar alertas..."
            className="w-full rounded-lg border border-gray-700 bg-gray-800 py-1.5 pl-9 pr-3 text-xs text-white placeholder-gray-400 focus:border-red-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Alerts List */}
      {filteredAlerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-700 p-12 text-center">
          <RadioIcon className="h-12 w-12 text-gray-600 mb-3" />
          <h3 className="text-base font-semibold text-gray-300">
            No hay alertas de filtraciones activas
          </h3>
          <p className="mt-1 text-xs text-gray-500 max-w-md">
            El radar está analizando continuamente los enjambres de Prowlarr, The Scene PreDB y comunidades en busca de copias de este año.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filteredAlerts.map((alert) => (
            <div
              key={alert.id}
              className={`flex flex-col justify-between rounded-xl border p-4.5 shadow-lg transition duration-200 ${
                alert.matchedMedia
                  ? 'border-red-500/50 bg-gradient-to-br from-gray-800/95 via-gray-800/90 to-red-950/20'
                  : 'border-gray-700/70 bg-gray-800/60 hover:border-gray-600'
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {alert.matchedMedia?.posterPath ? (
                      <div className="h-16 w-11 flex-shrink-0 overflow-hidden rounded shadow">
                        <CachedImage
                          type="tmdb"
                          src={`https://image.tmdb.org/t/p/w154${alert.matchedMedia.posterPath}`}
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
                        {alert.autoDownloaded && (
                          <Badge badgeType="success">Auto-Descargado</Badge>
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

                      {/* SMART INSPECTION BADGES */}
                      {alert.inspection && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {/* Quality Grade */}
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold uppercase ${
                              alert.inspection.qualityGrade === 'A'
                                ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/40'
                                : alert.inspection.qualityGrade === 'B'
                                ? 'bg-blue-950/80 text-blue-300 border border-blue-500/40'
                                : alert.inspection.qualityGrade === 'C'
                                ? 'bg-amber-950/80 text-amber-300 border border-amber-500/40'
                                : 'bg-red-950/80 text-red-400 border border-red-500/40'
                            }`}
                          >
                            Grado {alert.inspection.qualityGrade}
                          </span>

                          {/* Video Cleanliness */}
                          {alert.inspection.cleanVideo ? (
                            <span className="rounded bg-emerald-950/60 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                              <ShieldCheckIcon className="h-3 w-3" /> Limpio (Sin 1XBET)
                            </span>
                          ) : (
                            <span className="rounded bg-red-950/60 px-1.5 py-0.5 text-[10px] font-medium text-red-300 border border-red-500/30 flex items-center gap-1">
                              <ShieldExclamationIcon className="h-3 w-3" /> {alert.inspection.watermark.label || 'Marca de Agua'}
                            </span>
                          )}

                          {/* Audio Profile */}
                          <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-medium text-gray-300 border border-gray-700 flex items-center gap-1">
                            <SpeakerWaveIcon className="h-3 w-3 text-indigo-400" />
                            {alert.inspection.audioProfile.isOriginal ? 'Audio Original' : 'Audio Line/Mic'}
                          </span>

                          {/* Hardcoded Subs */}
                          {alert.inspection.hardcodedSubs.detected && (
                            <span className="rounded bg-amber-950/60 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-500/30">
                              Subtítulos Pegados
                            </span>
                          )}
                        </div>
                      )}

                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                        <span className="font-medium text-gray-300">
                          Fuente: {alert.sourcePlatform}
                        </span>
                        {alert.subreddit && (
                          <>
                            <span>•</span>
                            <span>
                              {alert.sourcePlatform.toLowerCase().includes('reddit')
                                ? `r/${alert.subreddit}`
                                : alert.subreddit}
                            </span>
                          </>
                        )}
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

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-gray-700/60">
                <a
                  href={alert.redditUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-xs font-medium text-indigo-400 transition hover:text-indigo-300"
                >
                  <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                  {alert.sourcePlatform.toLowerCase().includes('scene') ||
                  alert.redditUrl.includes('srrdb')
                    ? 'Ver en PreDB (srrdb)'
                    : alert.sourcePlatform.toLowerCase().includes('reddit') ||
                      alert.redditUrl.includes('reddit')
                    ? 'Ver debate en Reddit'
                    : alert.sourcePlatform.toLowerCase().includes('torrent') ||
                      alert.sourcePlatform.toLowerCase().includes('tracker')
                    ? 'Ver en Tracker'
                    : 'Ver Fuente'}
                </a>

                <div className="flex items-center gap-2">
                  {/* 1-Click Grab Button */}
                  <button
                    onClick={() => handle1ClickGrab(alert.id)}
                    disabled={grabbingId === alert.id}
                    className="flex items-center gap-1.5 rounded bg-emerald-600/90 hover:bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition shadow disabled:opacity-50"
                    title="Descargar directamente a qBittorrent en 1 clic"
                  >
                    {grabbingId === alert.id ? (
                      <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <BoltIcon className="h-3.5 w-3.5" />
                    )}
                    Descarga Rápida
                  </button>

                  <button
                    onClick={() =>
                      openIngest({
                        title: alert.mediaTitle,
                        tmdbId: alert.matchedMedia?.tmdbId,
                        downloadUrl: alert.downloadUrl,
                      })
                    }
                    className="flex items-center gap-1.5 rounded bg-red-600/90 hover:bg-red-600 px-3 py-1 text-xs font-medium text-white transition shadow"
                  >
                    <PlusCircleIcon className="h-3.5 w-3.5" />
                    Ingestar Enlace
                  </button>
                </div>
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

            <form onSubmit={handleIngestSubmit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-300">
                  Título de la Película o Serie *
                </label>
                <input
                  type="text"
                  value={ingestTitle}
                  onChange={(e) => setIngestTitle(e.target.value)}
                  placeholder="Ej: Spider-Man Brand New Day"
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

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowIngestModal(false)}
                  className="rounded-lg border border-gray-700 bg-gray-700/50 px-4 py-2 text-xs font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isIngesting}
                  className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 transition disabled:opacity-50 shadow"
                >
                  {isIngesting ? (
                    <>
                      <ArrowPathIcon className="h-4 w-4 animate-spin" />
                      Procesando...
                    </>
                  ) : (
                    <>
                      <CheckCircleIcon className="h-4 w-4" />
                      Iniciar Ingesta
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default LeaksPage;

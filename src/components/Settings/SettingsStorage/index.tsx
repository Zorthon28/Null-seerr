import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageTitle from '@app/components/Common/PageTitle';
import StorageCleanupModal from '@app/components/Storage/StorageCleanupModal';
import useToasts from '@app/hooks/useToasts';
import { formatBytes } from '@app/utils/numberHelpers';
import {
  ArchiveBoxIcon,
  CircleStackIcon,
  ExclamationTriangleIcon,
  FilmIcon,
  ServerIcon,
  SparklesIcon,
  TvIcon,
} from '@heroicons/react/24/outline';
import type { StorageStatusResponse } from '@server/lib/storageTracker';
import axios from 'axios';
import React, { useEffect, useState } from 'react';
import useSWR from 'swr';

const SettingsStorage: React.FC = () => {
  const { addToast } = useToasts();
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const {
    data: status,
    error,
    mutate: revalidateStorage,
  } = useSWR<StorageStatusResponse>('/api/v1/storage/status', {
    revalidateOnMount: true,
    revalidateOnFocus: true,
  });

  // Settings form local state
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [thresholdGb, setThresholdGb] = useState(80);
  const [thresholdPercent, setThresholdPercent] = useState(10);

  useEffect(() => {
    if (status) {
      setAlertEnabled(status.alertEnabled ?? true);
      setThresholdGb(status.alertThresholdGb ?? 80);
      setThresholdPercent(status.alertThresholdPercent ?? 10);
    }
  }, [status]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await axios.post('/api/v1/storage/settings', {
        lowStorageAlertEnabled: alertEnabled,
        lowStorageThresholdGb: Number(thresholdGb),
        lowStorageThresholdPercent: Number(thresholdPercent),
      });

      addToast('Configuración de almacenamiento guardada exitosamente.', {
        appearance: 'success',
        autoDismiss: true,
      });
      await revalidateStorage();
    } catch (err: any) {
      addToast(
        err?.response?.data?.message ||
          'Error al guardar la configuración de almacenamiento.',
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!status && !error) {
    return <LoadingSpinner />;
  }

  const primaryDisk = status?.primaryDisk || status?.disks[0];
  const totalBytes = primaryDisk?.totalBytes || 1;
  const usedBytes = primaryDisk?.usedBytes || 0;
  const freeBytes = primaryDisk?.freeBytes || 0;
  const usedPercent = primaryDisk?.usedPercent || 0;
  const freePercent = primaryDisk?.freePercent || 0;

  const breakdown = status?.breakdown || {
    moviesBytes: 0,
    tvBytes: 0,
    otherBytes: 0,
    totalMediaBytes: 0,
  };

  const moviesPercent = Math.min(
    100,
    (breakdown.moviesBytes / totalBytes) * 100
  );
  const tvPercent = Math.min(100, (breakdown.tvBytes / totalBytes) * 100);
  const otherPercent = Math.min(100, (breakdown.otherBytes / totalBytes) * 100);

  // Status color badge
  const isCritical = status?.isLowStorage;

  return (
    <>
      <PageTitle title={['Almacenamiento', 'Configuración']} />

      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-white">
            <CircleStackIcon className="h-7 w-7 text-indigo-400" />
            <span>Monitor de Almacenamiento</span>
          </h2>
          <p className="mt-1 text-sm text-gray-400">
            Supervisa la ocupación en disco, la distribución de medios
            descargados y gestiona limpiezas para evitar quedarte sin espacio.
          </p>
        </div>

        <button
          onClick={() => setShowCleanupModal(true)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-indigo-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:from-indigo-500 hover:to-indigo-400 focus:outline-none"
        >
          <SparklesIcon className="h-5 w-5 text-indigo-200" />
          <span>Liberar Espacio Ahora</span>
        </button>
      </div>

      {/* Main Grid: Storage overview and breakdown */}
      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Drive Usage Card */}
        <div className="rounded-2xl border border-gray-700/80 bg-gray-800/60 p-6 shadow-md backdrop-blur-sm lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ServerIcon className="h-5 w-5 text-indigo-400" />
              <h3 className="text-base font-semibold text-white">
                Disco de Medios ({primaryDisk?.path || '/data/media'})
              </h3>
            </div>
            {isCritical ? (
              <span className="flex items-center gap-1 rounded-full border border-red-500/30 bg-red-500/20 px-2.5 py-0.5 text-xs font-semibold text-red-300">
                <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                Espacio Crítico
              </span>
            ) : (
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
                Saludable
              </span>
            )}
          </div>

          {/* Primary progress bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-gray-400">
              <span>
                Usado: {formatBytes(usedBytes)} ({usedPercent}%)
              </span>
              <span>
                Libre: {formatBytes(freeBytes)} ({freePercent}%)
              </span>
            </div>

            <div className="flex h-4 w-full overflow-hidden rounded-full bg-gray-700/80 p-0.5">
              <div
                style={{ width: `${Math.min(100, usedPercent)}%` }}
                className={`h-full rounded-full transition-all duration-500 ${
                  isCritical
                    ? 'bg-gradient-to-r from-amber-500 to-red-500'
                    : 'bg-gradient-to-r from-indigo-500 to-emerald-500'
                }`}
              />
            </div>

            <div className="flex items-center justify-between pt-1 text-xs text-gray-400">
              <span>
                Capacidad total:{' '}
                <strong className="text-gray-200">
                  {formatBytes(totalBytes)}
                </strong>
              </span>
              <span>{primaryDisk?.freePercent}% disponible</span>
            </div>
          </div>

          {/* Detailed metrics grid */}
          <div className="mt-6 grid grid-cols-3 gap-4 border-t border-gray-700/60 pt-4 text-center">
            <div>
              <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
                Capacidad
              </span>
              <p className="mt-1 text-base font-bold text-white">
                {formatBytes(totalBytes)}
              </p>
            </div>
            <div>
              <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
                Ocupado
              </span>
              <p className="mt-1 text-base font-bold text-indigo-300">
                {formatBytes(usedBytes)}
              </p>
            </div>
            <div>
              <span className="text-[11px] font-medium uppercase tracking-wider text-gray-400">
                Disponible
              </span>
              <p
                className={`mt-1 text-base font-bold ${
                  isCritical ? 'text-red-400' : 'text-emerald-400'
                }`}
              >
                {formatBytes(freeBytes)}
              </p>
            </div>
          </div>
        </div>

        {/* Media Distribution Breakdown */}
        <div className="flex flex-col justify-between rounded-2xl border border-gray-700/80 bg-gray-800/60 p-6 shadow-md backdrop-blur-sm">
          <div>
            <div className="mb-4 flex items-center gap-2">
              <ArchiveBoxIcon className="h-5 w-5 text-indigo-400" />
              <h3 className="text-base font-semibold text-white">
                Distribución de Medios
              </h3>
            </div>

            {/* Stacked mini bar */}
            <div className="mb-5 flex h-3 w-full overflow-hidden rounded-full bg-gray-700">
              <div
                title={`Películas: ${formatBytes(breakdown.moviesBytes)}`}
                style={{ width: `${moviesPercent}%` }}
                className="bg-blue-500"
              />
              <div
                title={`Series: ${formatBytes(breakdown.tvBytes)}`}
                style={{ width: `${tvPercent}%` }}
                className="bg-purple-500"
              />
              <div
                title={`Otros: ${formatBytes(breakdown.otherBytes)}`}
                style={{ width: `${otherPercent}%` }}
                className="bg-gray-500"
              />
            </div>

            {/* Items breakdown list */}
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-blue-500" />
                  <FilmIcon className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-300">Películas (Radarr)</span>
                </div>
                <span className="font-semibold text-white">
                  {formatBytes(breakdown.moviesBytes)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-purple-500" />
                  <TvIcon className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-300">Series TV (Sonarr)</span>
                </div>
                <span className="font-semibold text-white">
                  {formatBytes(breakdown.tvBytes)}
                </span>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-gray-500" />
                  <span className="text-gray-300">Otros / Sistema</span>
                </div>
                <span className="font-semibold text-white">
                  {formatBytes(breakdown.otherBytes)}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-between border-t border-gray-700/60 pt-3 text-xs text-gray-400">
            <span>Total Medios Gestionados:</span>
            <span className="font-bold text-gray-200">
              {formatBytes(breakdown.totalMediaBytes)}
            </span>
          </div>
        </div>
      </div>

      {/* Settings Form Card */}
      <div className="rounded-2xl border border-gray-700/80 bg-gray-800/60 p-6 shadow-md">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-white">
            Configuración de Alertas de Almacenamiento
          </h3>
          <p className="mt-1 text-sm text-gray-400">
            Define cuándo se debe emitir una alerta global para el administrador
            y los usuarios encargados del servidor.
          </p>
        </div>

        <form onSubmit={handleSaveSettings} className="space-y-6">
          {/* Toggle Alert Enabled */}
          <div className="flex flex-col justify-between gap-4 border-b border-gray-700/60 pb-5 sm:flex-row sm:items-center">
            <div>
              <label
                htmlFor="alertEnabled"
                className="cursor-pointer text-sm font-medium text-white"
              >
                Activar Alertas de Almacenamiento Bajo
              </label>
              <p className="mt-0.5 text-xs text-gray-400">
                Muestra un banner persistente en la cabecera cuando el espacio
                libre sea inferior a los umbrales configurados.
              </p>
            </div>
            <input
              type="checkbox"
              id="alertEnabled"
              checked={alertEnabled}
              onChange={(e) => setAlertEnabled(e.target.checked)}
              className="h-5 w-5 cursor-pointer rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-gray-900"
            />
          </div>

          {/* Threshold GB */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <label
                htmlFor="thresholdGb"
                className="mb-1 block text-sm font-medium text-gray-200"
              >
                Umbral Mínimo Absoluto (en GB)
              </label>
              <div className="relative rounded-md shadow-sm">
                <input
                  type="number"
                  id="thresholdGb"
                  min="1"
                  max="10000"
                  value={thresholdGb}
                  onChange={(e) => setThresholdGb(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3.5 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                  <span className="text-xs text-gray-400">GB libres</span>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-gray-400">
                La alerta se disparará si el espacio libre cae por debajo de
                este valor (por defecto: 80 GB).
              </p>
            </div>

            {/* Threshold Percent */}
            <div>
              <label
                htmlFor="thresholdPercent"
                className="mb-1 block text-sm font-medium text-gray-200"
              >
                Umbral Mínimo Relativo (en %)
              </label>
              <div className="relative rounded-md shadow-sm">
                <input
                  type="number"
                  id="thresholdPercent"
                  min="1"
                  max="90"
                  value={thresholdPercent}
                  onChange={(e) => setThresholdPercent(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3.5 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                  <span className="text-xs text-gray-400">% libre</span>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-gray-400">
                La alerta se disparará si el porcentaje libre cae por debajo de
                este valor (por defecto: 10%).
              </p>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button buttonType="primary" type="submit" disabled={isSaving}>
              {isSaving ? 'Guardando...' : 'Guardar Configuración'}
            </Button>
          </div>
        </form>
      </div>

      {/* Storage Cleanup Modal */}
      <StorageCleanupModal
        show={showCleanupModal}
        onClose={() => setShowCleanupModal(false)}
        onSuccess={() => revalidateStorage()}
      />
    </>
  );
};

export default SettingsStorage;

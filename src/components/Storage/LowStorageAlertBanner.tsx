import StorageCleanupModal from '@app/components/Storage/StorageCleanupModal';
import { Permission, useUser } from '@app/hooks/useUser';
import { formatBytes } from '@app/utils/numberHelpers';
import {
  ExclamationTriangleIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { StorageStatusResponse } from '@server/lib/storageTracker';
import React, { useState } from 'react';
import useSWR from 'swr';

const LowStorageAlertBanner: React.FC = () => {
  const { user, hasPermission } = useUser();
  const [isDismissed, setIsDismissed] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const canManage = hasPermission(
    [Permission.ADMIN, Permission.MANAGE_REQUESTS],
    { type: 'or' }
  );

  const { data: status, mutate: revalidateStorage } =
    useSWR<StorageStatusResponse>('/api/v1/storage/status', {
      refreshInterval: 60000, // recheck every minute
      revalidateOnFocus: true,
    });

  if (
    !user ||
    !canManage ||
    isDismissed ||
    !status ||
    !status.alertEnabled ||
    !status.isLowStorage
  ) {
    return null;
  }

  const primaryDisk = status.primaryDisk || status.disks[0];
  const freeBytes = primaryDisk ? primaryDisk.freeBytes : 0;
  const freePercent = primaryDisk ? primaryDisk.freePercent : 0;

  return (
    <>
      <div className="mb-4 overflow-hidden rounded-xl border border-amber-500/50 bg-gradient-to-r from-amber-950/80 via-amber-900/60 to-red-950/70 p-3.5 shadow-lg backdrop-blur-sm transition-all duration-300">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          {/* Alert Message */}
          <div
            className="flex flex-1 cursor-pointer items-center gap-3"
            onClick={() => setShowModal(true)}
          >
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/20 text-amber-400">
              <ExclamationTriangleIcon className="h-5 w-5 animate-pulse" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-amber-300">
                  Alerta de Espacio en Disco
                </span>
                <span className="rounded bg-amber-500/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
                  Crítico
                </span>
              </div>
              <p className="mt-0.5 text-xs leading-tight text-amber-100/90">
                Quedan solo{' '}
                <span className="font-bold text-white">
                  {formatBytes(freeBytes)} ({freePercent}%)
                </span>{' '}
                libres en el almacenamiento de medios. Haz clic para limpiar
                títulos no vistos.
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-shrink-0 items-center gap-2 self-end sm:self-center">
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-gray-950 shadow transition hover:bg-amber-400 focus:outline-none"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              <span>Liberar Espacio</span>
            </button>
            <button
              onClick={() => setIsDismissed(true)}
              title="Descartar aviso temporalmente"
              className="rounded-lg p-1.5 text-amber-300/70 transition hover:bg-white/10 hover:text-white focus:outline-none"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <StorageCleanupModal
        show={showModal}
        onClose={() => setShowModal(false)}
        onSuccess={() => revalidateStorage()}
      />
    </>
  );
};

export default LowStorageAlertBanner;

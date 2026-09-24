import Button from '@app/components/Common/Button';
import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import useToasts from '@app/hooks/useToasts';
import { formatBytes } from '@app/utils/numberHelpers';
import { Transition } from '@headlessui/react';
import {
  ArchiveBoxXMarkIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  FilmIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  TvIcon,
} from '@heroicons/react/24/outline';
import type { CleanupCandidateItem } from '@server/lib/storageTracker';
import axios from 'axios';
import React, { useMemo, useState } from 'react';
import useSWR, { mutate } from 'swr';

interface StorageCleanupModalProps {
  show: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type FilterTab = 'unwatched' | 'watched' | 'all';
type SortOption = 'size' | 'oldest';

const StorageCleanupModal: React.FC<StorageCleanupModalProps> = ({
  show,
  onClose,
  onSuccess,
}) => {
  const { addToast } = useToasts();
  const [activeTab, setActiveTab] = useState<FilterTab>('unwatched');
  const [sortOption, setSortOption] = useState<SortOption>('size');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const {
    data,
    error,
    mutate: mutateCandidates,
  } = useSWR<{
    totalCount: number;
    candidates: CleanupCandidateItem[];
  }>(show ? `/api/v1/storage/candidates?filter=${activeTab}` : null, {
    revalidateOnFocus: false,
  });

  const candidates = useMemo(() => data?.candidates ?? [], [data?.candidates]);

  // Filter and sort candidates
  const displayedCandidates = useMemo(() => {
    let list = [...candidates];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          (c.year && c.year.toString().includes(q))
      );
    }

    if (sortOption === 'size') {
      list.sort((a, b) => b.sizeBytes - a.sizeBytes);
    } else if (sortOption === 'oldest') {
      list.sort((a, b) => b.daysInactive - a.daysInactive);
    }

    return list;
  }, [candidates, searchQuery, sortOption]);

  // Selected items objects
  const selectedItems = useMemo(() => {
    return candidates.filter((c) => selectedIds.has(c.id));
  }, [candidates, selectedIds]);

  const totalFreedBytes = useMemo(() => {
    return selectedItems.reduce((acc, c) => acc + c.sizeBytes, 0);
  }, [selectedItems]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    const next = new Set<string>();
    displayedCandidates.forEach((c) => next.add(c.id));
    setSelectedIds(next);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleDelete = async () => {
    if (selectedItems.length === 0) return;

    setIsDeleting(true);
    try {
      const payload = selectedItems.map((c) => ({
        mediaType: c.mediaType,
        tmdbId: c.tmdbId,
        radarrId: c.radarrId,
        sonarrId: c.sonarrId,
      }));

      const res = await axios.post('/api/v1/storage/cleanup', {
        items: payload,
      });

      const freedFormatted = formatBytes(
        res.data?.freedBytes || totalFreedBytes
      );
      addToast(
        `Se eliminaron ${res.data?.deletedCount || payload.length} títulos y se liberaron ${freedFormatted}.`,
        {
          appearance: 'success',
          autoDismiss: true,
        }
      );

      // Mutate storage status and list
      mutate('/api/v1/storage/status');
      await mutateCandidates();
      setSelectedIds(new Set());
      setIsConfirming(false);

      if (onSuccess) {
        onSuccess();
      }
      onClose();
    } catch (err: any) {
      addToast(
        err?.response?.data?.message ||
          'Error al eliminar los elementos seleccionados.',
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Transition
      as="div"
      enter="transition-opacity duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
      show={show}
    >
      <Modal
        onCancel={() => {
          if (!isDeleting) {
            setIsConfirming(false);
            onClose();
          }
        }}
        title="Limpieza Inteligente de Almacenamiento"
        subTitle="Identifica y elimina contenido antiguo o no visto para recuperar espacio en disco de forma segura."
        dialogClass="w-full max-w-4xl"
      >
        {isConfirming ? (
          <div className="space-y-4 p-4">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200">
              <div className="flex items-start gap-3">
                <ExclamationTriangleIcon className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-400" />
                <div>
                  <h4 className="font-semibold text-white">
                    Confirmar Eliminación de Archivos
                  </h4>
                  <p className="mt-1 text-sm text-gray-300">
                    Estás a punto de eliminar{' '}
                    <span className="font-bold text-white">
                      {selectedItems.length}
                    </span>{' '}
                    elemento(s), lo cual liberará aproximadamente{' '}
                    <span className="font-bold text-emerald-400">
                      {formatBytes(totalFreedBytes)}
                    </span>{' '}
                    en disco.
                  </p>
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-gray-300">
                    <li>
                      Los archivos serán eliminados permanentemente de tu
                      almacenamiento.
                    </li>
                    <li>
                      Los títulos serán desmonitoreados en Radarr/Sonarr para
                      que no se descarguen de nuevo.
                    </li>
                    <li>
                      Las descargas asociadas en qBittorrent serán purgadas.
                    </li>
                    <li>
                      Se refrescará la biblioteca de Jellyfin para reflejar los
                      cambios.
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="max-h-48 divide-y divide-gray-700/50 overflow-y-auto rounded-md border border-gray-700 bg-gray-800/40 p-2 text-sm text-gray-300">
              {selectedItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between px-2 py-1.5"
                >
                  <span className="truncate pr-2 font-medium text-white">
                    {item.title} {item.year ? `(${item.year})` : ''}
                  </span>
                  <span className="whitespace-nowrap text-xs font-semibold text-gray-400">
                    {formatBytes(item.sizeBytes)}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                buttonType="default"
                disabled={isDeleting}
                onClick={() => setIsConfirming(false)}
              >
                Volver a la Lista
              </Button>
              <Button
                buttonType="danger"
                disabled={isDeleting}
                onClick={handleDelete}
              >
                {isDeleting ? (
                  <div className="flex items-center gap-2">
                    <LoadingSpinner />
                    <span>Eliminando archivos...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <ArchiveBoxXMarkIcon className="h-4 w-4" />
                    <span>Confirmar y Liberar Espacio</span>
                  </div>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex h-[70vh] max-h-[650px] flex-col">
            {/* Header controls: Tabs and Filters */}
            <div className="space-y-3 border-b border-gray-700/70 px-4 pb-3 pt-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* Tabs */}
                <div className="flex rounded-lg border border-gray-700 bg-gray-800 p-1">
                  <button
                    onClick={() => {
                      setActiveTab('unwatched');
                      setSelectedIds(new Set());
                    }}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                      activeTab === 'unwatched'
                        ? 'border border-amber-500/40 bg-amber-500/20 font-semibold text-amber-300'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    No vistas (Recomendado)
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('watched');
                      setSelectedIds(new Set());
                    }}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                      activeTab === 'watched'
                        ? 'bg-indigo-600 font-semibold text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Ya vistas
                  </button>
                  <button
                    onClick={() => {
                      setActiveTab('all');
                      setSelectedIds(new Set());
                    }}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                      activeTab === 'all'
                        ? 'bg-indigo-600 font-semibold text-white'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Todas
                  </button>
                </div>

                {/* Sort dropdown */}
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <FunnelIcon className="h-4 w-4" />
                  <span>Ordenar:</span>
                  <select
                    value={sortOption}
                    onChange={(e) =>
                      setSortOption(e.target.value as SortOption)
                    }
                    className="rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-gray-200 focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="size">Mayor tamaño (GB)</option>
                    <option value="oldest">Más antiguos primero</option>
                  </select>
                </div>
              </div>

              {/* Search bar & Selection actions */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="relative min-w-[200px] flex-1">
                  <MagnifyingGlassIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar película o serie..."
                    className="w-full rounded-md border border-gray-700 bg-gray-800 py-1.5 pl-8 pr-3 text-xs text-gray-100 placeholder-gray-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={selectAll}
                    disabled={displayedCandidates.length === 0}
                    className="text-indigo-400 hover:text-indigo-300 disabled:opacity-40"
                  >
                    Seleccionar todo
                  </button>
                  <span className="text-gray-600">•</span>
                  <button
                    onClick={clearSelection}
                    disabled={selectedIds.size === 0}
                    className="text-gray-400 hover:text-gray-200 disabled:opacity-40"
                  >
                    Deseleccionar
                  </button>
                </div>
              </div>
            </div>

            {/* Content List */}
            <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
              {!data && !error ? (
                <div className="flex h-48 flex-col items-center justify-center space-y-2 text-gray-400">
                  <LoadingSpinner />
                  <span className="text-sm">
                    Analizando almacenamiento y bibliotecas...
                  </span>
                </div>
              ) : displayedCandidates.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center space-y-2 text-gray-400">
                  <CheckCircleIcon className="h-10 w-10 text-emerald-400 opacity-80" />
                  <span className="text-sm font-medium text-gray-300">
                    No se encontraron elementos en esta categoría.
                  </span>
                  <span className="text-xs text-gray-500">
                    ¡Tu almacenamiento está al día o no hay elementos que
                    coincidan con la búsqueda!
                  </span>
                </div>
              ) : (
                displayedCandidates.map((candidate) => {
                  const isSelected = selectedIds.has(candidate.id);
                  const isMovie = candidate.mediaType === 'movie';

                  return (
                    <div
                      key={candidate.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleSelect(candidate.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleSelect(candidate.id);
                        }
                      }}
                      className={`flex cursor-pointer select-none items-center justify-between gap-3 rounded-lg border p-2.5 transition focus:outline-none ${
                        isSelected
                          ? 'border-indigo-500/70 bg-indigo-500/10'
                          : 'border-gray-700/60 bg-gray-800/40 hover:border-gray-600 hover:bg-gray-800'
                      }`}
                    >
                      {/* Checkbox */}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}} // Handled by container onClick
                        className="h-4 w-4 rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-gray-800"
                      />

                      {/* Poster image */}
                      <div className="relative h-14 w-10 flex-shrink-0 overflow-hidden rounded bg-gray-700">
                        {candidate.posterPath ? (
                          <CachedImage
                            type="tmdb"
                            src={
                              candidate.posterPath.startsWith('http')
                                ? candidate.posterPath
                                : `https://image.tmdb.org/t/p/w200${candidate.posterPath}`
                            }
                            alt={candidate.title}
                            fill
                            className="object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-gray-500">
                            {isMovie ? (
                              <FilmIcon className="h-5 w-5" />
                            ) : (
                              <TvIcon className="h-5 w-5" />
                            )}
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate text-sm font-medium text-white">
                            {candidate.title}
                          </h4>
                          {candidate.year && (
                            <span className="text-xs text-gray-400">
                              ({candidate.year})
                            </span>
                          )}
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span
                            className={`rounded px-1.5 py-0.5 font-medium ${
                              isMovie
                                ? 'bg-blue-500/20 text-blue-300'
                                : 'bg-purple-500/20 text-purple-300'
                            }`}
                          >
                            {isMovie ? 'Película' : 'Serie'}
                          </span>

                          {candidate.isWatched ? (
                            <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-medium text-emerald-300">
                              Vista
                            </span>
                          ) : (
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-medium text-amber-300">
                              No vista
                            </span>
                          )}

                          {candidate.daysInactive > 0 && (
                            <span className="text-gray-400">
                              • Agregado hace {candidate.daysInactive} días
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Size */}
                      <div className="flex-shrink-0 text-right">
                        <div className="text-sm font-semibold text-white">
                          {formatBytes(candidate.sizeBytes)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Sticky Bottom Footer */}
            <div className="bg-gray-850 flex items-center justify-between gap-3 border-t border-gray-700/70 px-4 py-3">
              <div className="text-xs text-gray-300">
                <span className="font-semibold text-white">
                  {selectedIds.size}
                </span>{' '}
                seleccionado(s){' '}
                {selectedIds.size > 0 && (
                  <>
                    • Liberará{' '}
                    <span className="font-bold text-emerald-400">
                      {formatBytes(totalFreedBytes)}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button buttonType="default" onClick={onClose}>
                  Cerrar
                </Button>
                <Button
                  buttonType="danger"
                  disabled={selectedIds.size === 0}
                  onClick={() => setIsConfirming(true)}
                >
                  <div className="flex items-center gap-1.5">
                    <ArchiveBoxXMarkIcon className="h-4 w-4" />
                    <span>Eliminar y Liberar</span>
                  </div>
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </Transition>
  );
};

export default StorageCleanupModal;

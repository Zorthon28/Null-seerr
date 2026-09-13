import Modal from '@app/components/Common/Modal';
import useToasts from '@app/hooks/useToasts';
import { Transition } from '@headlessui/react';
import {
  TrashIcon,
  ShieldExclamationIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import { useEffect, useState } from 'react';

export interface LeakBlacklistTarget {
  title: string;
  mediaTitle?: string;
  year?: number;
  tmdbId?: number;
  infoHash?: string;
  releaseGroup?: string;
  backdropPath?: string;
  torrentName?: string;
}

interface LeakBlacklistModalProps {
  show: boolean;
  onCancel: () => void;
  onComplete: () => void;
  target: LeakBlacklistTarget | null;
}

const LeakBlacklistModal = ({
  show,
  onCancel,
  onComplete,
  target,
}: LeakBlacklistModalProps) => {
  const { addToast } = useToasts();
  const [purgeFiles, setPurgeFiles] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fetchedTorrentName, setFetchedTorrentName] = useState<string | null>(null);

  useEffect(() => {
    if (show && target?.tmdbId && !target.torrentName) {
      axios
        .get(`/api/v1/leaks/movie-release/${target.tmdbId}`, {
          params: { title: target.mediaTitle || target.title, year: target.year },
        })
        .then((res) => {
          if (res.data?.torrentName) {
            setFetchedTorrentName(res.data.torrentName);
          }
        })
        .catch(() => {});
    }
  }, [show, target]);

  if (!target) return null;

  const effectiveTorrentName =
    target.torrentName ||
    fetchedTorrentName ||
    (target.title !== target.mediaTitle ? target.title : null) ||
    'Buscando nombre del torrente...';

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      const releaseNameToBlock =
        effectiveTorrentName !== 'Buscando nombre del torrente...'
          ? effectiveTorrentName
          : target.title;

      const res = await axios.post('/api/v1/leaks/blacklist', {
        title: releaseNameToBlock,
        mediaTitle: target.mediaTitle || target.title,
        year: target.year,
        tmdbId: target.tmdbId,
        infoHash: target.infoHash,
        releaseGroup: target.releaseGroup,
        reason: 'Versión defectuosa reportada',
        purgeFiles,
      });

      addToast(
        res.data.message || 'Lanzamiento puesto en lista negra exitosamente.',
        { autoDismiss: true, appearance: 'success' }
      );
      onComplete();
    } catch (err: any) {
      addToast(
        'Error al poner en lista negra: ' +
          (err.response?.data?.message || err.message),
        { autoDismiss: true, appearance: 'error' }
      );
    } finally {
      setIsSubmitting(false);
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
        backgroundClickable
        title="Bloquear Versión Defectuosa / Filtración"
        subTitle={target.mediaTitle || target.title}
        onCancel={onCancel}
        onOk={handleConfirm}
        okText={
          isSubmitting
            ? 'Procesando...'
            : purgeFiles
            ? 'Bloquear Esta Versión y Eliminar de Disco'
            : 'Bloquear Esta Versión'
        }
        okButtonType="danger"
        okDisabled={isSubmitting}
        cancelText="Cancelar"
        backdrop={
          target.backdropPath
            ? `https://image.tmdb.org/t/p/w1920_and_h800_multi_faces/${target.backdropPath}`
            : undefined
        }
      >
        <div className="space-y-4 text-sm text-gray-300">
          <div className="rounded-lg bg-indigo-950/40 border border-indigo-800/60 p-3.5 text-xs text-indigo-200">
            <div className="flex items-start gap-2.5">
              <ShieldExclamationIcon className="h-5 w-5 text-indigo-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold uppercase tracking-wider text-indigo-300 block">
                  Bloqueo de Versión Específica
                </span>
                <p>
                  Se pondrá en lista negra <strong>únicamente este torrent/versión defectuosa</strong> para que nunca se vuelva a descargar. La película <strong>seguirá en tu biblioteca y monitoreada</strong> para auto-descargarse cuando esté disponible un lanzamiento en auténtica buena calidad (WEB-DL oficial o Blu-ray).
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gray-900/80 p-3.5 rounded-lg border border-gray-800 space-y-2 text-xs">
            <div className="flex justify-between items-center border-b border-gray-800/80 pb-2">
              <span className="text-gray-400">Película:</span>
              <span className="text-white font-semibold">
                {target.mediaTitle || target.title} {target.year ? `(${target.year})` : ''}
              </span>
            </div>
            {target.tmdbId && (
              <div className="flex justify-between items-center border-b border-gray-800/80 pb-2">
                <span className="text-gray-400">TMDB ID:</span>
                <span className="text-gray-300 font-mono">{target.tmdbId}</span>
              </div>
            )}
            <div className="pt-1">
              <span className="text-gray-400 block mb-1.5 font-semibold">
                Nombre completo del torrent / release a vetar:
              </span>
              <div className="font-mono text-xs text-amber-300 bg-gray-950/90 p-2.5 rounded border border-gray-800 break-all select-all">
                {effectiveTorrentName}
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-gray-800">
            <label className="flex items-start gap-2.5 cursor-pointer p-2.5 bg-gray-900/60 rounded-lg border border-gray-800 hover:border-indigo-800/60 transition">
              <input
                type="checkbox"
                checked={purgeFiles}
                onChange={(e) => setPurgeFiles(e.target.checked)}
                className="mt-0.5 rounded text-red-600 focus:ring-red-500 border-gray-700 bg-gray-900"
              />
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 font-semibold text-xs text-white">
                  <TrashIcon className="h-3.5 w-3.5 text-red-400" />
                  <span>Eliminar copia defectuosa de disco y torrente de qBittorrent</span>
                </div>
                <p className="text-[11px] text-gray-400">
                  Borra el archivo actual de baja calidad y elimina el torrente, pero mantiene la película monitoreada en Radarr a la espera de un release limpio.
                </p>
              </div>
            </label>
          </div>
        </div>
      </Modal>
    </Transition>
  );
};

export default LeakBlacklistModal;

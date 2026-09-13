import Modal from '@app/components/Common/Modal';
import useToasts from '@app/hooks/useToasts';
import { Transition } from '@headlessui/react';
import {
  TrashIcon,
  ShieldExclamationIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import { useState } from 'react';

export interface LeakBlacklistTarget {
  title: string;
  mediaTitle?: string;
  year?: number;
  tmdbId?: number;
  infoHash?: string;
  releaseGroup?: string;
  backdropPath?: string;
}

interface LeakBlacklistModalProps {
  show: boolean;
  onCancel: () => void;
  onComplete: () => void;
  target: LeakBlacklistTarget | null;
}

const PRESET_REASONS = [
  'Audio desfasado / Micrófono de sala (Line/Mic)',
  'Mala calidad / Grabación de cine disfrazada (CAM/TS)',
  'Publicidad intrusiva / Casas de apuestas (1XBET)',
  'Versión falsa / Incompleta / Video erróneo',
  'Otro motivo...',
];

const LeakBlacklistModal = ({
  show,
  onCancel,
  onComplete,
  target,
}: LeakBlacklistModalProps) => {
  const { addToast } = useToasts();
  const [selectedReason, setSelectedReason] = useState(PRESET_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [purgeFiles, setPurgeFiles] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!target) return null;

  const effectiveReason =
    selectedReason === 'Otro motivo...'
      ? customReason.trim() || 'Versión defectuosa'
      : selectedReason;

  const handleConfirm = async () => {
    setIsSubmitting(true);
    try {
      const res = await axios.post('/api/v1/leaks/blacklist', {
        title: target.title,
        mediaTitle: target.mediaTitle || target.title,
        year: target.year,
        tmdbId: target.tmdbId,
        infoHash: target.infoHash,
        releaseGroup: target.releaseGroup,
        reason: effectiveReason,
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
        title="Bloquear Filtración / Poner en Lista Negra"
        subTitle={target.mediaTitle || target.title}
        onCancel={onCancel}
        onOk={handleConfirm}
        okText={
          isSubmitting
            ? 'Procesando...'
            : purgeFiles
            ? 'Bloquear y Eliminar Definitivamente'
            : 'Bloquear Filtración'
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
          <div className="rounded-lg bg-red-950/40 border border-red-800/60 p-3.5 text-xs text-red-200">
            <div className="flex items-start gap-2.5">
              <ShieldExclamationIcon className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold uppercase tracking-wider text-red-300 block">
                  Acción de Bloqueo de Lanzamiento
                </span>
                <p>
                  Este lanzamiento se registrará en la <strong>Lista Negra</strong> del Radar. Nunca volverá a sugerirse ni a auto-descargarse.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-gray-900/80 p-3 rounded-lg border border-gray-800 space-y-1 font-mono text-xs">
            <div className="text-gray-400">Release / Título:</div>
            <div className="text-white font-semibold break-all">{target.title}</div>
            {target.year && <div className="text-gray-400">Año: {target.year}</div>}
            {target.tmdbId && <div className="text-gray-400">TMDB ID: {target.tmdbId}</div>}
          </div>

          <div className="space-y-2">
            <label className="block font-semibold text-gray-200">
              Motivo del bloqueo:
            </label>
            <div className="space-y-1.5">
              {PRESET_REASONS.map((reason) => (
                <label
                  key={reason}
                  className="flex items-center gap-2 cursor-pointer text-xs text-gray-300 hover:text-white p-1.5 rounded hover:bg-gray-800/50 transition"
                >
                  <input
                    type="radio"
                    name="blacklist_reason"
                    checked={selectedReason === reason}
                    onChange={() => setSelectedReason(reason)}
                    className="text-red-600 focus:ring-red-500 border-gray-700 bg-gray-900"
                  />
                  <span>{reason}</span>
                </label>
              ))}
            </div>

            {selectedReason === 'Otro motivo...' && (
              <div className="mt-2">
                <input
                  type="text"
                  placeholder="Escribe el motivo del bloqueo..."
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  className="w-full rounded bg-gray-900 border border-gray-700 px-3 py-2 text-xs text-white focus:border-red-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="pt-2 border-t border-gray-800">
            <label className="flex items-start gap-2.5 cursor-pointer p-2.5 bg-gray-900/60 rounded-lg border border-gray-800 hover:border-red-800/60 transition">
              <input
                type="checkbox"
                checked={purgeFiles}
                onChange={(e) => setPurgeFiles(e.target.checked)}
                className="mt-0.5 rounded text-red-600 focus:ring-red-500 border-gray-700 bg-gray-900"
              />
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5 font-semibold text-xs text-white">
                  <TrashIcon className="h-3.5 w-3.5 text-red-400" />
                  <span>Eliminar torrente y archivos de disco permanentemente</span>
                </div>
                <p className="text-[11px] text-gray-400">
                  Elimina el torrente y los archivos de video de qBittorrent, elimina la película en Radarr y refresca Jellyfin al instante.
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

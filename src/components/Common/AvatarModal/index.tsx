import CachedImage from '@app/components/Common/CachedImage';
import useToasts from '@app/hooks/useToasts';
import { AVATAR_PRESETS } from '@app/utils/avatarPresets';
import { Dialog, Transition } from '@headlessui/react';
import {
  CheckIcon,
  SparklesIcon,
  XMarkIcon,
  LinkIcon,
} from '@heroicons/react/24/solid';
import axios from 'axios';
import { Fragment, useState } from 'react';
import { mutate } from 'swr';

interface AvatarModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: number;
  userName?: string;
  currentAvatar?: string;
  onAvatarSaved?: (newAvatar: string) => void;
}

const AvatarModal = ({
  isOpen,
  onClose,
  userId,
  userName,
  currentAvatar,
  onAvatarSaved,
}: AvatarModalProps) => {
  const toasts = useToasts();
  const [selectedAvatar, setSelectedAvatar] = useState(currentAvatar || '');
  const [customUrl, setCustomUrl] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [isSaving, setIsSaving] = useState(false);

  const categories = ['All', 'Cinematic', 'Anime & Art', 'Cute & Fun', 'Modern'];

  const filteredPresets =
    activeCategory === 'All'
      ? AVATAR_PRESETS
      : AVATAR_PRESETS.filter((p) => p.category === activeCategory);

  const handleSave = async (avatarUrl: string) => {
    if (!avatarUrl || isSaving) return;
    setIsSaving(true);
    try {
      await axios.post(`/api/v1/user/${userId}/avatar`, {
        avatar: avatarUrl,
      });

      toasts.addToast('Avatar actualizado correctamente', {
        appearance: 'success',
        autoDismiss: true,
      });

      // Invalidate relevant caches
      mutate('/api/v1/auth/me');
      mutate('/api/v1/auth/profiles');
      mutate(`/api/v1/user/${userId}`);
      mutate(`/api/v1/user/${userId}/settings/main`);

      if (onAvatarSaved) {
        onAvatarSaved(avatarUrl);
      }

      onClose();
    } catch {
      toasts.addToast('Error al guardar el avatar', {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 text-center">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl border border-gray-700 bg-gray-900/95 p-6 text-left align-middle shadow-2xl backdrop-blur-xl transition-all">
                <div className="flex items-center justify-between border-b border-gray-800 pb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400">
                      <SparklesIcon className="h-5 w-5" />
                    </div>
                    <div>
                      <Dialog.Title className="text-lg font-bold text-gray-100">
                        Elige tu Avatar
                      </Dialog.Title>
                      <p className="text-xs text-gray-400">
                        {userName
                          ? `Personaliza la foto de perfil para ${userName}`
                          : 'Selecciona un estilo o pega el enlace de una imagen'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-colors"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                </div>

                {/* Categories */}
                <div className="mt-4 flex flex-wrap gap-2">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setActiveCategory(cat)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
                        activeCategory === cat
                          ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                          : 'bg-gray-800/80 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                      }`}
                    >
                      {cat === 'All' ? 'Todos' : cat}
                    </button>
                  ))}
                </div>

                {/* Preset Avatars Grid */}
                <div className="mt-4 grid grid-cols-4 sm:grid-cols-6 gap-3.5 max-h-[340px] overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-gray-700">
                  {filteredPresets.map((preset) => {
                    const isSelected = selectedAvatar === preset.url;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => {
                          setSelectedAvatar(preset.url);
                          handleSave(preset.url);
                        }}
                        disabled={isSaving}
                        className={`group relative flex flex-col items-center rounded-xl p-2 transition-all border ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-950/40 ring-2 ring-indigo-400 scale-105'
                            : 'border-gray-800 bg-gray-800/40 hover:border-gray-600 hover:bg-gray-800 hover:scale-105'
                        }`}
                      >
                        <div className="relative h-16 w-16 overflow-hidden rounded-xl bg-gray-950/60 shadow-md">
                          <img
                            src={preset.url}
                            alt={preset.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                          {isSelected && (
                            <div className="absolute inset-0 flex items-center justify-center bg-indigo-900/60 backdrop-blur-[1px]">
                              <CheckIcon className="h-6 w-6 text-white drop-shadow" />
                            </div>
                          )}
                        </div>
                        <span className="mt-1.5 max-w-[70px] truncate text-[10px] font-medium text-gray-300 group-hover:text-white">
                          {preset.name}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Custom URL Option */}
                <div className="mt-5 border-t border-gray-800 pt-4">
                  <label className="block text-xs font-semibold text-gray-300 mb-1.5 flex items-center gap-1.5">
                    <LinkIcon className="h-3.5 w-3.5 text-gray-400" />
                    O usa una URL de imagen personalizada
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      placeholder="https://ejemplo.com/mi-avatar.png"
                      value={customUrl}
                      onChange={(e) => setCustomUrl(e.target.value)}
                      className="flex-1 rounded-xl border border-gray-700 bg-gray-800/80 px-3.5 py-2 text-xs text-gray-200 placeholder-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleSave(customUrl)}
                      disabled={!customUrl.trim() || isSaving}
                      className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-indigo-600/30"
                    >
                      {isSaving ? 'Guardando...' : 'Aplicar'}
                    </button>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};

export default AvatarModal;

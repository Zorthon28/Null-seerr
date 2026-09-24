import AvatarModal from '@app/components/Common/AvatarModal';
import CachedImage from '@app/components/Common/CachedImage';
import useToasts from '@app/hooks/useToasts';
import { useUser } from '@app/hooks/useUser';
import { Transition, Dialog } from '@headlessui/react';
import {
  CheckCircleIcon,
  ChevronDownIcon,
  PencilIcon,
  SparklesIcon,
  UserIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';
import axios from 'axios';
import { useRouter } from 'next/router';
import { Fragment, useState, useCallback } from 'react';
import useSWR, { mutate } from 'swr';

export interface ProfileItem {
  id: number;
  displayName: string;
  email: string;
  avatar: string;
  jellyfinUserId?: string | null;
  isAdmin: boolean;
  isActive: boolean;
}

const ProfileSwitcher = () => {
  const router = useRouter();
  const toasts = useToasts();
  const { user, revalidate } = useUser();
  const [isOpen, setIsOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [avatarModalUser, setAvatarModalUser] = useState<ProfileItem | null>(null);

  const { data: profiles, mutate: mutateProfiles } = useSWR<ProfileItem[]>(
    '/api/v1/auth/profiles',
    {
      revalidateOnFocus: true,
    }
  );

  const activeProfile =
    profiles?.find((p) => p.isActive || p.id === user?.id) ||
    (user
      ? {
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          avatar: user.avatar,
          isAdmin: Boolean(user.permissions & 2),
          isActive: true,
        }
      : null);

  const handleSwitch = useCallback(
    async (targetProfile: ProfileItem) => {
      if (targetProfile.id === user?.id || isSwitching) {
        setIsOpen(false);
        return;
      }

      setIsSwitching(true);
      try {
        await axios.post('/api/v1/auth/switch-profile', {
          userId: targetProfile.id,
        });

        toasts.addToast(`Perfil cambiado a ${targetProfile.displayName}`, {
          appearance: 'success',
          autoDismiss: true,
        });

        setIsOpen(false);

        // Revalidate user and profiles
        await revalidate();
        await mutateProfiles();

        // Mutate recommendations and watched endpoints so UI immediately refreshes
        mutate('/api/v1/auth/me');
        mutate('/api/v1/discover/recommendations/recent');
        mutate('/api/v1/discover/recommendations/movies');
        mutate('/api/v1/discover/recommendations/series');
        mutate('/api/v1/discover/smart-recommendations');
        mutate('/api/v1/user/me/watched');

        // Reload current route data
        router.replace(router.asPath);
      } catch (e: any) {
        toasts.addToast('Error al cambiar de perfil. Inténtalo de nuevo.', {
          appearance: 'error',
          autoDismiss: true,
        });
      } finally {
        setIsSwitching(false);
      }
    },
    [user?.id, isSwitching, revalidate, mutateProfiles, toasts, router]
  );

  if (!profiles || profiles.length <= 1) {
    return null;
  }

  const isGus =
    activeProfile?.displayName?.toLowerCase().includes('gus') ||
    activeProfile?.id === 2;

  return (
    <>
      {/* Top Navbar Profile Switcher Pill */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`mr-2.5 flex items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2.5 text-xs font-medium transition-all border shadow-sm cursor-pointer ${
          isGus
            ? 'border-amber-500/40 bg-amber-950/20 text-amber-200 hover:border-amber-400 hover:bg-amber-900/30'
            : 'border-purple-500/40 bg-purple-950/20 text-purple-200 hover:border-purple-400 hover:bg-purple-900/30'
        }`}
        title="Cambiar de perfil"
        aria-label="Cambiar de perfil"
      >
        <div
          className={`relative h-5 w-5 flex-shrink-0 overflow-hidden rounded-full ring-1 ${
            isGus ? 'ring-amber-400/60' : 'ring-purple-400/60'
          }`}
        >
          {activeProfile?.avatar ? (
            <CachedImage
              type="avatar"
              src={activeProfile.avatar}
              alt=""
              width={20}
              height={20}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gray-800 text-[10px] font-bold uppercase text-gray-200">
              {activeProfile?.displayName?.[0] || 'U'}
            </div>
          )}
        </div>
        <span className="max-w-[70px] truncate font-semibold sm:max-w-[100px]">
          {activeProfile?.displayName}
        </span>
        <ChevronDownIcon className="h-3 w-3 text-gray-400" />
      </button>

      {/* "¿Quién está viendo?" Netflix-Style Modal */}
      <Transition appear show={isOpen} as={Fragment}>
        <Dialog
          as="div"
          className="relative z-50"
          onClose={() => !isSwitching && setIsOpen(false)}
        >
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/80 backdrop-blur-md" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-150"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-lg transform overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/95 p-6 text-left shadow-2xl backdrop-blur-xl transition-all">
                  <div className="flex items-center justify-between pb-3 border-b border-gray-800">
                    <div>
                      <Dialog.Title
                        as="h3"
                        className="text-xl font-bold tracking-tight text-white flex items-center gap-2"
                      >
                        <SparklesIcon className="h-5 w-5 text-indigo-400" />
                        ¿Quién está viendo?
                      </Dialog.Title>
                      <p className="mt-1 text-xs text-gray-400">
                        Selecciona un perfil para personalizar las recomendaciones y el historial.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isSwitching}
                      onClick={() => setIsOpen(false)}
                      className="rounded-full p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white transition cursor-pointer"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Profile Cards Grid */}
                  <div className="grid grid-cols-2 gap-4 py-6">
                    {profiles.map((profile) => {
                      const isActive =
                        profile.id === user?.id || profile.isActive;
                      const isGusProfile =
                        profile.displayName?.toLowerCase().includes('gus') ||
                        profile.id === 2;

                      return (
                        <div
                          key={profile.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => handleSwitch(profile)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleSwitch(profile);
                            }
                          }}
                          className={`group relative flex flex-col items-center rounded-xl p-4 text-center transition-all cursor-pointer focus:outline-none ${
                            isActive
                              ? isGusProfile
                                ? 'bg-amber-950/30 border-2 border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.25)]'
                                : 'bg-purple-950/30 border-2 border-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.25)]'
                              : 'border border-gray-800 bg-gray-800/40 hover:border-gray-600 hover:bg-gray-800/80 hover:scale-[1.03]'
                          }`}
                        >
                          {/* Active Indicator Badge */}
                          {isActive && (
                            <span className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-emerald-950/80 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 ring-1 ring-inset ring-emerald-500/40">
                              <CheckCircleIcon className="h-3 w-3" />
                              Activo
                            </span>
                          )}

                          {/* Edit Avatar Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setAvatarModalUser(profile);
                            }}
                            className="absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-gray-900/80 text-gray-300 hover:bg-indigo-600 hover:text-white border border-gray-700 transition-all shadow-md z-10 cursor-pointer"
                            title={`Cambiar avatar de ${profile.displayName}`}
                            aria-label={`Cambiar avatar de ${profile.displayName}`}
                          >
                            <PencilIcon className="h-3 w-3" />
                          </button>

                          {/* Avatar */}
                          <div
                            className={`relative h-20 w-20 rounded-full overflow-hidden mb-3 transition-transform duration-200 group-hover:scale-105 shadow-md ${
                              isGusProfile
                                ? 'ring-2 ring-amber-400/80'
                                : 'ring-2 ring-purple-400/80'
                            }`}
                          >
                            {profile.avatar ? (
                              <CachedImage
                                type="avatar"
                                src={profile.avatar}
                                alt={profile.displayName}
                                fill
                                className="object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-gray-700 text-2xl font-bold text-gray-200">
                                {profile.displayName?.[0] || 'U'}
                              </div>
                            )}
                          </div>

                          {/* Profile Name */}
                          <span className="text-base font-bold text-white group-hover:text-indigo-300 transition-colors">
                            {profile.displayName}
                          </span>

                          {/* Subtitle / Role */}
                          <span className="mt-1 text-xs text-gray-400">
                            {isGusProfile ? (
                              <span className="text-amber-400 font-medium">
                                Gus (Admin)
                              </span>
                            ) : (
                              <span className="text-purple-400 font-medium">
                                Kenia (Esposa)
                              </span>
                            )}
                          </span>

                          {/* Info note */}
                          <span className="mt-2 text-[11px] text-gray-400">
                            {isGusProfile
                              ? 'Historial completo de series y películas'
                              : 'Historial propio y recomendaciones exclusivas'}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer note */}
                  <div className="flex items-center justify-between pt-3 border-t border-gray-800 text-xs text-gray-400">
                    <span>Acceso a la misma biblioteca completa de medios.</span>
                    <span className="text-gray-400">1-clic rápido</span>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>

      {avatarModalUser && (
        <AvatarModal
          isOpen={Boolean(avatarModalUser)}
          onClose={() => setAvatarModalUser(null)}
          userId={avatarModalUser.id}
          userName={avatarModalUser.displayName}
          currentAvatar={avatarModalUser.avatar}
          onAvatarSaved={async () => {
            await mutateProfiles();
            await revalidate();
          }}
        />
      )}
    </>
  );
};

export default ProfileSwitcher;

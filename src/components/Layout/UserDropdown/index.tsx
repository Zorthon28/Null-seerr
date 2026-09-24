import AvatarModal from '@app/components/Common/AvatarModal';
import CachedImage from '@app/components/Common/CachedImage';
import MiniQuotaDisplay from '@app/components/Layout/UserDropdown/MiniQuotaDisplay';
import type { ProfileItem } from '@app/components/ProfileSwitcher';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { Dialog, Menu, Transition } from '@headlessui/react';
import {
  ArrowRightOnRectangleIcon,
  ClockIcon,
  PencilIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  CheckCircleIcon,
  ChevronDownIcon,
  CogIcon,
  UserIcon,
} from '@heroicons/react/24/solid';
import axios from 'axios';
import type { LinkProps } from 'next/link';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Fragment, forwardRef, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.Layout.UserDropdown', {
  myprofile: 'Profile',
  settings: 'Settings',
  requests: 'Requests',
  signout: 'Sign Out',
});

const ForwardedLink = forwardRef<
  HTMLAnchorElement,
  LinkProps & React.ComponentPropsWithoutRef<'a'>
>(({ href, children, ...rest }, ref) => {
  return (
    <Link href={href} ref={ref} {...rest}>
      {children}
    </Link>
  );
});

ForwardedLink.displayName = 'ForwardedLink';

const UserDropdown = () => {
  const intl = useIntl();
  const router = useRouter();
  const toasts = useToasts();
  const { user, revalidate, hasPermission } = useUser();

  const [avatarModalUser, setAvatarModalUser] = useState<ProfileItem | null>(
    null
  );
  const [isNetflixModalOpen, setIsNetflixModalOpen] = useState(false);

  const { data: profiles, mutate: mutateProfiles } = useSWR<ProfileItem[]>(
    '/api/v1/auth/profiles'
  );
  const otherProfiles = profiles?.filter((p) => p.id !== user?.id) || [];

  const handleSwitchProfile = async (targetId: number, targetName: string) => {
    try {
      await axios.post('/api/v1/auth/switch-profile', { userId: targetId });
      toasts.addToast(`Perfil cambiado a ${targetName}`, {
        appearance: 'success',
        autoDismiss: true,
      });
      await revalidate();
      await mutateProfiles();
      mutate('/api/v1/auth/me');
      mutate('/api/v1/discover/recommendations/recent');
      mutate('/api/v1/discover/recommendations/movies');
      mutate('/api/v1/discover/recommendations/series');
      mutate('/api/v1/discover/smart-recommendations');
      mutate('/api/v1/user/me/watched');
      router.replace(router.asPath);
    } catch {
      toasts.addToast('Error al cambiar de perfil.', { appearance: 'error' });
    }
  };

  const logout = async () => {
    const response = await axios.post('/api/v1/auth/logout');

    if (response.data?.status === 'ok') {
      revalidate();
    }
  };

  return (
    <>
      <Menu as="div" className="relative ml-3">
        <div>
          <Menu.Button
            className="flex items-center gap-2 rounded-full py-1 pl-1.5 pr-2.5 text-sm ring-1 ring-gray-700/80 hover:ring-gray-500 bg-gray-800/60 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer shadow-sm"
            data-testid="user-menu"
            aria-label="Menú de usuario"
          >
            <div className="relative h-7 w-7 rounded-full overflow-hidden ring-1 ring-indigo-500/50 flex-shrink-0">
              <CachedImage
                type="avatar"
                className="h-full w-full object-cover"
                src={user ? user.avatar : ''}
                alt=""
                width={28}
                height={28}
              />
            </div>
            <span className="hidden sm:inline font-semibold text-xs text-gray-200 max-w-[85px] truncate">
              {user?.displayName}
            </span>
            <ChevronDownIcon className="h-3.5 w-3.5 text-gray-400" />
          </Menu.Button>
        </div>
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="opacity-0 scale-95"
          enterTo="opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="opacity-100 scale-100"
          leaveTo="opacity-0 scale-95"
          appear
        >
          <Menu.Items className="absolute right-0 mt-2 w-72 origin-top-right rounded-md shadow-lg z-40">
            <div className="divide-y divide-gray-700 rounded-md bg-gray-800/90 ring-1 ring-gray-700 backdrop-blur-md">
              <div className="flex flex-col space-y-3 px-4 py-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 min-w-0">
                    <div className="relative group flex-shrink-0">
                      <CachedImage
                        type="avatar"
                        className="h-10 w-10 rounded-full object-cover ring-2 ring-indigo-500/40"
                        src={user ? user.avatar : ''}
                        alt=""
                        width={40}
                        height={40}
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setAvatarModalUser(
                            user
                              ? {
                                  id: user.id,
                                  displayName: user.displayName,
                                  email: user.email,
                                  avatar: user.avatar,
                                  isAdmin: Boolean(user.permissions & 2),
                                  isActive: true,
                                }
                              : null
                          )
                        }
                        className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity text-white cursor-pointer"
                        title="Cambiar avatar"
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-base font-semibold text-gray-200">
                        {user?.displayName}
                      </span>
                      {user?.displayName?.toLowerCase() !== user?.email && (
                        <span className="truncate text-xs text-gray-400">
                          {user?.email}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setAvatarModalUser(
                        user
                          ? {
                              id: user.id,
                              displayName: user.displayName,
                              email: user.email,
                              avatar: user.avatar,
                              isAdmin: Boolean(user.permissions & 2),
                              isActive: true,
                            }
                          : null
                      )
                    }
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-700 hover:text-white transition cursor-pointer"
                    title="Personalizar avatar"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                </div>
                {user && <MiniQuotaDisplay userId={user?.id} />}
              </div>
              {profiles && profiles.length > 1 && (
                <div className="p-1">
                  <div className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Cambiar perfil
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsNetflixModalOpen(true)}
                      className="flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 transition cursor-pointer"
                    >
                      <SparklesIcon className="h-3 w-3" />
                      <span>¿Quién está viendo?</span>
                    </button>
                  </div>
                  {otherProfiles.map((p) => {
                    const isGusP =
                      p.displayName?.toLowerCase().includes('gus') ||
                      p.id === 2;
                    return (
                      <Menu.Item key={p.id}>
                        {({ active }) => (
                          <button
                            type="button"
                            onClick={() =>
                              handleSwitchProfile(p.id, p.displayName)
                            }
                            className={`flex w-full items-center rounded px-3 py-2 text-sm font-medium text-gray-200 transition duration-150 ease-in-out cursor-pointer ${
                              active
                                ? isGusP
                                ? 'bg-amber-900/40 text-amber-200'
                                : 'bg-purple-900/40 text-purple-200'
                                : 'hover:bg-gray-700/50'
                            }`}
                          >
                            <div
                              className={`relative mr-2.5 h-6 w-6 overflow-hidden rounded-full ring-1 flex-shrink-0 ${
                                isGusP
                                  ? 'ring-amber-500/60'
                                  : 'ring-purple-500/60'
                              }`}
                            >
                              {p.avatar ? (
                                <CachedImage
                                  type="avatar"
                                  src={p.avatar}
                                  alt=""
                                  width={24}
                                  height={24}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-gray-700 text-xs font-bold text-gray-200">
                                  {p.displayName?.[0] || 'U'}
                                </div>
                              )}
                            </div>
                            <span className="truncate">{p.displayName}</span>
                            <span className="ml-auto text-[11px] text-gray-400">
                              {isGusP ? 'Admin' : 'Esposa'}
                            </span>
                          </button>
                        )}
                      </Menu.Item>
                    );
                  })}
                </div>
              )}
              <div className="p-1">
                <Menu.Item>
                  {({ active }) => (
                    <ForwardedLink
                      href={`/profile`}
                      className={`flex items-center rounded px-4 py-2 text-sm font-medium text-gray-200 transition duration-150 ease-in-out ${
                        active
                          ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white'
                          : ''
                      }`}
                      data-testid="user-menu-profile"
                    >
                      <UserIcon className="mr-2 inline h-5 w-5" />
                      <span>{intl.formatMessage(messages.myprofile)}</span>
                    </ForwardedLink>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <ForwardedLink
                      href={
                        hasPermission(
                          [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
                          { type: 'or' }
                        )
                          ? `/users/${user?.id}/requests?filter=all`
                          : '/requests'
                      }
                      className={`flex items-center rounded px-4 py-2 text-sm font-medium text-gray-200 transition duration-150 ease-in-out ${
                        active
                          ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white'
                          : ''
                      }`}
                      data-testid="user-menu-settings"
                    >
                      <ClockIcon className="mr-2 inline h-5 w-5" />
                      <span>{intl.formatMessage(messages.requests)}</span>
                    </ForwardedLink>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <ForwardedLink
                      href={`/profile/settings`}
                      className={`flex items-center rounded px-4 py-2 text-sm font-medium text-gray-200 transition duration-150 ease-in-out ${
                        active
                          ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white'
                          : ''
                      }`}
                      data-testid="user-menu-settings"
                    >
                      <CogIcon className="mr-2 inline h-5 w-5" />
                      <span>{intl.formatMessage(messages.settings)}</span>
                    </ForwardedLink>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <a
                      href="#"
                      className={`flex items-center rounded px-4 py-2 text-sm font-medium text-gray-200 transition duration-150 ease-in-out ${
                        active
                          ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white'
                          : ''
                      }`}
                      onClick={() => logout()}
                    >
                      <ArrowRightOnRectangleIcon className="mr-2 inline h-5 w-5" />
                      <span>{intl.formatMessage(messages.signout)}</span>
                    </a>
                  )}
                </Menu.Item>
              </div>
            </div>
          </Menu.Items>
        </Transition>
      </Menu>

      {/* "¿Quién está viendo?" Netflix-Style Modal */}
      <Transition appear show={isNetflixModalOpen} as={Fragment}>
        <Dialog
          as="div"
          className="relative z-50"
          onClose={() => setIsNetflixModalOpen(false)}
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
                      onClick={() => setIsNetflixModalOpen(false)}
                      className="rounded-full p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white transition cursor-pointer"
                    >
                      <XMarkIcon className="h-5 w-5" />
                    </button>
                  </div>

                  {/* Profile Cards Grid */}
                  <div className="grid grid-cols-2 gap-4 py-6">
                    {profiles?.map((profile) => {
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
                          onClick={() => {
                            if (!isActive) {
                              handleSwitchProfile(
                                profile.id,
                                profile.displayName
                              );
                            }
                            setIsNetflixModalOpen(false);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              if (!isActive) {
                                handleSwitchProfile(
                                  profile.id,
                                  profile.displayName
                                );
                              }
                              setIsNetflixModalOpen(false);
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

export default UserDropdown;

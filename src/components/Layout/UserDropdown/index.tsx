import AvatarModal from '@app/components/Common/AvatarModal';
import CachedImage from '@app/components/Common/CachedImage';
import MiniQuotaDisplay from '@app/components/Layout/UserDropdown/MiniQuotaDisplay';
import type { ProfileItem } from '@app/components/ProfileSwitcher';
import useToasts from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { Menu, Transition } from '@headlessui/react';
import {
  ArrowRightOnRectangleIcon,
  ClockIcon,
  PencilIcon,
  CheckCircleIcon,
  HeartIcon,
} from '@heroicons/react/24/outline';
import {
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
                    <CachedImage
                      type="avatar"
                      className="h-10 w-10 rounded-full object-cover ring-2 ring-indigo-500/40 flex-shrink-0"
                      src={user ? user.avatar : ''}
                      alt=""
                      width={40}
                      height={40}
                    />
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
              {otherProfiles.length > 0 && (
                <div className="p-1">
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Cambiar perfil
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
                      href="/profile/liked"
                      className={`flex items-center rounded px-4 py-2 text-sm font-medium text-gray-200 transition duration-150 ease-in-out ${
                        active
                          ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white'
                          : ''
                      }`}
                    >
                      <HeartIcon className="mr-2 inline h-5 w-5 text-rose-400" />
                      <span>Me gusta</span>
                    </ForwardedLink>
                  )}
                </Menu.Item>
                <Menu.Item>
                  {({ active }) => (
                    <ForwardedLink
                      href="/profile/watched"
                      className={`flex items-center rounded px-4 py-2 text-sm font-medium text-gray-200 transition duration-150 ease-in-out ${
                        active
                          ? 'bg-gradient-to-br from-indigo-600 to-purple-600 text-white'
                          : ''
                      }`}
                    >
                      <CheckCircleIcon className="mr-2 inline h-5 w-5 text-emerald-400" />
                      <span>Vistos</span>
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

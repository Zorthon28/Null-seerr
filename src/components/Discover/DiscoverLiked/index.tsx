import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import type { ProfileItem } from '@app/components/ProfileSwitcher';
import useDiscover from '@app/hooks/useDiscover';
import { useUser, Permission } from '@app/hooks/useUser';
import ErrorPage from '@app/pages/_error';
import { HeartIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import type { LikedItem } from '@server/interfaces/api/discoverInterfaces';
import { useRouter } from 'next/router';
import { useState, useEffect } from 'react';
import useSWR from 'swr';

const DiscoverLiked = () => {
  const router = useRouter();
  const { user: currentUser, hasPermission } = useUser();
  const { data: profiles } = useSWR<ProfileItem[]>('/api/v1/auth/profiles');

  const [selectedUserId, setSelectedUserId] = useState<number | 'all' | null>(() => {
    if (router.query.userId) {
      return router.query.userId === 'all' ? 'all' : Number(router.query.userId);
    }
    return currentUser?.id ?? null;
  });

  useEffect(() => {
    if (router.query.userId) {
      setSelectedUserId(
        router.query.userId === 'all' ? 'all' : Number(router.query.userId)
      );
    } else if (currentUser?.id && selectedUserId === null) {
      setSelectedUserId(currentUser.id);
    }
  }, [router.query.userId, currentUser?.id, selectedUserId]);

  const targetId =
    selectedUserId === 'all'
      ? 'all'
      : (selectedUserId ?? 'me');

  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
    mutate,
  } = useDiscover<LikedItem>(
    `/api/v1/user/${targetId}/liked`,
    undefined,
    { hideAvailable: false, hideBlocklisted: false }
  );

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  const effectiveUserId =
    targetId === 'all'
      ? 'all'
      : targetId === 'me'
      ? currentUser?.id
      : targetId;

  const selectedProfile =
    effectiveUserId !== 'all'
      ? profiles?.find((p) => p.id === effectiveUserId)
      : null;

  const title =
    effectiveUserId === 'all'
      ? 'Títulos que gustan (Todos los perfiles)'
      : selectedProfile
      ? selectedProfile.id === currentUser?.id
        ? 'Mis títulos favoritos'
        : `Títulos que le gustan a ${selectedProfile.displayName}`
      : 'Me gusta';

  return (
    <>
      <PageTitle title={[title, selectedProfile?.displayName ?? '']} />
      <div className="mb-5 mt-1">
        <Header
          subtext={
            effectiveUserId === 'all'
              ? 'Películas y series favoritas de todos los perfiles de la casa'
              : selectedProfile
              ? `Títulos marcados con Me gusta por ${selectedProfile.displayName}`
              : 'Películas y series que has añadido a tus favoritos'
          }
        >
          {title}
        </Header>
      </div>

      {profiles && profiles.length > 1 && (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl bg-gray-800/60 p-2.5 ring-1 ring-gray-700/60 backdrop-blur-md">
          <span className="px-2 text-xs font-semibold text-gray-400">
            Filtrar por perfil:
          </span>
          {profiles.map((p) => {
            const isSelected = effectiveUserId === p.id;
            return (
              <button
                key={`liked-profile-tab-${p.id}`}
                onClick={() => setSelectedUserId(p.id)}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  isSelected
                    ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                    : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700 hover:text-white'
                }`}
              >
                <img
                  src={p.avatar}
                  alt=""
                  className="h-4 w-4 rounded-full object-cover ring-1 ring-white/20"
                />
                <span>
                  {p.displayName} {p.id === currentUser?.id ? '(Tú)' : ''}
                </span>
              </button>
            );
          })}
          {hasPermission(Permission.ADMIN) && (
            <button
              onClick={() => setSelectedUserId('all')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                effectiveUserId === 'all'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700 hover:text-white'
              }`}
            >
              <UserGroupIcon className="h-4 w-4" />
              <span>Todos los perfiles</span>
            </button>
          )}
        </div>
      )}

      <ListView
        plexItems={titles.map((t) => ({
          id: t.tmdbId,
          ratingKey: String(t.tmdbId),
          tmdbId: t.tmdbId,
          mediaType: t.mediaType,
          title: t.title,
        }))}
        isEmpty={isEmpty}
        isLoading={
          isLoadingInitialData || (isLoadingMore && (titles?.length ?? 0) > 0)
        }
        isReachingEnd={isReachingEnd}
        onScrollBottom={fetchMore}
        mutateParent={mutate}
      />
    </>
  );
};

export default DiscoverLiked;

import Header from '@app/components/Common/Header';
import ListView from '@app/components/Common/ListView';
import PageTitle from '@app/components/Common/PageTitle';
import useDiscover from '@app/hooks/useDiscover';
import { useUser } from '@app/hooks/useUser';
import ErrorPage from '@app/pages/_error';
import type { WatchedItem } from '@server/interfaces/api/discoverInterfaces';
import Link from 'next/link';
import { useRouter } from 'next/router';

const DiscoverWatched = () => {
  const router = useRouter();
  const { user } = useUser({
    id: Number(router.query.userId),
  });
  const { user: currentUser } = useUser();

  const userId = router.pathname.startsWith('/profile')
    ? currentUser?.id
    : router.query.userId || currentUser?.id;

  const {
    isLoadingInitialData,
    isEmpty,
    isLoadingMore,
    isReachingEnd,
    titles,
    fetchMore,
    error,
    mutate,
  } = useDiscover<WatchedItem>(
    userId ? `/api/v1/user/${userId}/watched` : '/api/v1/user/me/watched',
    undefined,
    { hideAvailable: false, hideBlocklisted: false }
  );

  if (error) {
    return <ErrorPage statusCode={500} />;
  }

  const title = router.query.userId ? `${user?.displayName}'s Watched Titles` : 'Watched Titles';

  return (
    <>
      <PageTitle
        title={[title, router.query.userId ? user?.displayName : '']}
      />
      <div className="mb-5 mt-1">
        <Header
          subtext={
            router.query.userId && user ? (
              <Link href={`/users/${user.id}`} className="hover:underline">
                {user.displayName}
              </Link>
            ) : (
              'Movies and series you have recorded as watched'
            )
          }
        >
          {title}
        </Header>
      </div>
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

export default DiscoverWatched;

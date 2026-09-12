import DiscoverWatched from '@app/components/Discover/DiscoverWatched';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const UserWatchedPage: NextPage = () => {
  useRouteGuard([Permission.MANAGE_REQUESTS, Permission.WATCHLIST_VIEW], {
    type: 'or',
  });
  return <DiscoverWatched />;
};

export default UserWatchedPage;

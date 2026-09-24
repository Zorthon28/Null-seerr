import DiscoverLiked from '@app/components/Discover/DiscoverLiked';
import useRouteGuard from '@app/hooks/useRouteGuard';
import { Permission } from '@app/hooks/useUser';
import type { NextPage } from 'next';

const UserLikedPage: NextPage = () => {
  useRouteGuard([Permission.MANAGE_REQUESTS, Permission.WATCHLIST_VIEW], {
    type: 'or',
  });
  return <DiscoverLiked />;
};

export default UserLikedPage;

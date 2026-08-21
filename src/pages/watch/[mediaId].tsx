import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import JellyfinLogo from '@app/assets/services/jellyfin.svg';
import PlexLogo from '@app/assets/services/plex.svg';
import { ArrowLeftIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';

const WatchPage = () => {
  const router = useRouter();
  const { mediaId, type, is4k } = router.query;
  const mediaType = type === 'tv' ? 'tv' : 'movie';

  const { data: mediaData, error: mediaError } = useSWR<any>(
    mediaId ? `/api/v1/${mediaType}/${mediaId}` : null
  );

  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mediaData) {
      const url = is4k === 'true'
        ? (mediaData.mediaInfo?.mediaUrl4k ?? mediaData.mediaInfo?.mediaUrl)
        : (mediaData.mediaInfo?.mediaUrl ?? mediaData.mediaInfo?.mediaUrl4k);

      if (url) {
        setRedirectUrl(url);
        window.location.replace(url);
      } else {
        setError('This media is not yet available or not synced in your media server.');
      }
    }
  }, [mediaData, is4k]);

  useEffect(() => {
    if (mediaError) {
      setError('Failed to fetch media details.');
    }
  }, [mediaError]);

  const mediaTitle = mediaData?.title || mediaData?.name || 'Media';
  const isJellyfin = true;

  return (
    <>
      <Head>
        <title>{mediaTitle} - Opening in Jellyfin</title>
      </Head>
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
        <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900/60 p-8 backdrop-blur-xl shadow-2xl">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
            {isJellyfin ? (
              <JellyfinLogo className="h-10 w-10" />
            ) : (
              <PlexLogo className="h-10 w-10" />
            )}
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-white">
            {error ? 'Unable to Open' : 'Opening in Jellyfin...'}
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            {error ? error : `Redirecting you to ${mediaTitle} in Jellyfin`}
          </p>

          {!error && (
            <div className="my-6 flex justify-center">
              <LoadingSpinner />
            </div>
          )}

          {redirectUrl && (
            <a
              href={redirectUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg transition duration-200 hover:bg-indigo-500"
            >
              <span>Click here if not redirected</span>
              <ArrowTopRightOnSquareIcon className="h-4 w-4" />
            </a>
          )}

          <button
            type="button"
            onClick={() => router.back()}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-700 bg-gray-800/80 px-4 py-2.5 text-sm font-medium text-gray-300 transition duration-200 hover:bg-gray-700"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            <span>Go Back</span>
          </button>
        </div>
      </div>
    </>
  );
};

export default WatchPage;

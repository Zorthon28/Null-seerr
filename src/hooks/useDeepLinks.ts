import useSettings from '@app/hooks/useSettings';
import { MediaServerType } from '@server/constants/server';
import { useEffect, useState } from 'react';

interface useDeepLinksProps {
  mediaUrl?: string;
  mediaUrl4k?: string;
  iOSPlexUrl?: string;
  iOSPlexUrl4k?: string;
}

const useDeepLinks = ({
  mediaUrl,
  mediaUrl4k,
  iOSPlexUrl,
  iOSPlexUrl4k,
}: useDeepLinksProps) => {
  const [returnedMediaUrl, setReturnedMediaUrl] = useState(mediaUrl);
  const [returnedMediaUrl4k, setReturnedMediaUrl4k] = useState(mediaUrl4k);
  const settings = useSettings();

  useEffect(() => {
    let resolvedMediaUrl = mediaUrl;
    let resolvedMediaUrl4k = mediaUrl4k;

    const isBrowser = typeof window !== 'undefined';
    const hostname = isBrowser ? window.location.hostname : '';
    const isLocal =
      !hostname ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);

    if (
      (settings.currentSettings.mediaServerType === MediaServerType.JELLYFIN ||
        settings.currentSettings.mediaServerType === MediaServerType.EMBY) &&
      isBrowser &&
      !isLocal
    ) {
      const parts = hostname.split('.');
      const apexDomain =
        parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
      if (resolvedMediaUrl) {
        resolvedMediaUrl = resolvedMediaUrl.replace(
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/,
          `https://jellyfin.${apexDomain}`
        );
      }
      if (resolvedMediaUrl4k) {
        resolvedMediaUrl4k = resolvedMediaUrl4k.replace(
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/,
          `https://jellyfin.${apexDomain}`
        );
      }
    }

    if (
      settings.currentSettings.mediaServerType === MediaServerType.PLEX &&
      (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1))
    ) {
      setReturnedMediaUrl(iOSPlexUrl);
      setReturnedMediaUrl4k(iOSPlexUrl4k);
    } else {
      setReturnedMediaUrl(resolvedMediaUrl);
      setReturnedMediaUrl4k(resolvedMediaUrl4k);
    }
  }, [
    iOSPlexUrl,
    iOSPlexUrl4k,
    mediaUrl,
    mediaUrl4k,
    settings.currentSettings.mediaServerType,
  ]);

  return { mediaUrl: returnedMediaUrl, mediaUrl4k: returnedMediaUrl4k };
};

export default useDeepLinks;

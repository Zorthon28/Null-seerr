import Header from '@app/components/Common/Header';
import PageTitle from '@app/components/Common/PageTitle';
import type { NextPage } from 'next';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import PlexLogo from '@app/assets/services/plex.svg';
import JellyfinLogo from '@app/assets/services/jellyfin.svg';
import RadarrLogo from '@app/assets/services/radarr.svg';
import SonarrLogo from '@app/assets/services/sonarr.svg';
import ProwlarrLogo from '@app/assets/services/prowlarr.svg';
import BazarrLogo from '@app/assets/services/bazarr.svg';
import QBittorrentLogo from '@app/assets/services/qbittorrent.svg';
import SuggestarrLogo from '@app/assets/services/suggestarr.svg';
import FlareSolverrLogo from '@app/assets/services/flaresolverr.svg';
import TdarrLogo from '@app/assets/services/tdarr.svg';
import ShokoLogo from '@app/assets/services/shoko.svg';
import {
  ArrowTopRightOnSquareIcon,
  GlobeAltIcon,
  ServerIcon,
} from '@heroicons/react/24/outline';

interface AppItem {
  id: string;
  name: string;
  category: 'Media' | 'Management' | 'Indexers & Downloads' | 'Automation & Encoding' | 'Anime';
  port: number;
  path?: string;
  subdomain?: string;
  logo: React.ComponentType<{ className?: string }>;
  role: string;
  description: string;
}

interface CloudflareStatusResponse {
  installed: boolean;
  serviceRunning: boolean;
  domain: string;
  subdomain: string;
  enabled: boolean;
  tunnelTokenConfigured: boolean;
  applicationUrl?: string;
}

const APPS: AppItem[] = [
  {
    id: 'plex',
    name: 'Plex Media Server',
    category: 'Media',
    port: 32400,
    path: '/web',
    subdomain: 'plex',
    logo: PlexLogo,
    role: 'Universal Media Streaming Server',
    description: 'Hardware-accelerated media streaming platform with multi-device sync, smart collections, and unified user profiles.',
  },
  {
    id: 'jellyfin',
    name: 'Jellyfin',
    category: 'Media',
    port: 8096,
    path: '/web/',
    subdomain: 'jellyfin',
    logo: JellyfinLogo,
    role: 'Open-Source Media Streaming Server',
    description: 'Personal media server with Jellyskin dark theme, Intro Skipper, and full Spanish/English subtitle & audio track support.',
  },
  {
    id: 'radarr',
    name: 'Radarr',
    category: 'Management',
    port: 7878,
    subdomain: 'radarr',
    logo: RadarrLogo,
    role: 'Movie Collection Manager',
    description: 'Automated movie manager with TRaSH Guides custom format scoring, standardized naming formats, and automatic quality upgrades.',
  },
  {
    id: 'sonarr',
    name: 'Sonarr',
    category: 'Management',
    port: 8989,
    subdomain: 'sonarr',
    logo: SonarrLogo,
    role: 'TV & Anime Series Manager',
    description: 'Automated TV series & anime organizer with Japanese audio priority, season tracking, and TRaSH quality profiles.',
  },
  {
    id: 'prowlarr',
    name: 'Prowlarr',
    category: 'Indexers & Downloads',
    port: 9696,
    subdomain: 'prowlarr',
    logo: ProwlarrLogo,
    role: 'Indexers & Trackers Manager',
    description: 'Pre-seeded with popular public indexers (YTS, Nyaa, The Pirate Bay, AnimeTosho) and FlareSolverr Cloudflare bypass.',
  },
  {
    id: 'qbittorrent',
    name: 'qBittorrent',
    category: 'Indexers & Downloads',
    port: 8089,
    subdomain: 'qbittorrent',
    logo: QBittorrentLogo,
    role: 'High-Speed BitTorrent Client',
    description: 'Optimized download client with automated category routing (movies/tv), tier-1 public trackers, and unified credentials.',
  },
  {
    id: 'bazarr',
    name: 'Bazarr',
    category: 'Automation & Encoding',
    port: 6767,
    subdomain: 'bazarr',
    logo: BazarrLogo,
    role: 'Subtitles Automation',
    description: 'Companion for Radarr and Sonarr that automatically searches, downloads, and syncs Spanish and English subtitles.',
  },
  {
    id: 'suggestarr',
    name: 'Suggestarr',
    category: 'Automation & Encoding',
    port: 4455,
    subdomain: 'suggestarr',
    logo: SuggestarrLogo,
    role: 'AI & Trend Recommendations',
    description: 'Smart discovery service analyzing your library and trends to automatically recommend movies and series.',
  },
  {
    id: 'tdarr',
    name: 'Tdarr',
    category: 'Automation & Encoding',
    port: 8265,
    subdomain: 'tdarr',
    logo: TdarrLogo,
    role: 'Transcoding & Space Saver',
    description: 'Automated video compressor converting media to HEVC/AV1 to save 40-60% disk space while keeping preferred audio tracks.',
  },
  {
    id: 'shoko',
    name: 'Shoko Server',
    category: 'Anime',
    port: 8111,
    path: '/webui/',
    subdomain: 'shoko',
    logo: ShokoLogo,
    role: 'Anime AniDB Engine',
    description: 'Advanced anime collection engine using AniDB hash matching for exact episode titles, specials, and Shokofin sync.',
  },
  {
    id: 'flaresolverr',
    name: 'FlareSolverr',
    category: 'Indexers & Downloads',
    port: 8191,
    subdomain: 'flaresolverr',
    logo: FlareSolverrLogo,
    role: 'Cloudflare Proxy Helper',
    description: 'Proxy service allowing Prowlarr to bypass Cloudflare anti-bot protection and solve challenge pages seamlessly.',
  },
];

const CATEGORIES = ['All', 'Media', 'Management', 'Indexers & Downloads', 'Automation & Encoding', 'Anime'] as const;

const isLocalHost = (hostname: string): boolean => {
  if (!hostname) return true;
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname.endsWith('.local')
  ) {
    return true;
  }
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(hostname)) {
    return true;
  }
  return false;
};

const getApexDomain = (hostname: string, configuredDomain?: string): string => {
  const cleanConfigured = (configuredDomain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');

  if (cleanConfigured && (hostname.endsWith(cleanConfigured) || isLocalHost(hostname))) {
    return cleanConfigured;
  }

  if (!isLocalHost(hostname)) {
    const parts = hostname.toLowerCase().split('.');
    if (parts.length > 2) {
      return parts.slice(-2).join('.');
    }
    return hostname;
  }

  return cleanConfigured;
};

const AppsPage: NextPage = () => {
  const { data: cfStatus } = useSWR<CloudflareStatusResponse>(
    '/api/v1/settings/network/cloudflare/status'
  );
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [currentHost, setCurrentHost] = useState<string>('localhost');
  const [accessMode, setAccessMode] = useState<'domain' | 'local'>('local');

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hostname) {
      const host = window.location.hostname;
      setCurrentHost(host);
      if (!isLocalHost(host) || window.location.protocol === 'https:') {
        setAccessMode('domain');
      }
    }
  }, []);

  const apexDomain = getApexDomain(currentHost, cfStatus?.domain);
  const hasDomain = Boolean(apexDomain);

  const getAppUrl = (app: AppItem) => {
    if (accessMode === 'domain' && apexDomain) {
      const sub = app.subdomain || app.id;
      return `https://${sub}.${apexDomain}${app.path || ''}`;
    }
    return `http://${currentHost}:${app.port}${app.path || ''}`;
  };

  const getAppDisplayHost = (app: AppItem) => {
    if (accessMode === 'domain' && apexDomain) {
      const sub = app.subdomain || app.id;
      return `${sub}.${apexDomain}`;
    }
    return `:${app.port}`;
  };

  const filteredApps =
    selectedCategory === 'All'
      ? APPS
      : APPS.filter((app) => app.category === selectedCategory);

  return (
    <>
      <PageTitle title="Apps" />
      <div className="mt-4 mb-6">
        <Header subtext="Central launchpad for all connected Arr stack applications, automation engines, downloaders, and media services.">
          Arr Stack &amp; Services
        </Header>
      </div>

      {/* Overview Status Bar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-gray-800 bg-gray-900/60 px-5 py-3.5 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500"></span>
          </span>
          <span className="text-sm font-medium text-gray-200">
            {APPS.length} Stack Services Active &amp; Online
          </span>
        </div>

        {hasDomain && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 font-medium">Link Mode:</span>
            <div className="inline-flex rounded-lg bg-gray-800/90 p-1 border border-gray-700/60 text-xs">
              <button
                type="button"
                onClick={() => setAccessMode('domain')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-semibold transition-all ${
                  accessMode === 'domain'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <GlobeAltIcon className="h-3.5 w-3.5" />
                <span>Cloudflare ({apexDomain})</span>
              </button>
              <button
                type="button"
                onClick={() => setAccessMode('local')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-semibold transition-all ${
                  accessMode === 'local'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <ServerIcon className="h-3.5 w-3.5" />
                <span>Local Ports</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Category Filter Navigation */}
      <div className="mb-6 flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setSelectedCategory(cat)}
            className={`rounded-lg px-4 py-2 text-xs font-semibold transition-all duration-150 ${
              selectedCategory === cat
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'bg-gray-800/70 text-gray-400 hover:bg-gray-800 hover:text-gray-200 border border-gray-700/50'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Apps Grid */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 pb-12">
        {filteredApps.map((app) => {
          const LogoComponent = app.logo;
          const serviceUrl = getAppUrl(app);
          const displayHost = getAppDisplayHost(app);

          return (
            <div
              key={app.id}
              className="group flex flex-col justify-between rounded-xl border border-gray-800 bg-gray-900/70 p-5 backdrop-blur-md transition-all duration-200 hover:border-gray-700 hover:bg-gray-850/80 hover:shadow-xl hover:shadow-black/40"
            >
              <div>
                {/* Header: Official Logo + Category */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-950/80 p-2 border border-gray-800 shadow-inner">
                    <LogoComponent className="h-full w-full object-contain" />
                  </div>
                  <span className="rounded-md bg-gray-800/80 border border-gray-700/60 px-2.5 py-1 text-[11px] font-semibold text-gray-300">
                    {app.category}
                  </span>
                </div>

                {/* App Name & Role */}
                <div className="mt-4">
                  <h3 className="text-lg font-bold text-white group-hover:text-indigo-400 transition-colors">
                    {app.name}
                  </h3>
                  <p className="text-xs font-medium text-gray-400 mt-0.5">
                    {app.role}
                  </p>
                </div>

                {/* Description */}
                <p className="mt-2.5 text-xs leading-relaxed text-gray-400">
                  {app.description}
                </p>
              </div>

              {/* Footer: Live Port / Domain Tag + Direct Open Button */}
              <div className="mt-5 pt-3.5 border-t border-gray-800/80 flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-gray-400 truncate max-w-[170px]" title={displayHost}>
                  {displayHost}
                </span>

                <a
                  href={serviceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-800 hover:bg-indigo-600 border border-gray-700 hover:border-indigo-500 px-3.5 py-1.5 text-xs font-semibold text-gray-200 hover:text-white transition-all duration-150 shadow-sm flex-shrink-0"
                >
                  <span>Open</span>
                  <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};

export default AppsPage;

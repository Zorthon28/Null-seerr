import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlayIcon,
  ArrowTopRightOnSquareIcon,
  ClockIcon,
} from '@heroicons/react/24/solid';
import { useRef, useState } from 'react';
import useSWR from 'swr';

interface ResumeItem {
  id: string;
  title: string;
  seriesName?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  mediaType: 'movie' | 'tv';
  tmdbId?: number;
  overview?: string;
  playedPercentage: number;
  playbackPositionTicks: number;
  totalTicks: number;
  runtimeMinutes?: number;
  remainingMinutes?: number;
  posterPath: string;
  backdropPath: string;
  deepLinkUrl: string;
}

interface ResumeResponse {
  results: ResumeItem[];
  totalResults: number;
}

const ContinueWatchingSlider = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  const { data, error } = useSWR<ResumeResponse>('/api/v1/discover/resume', {
    revalidateOnFocus: true,
    refreshInterval: 20000,
  });

  const items = data?.results || [];

  if (error || items.length === 0) {
    return null;
  }

  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
      setShowLeftArrow(scrollLeft > 10);
      setShowRightArrow(scrollLeft < scrollWidth - clientWidth - 10);
    }
  };

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const offset = direction === 'left' ? -480 : 480;
      scrollRef.current.scrollBy({ left: offset, behavior: 'smooth' });
    }
  };

  return (
    <div className="relative mb-6 -mx-4 px-4 sm:mx-0 sm:px-0">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-600/20 text-red-500 border border-red-500/30">
            <PlayIcon className="h-4 w-4" />
          </div>
          <h2 className="text-lg font-bold tracking-tight text-white sm:text-xl">
            Continuar Viendo
          </h2>
          <span className="rounded-full bg-gray-800/80 px-2 py-0.5 text-xs font-semibold text-gray-400 border border-gray-700">
            {items.length}
          </span>
        </div>

        {/* Scroll Controls (Desktop) */}
        <div className="hidden sm:flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => scroll('left')}
            disabled={!showLeftArrow}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-700 bg-gray-800/80 text-gray-300 transition-all hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            aria-label="Anterior"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => scroll('right')}
            disabled={!showRightArrow}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-700 bg-gray-800/80 text-gray-300 transition-all hover:bg-gray-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            aria-label="Siguiente"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Horizontal Slider */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex gap-4 overflow-x-auto pb-3 pt-1 scrollbar-none scroll-smooth"
      >
        {items.map((item) => {
          const mainTitle = item.seriesName || item.title;
          const subTitle = item.seriesName
            ? `T${item.seasonNumber ?? 1}:E${item.episodeNumber ?? 1} • ${item.title}`
            : item.remainingMinutes
            ? `Restan ${item.remainingMinutes} min`
            : `${item.playedPercentage}% visto`;

          return (
            <div
              key={item.id}
              className="group relative flex-shrink-0 w-64 sm:w-72 rounded-2xl overflow-hidden border border-gray-800/80 bg-gray-900/60 shadow-lg transition-all duration-300 hover:scale-[1.03] hover:border-gray-600 hover:shadow-2xl hover:shadow-black/60 flex flex-col"
            >
              {/* Media Backdrop / Thumbnail Container */}
              <a
                href={item.deepLinkUrl}
                target="_blank"
                rel="noreferrer"
                className="relative aspect-video w-full overflow-hidden bg-gray-950 block"
              >
                <img
                  src={item.backdropPath}
                  alt={mainTitle}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading="lazy"
                  onError={(e) => {
                    // Fallback to poster if backdrop missing
                    (e.target as HTMLImageElement).src = item.posterPath;
                  }}
                />

                {/* Dark Vignette Overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-transparent to-black/20" />

                {/* Play Button Overlay (Hover) */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/40 backdrop-blur-[2px]">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-gray-950 shadow-xl transition-transform duration-200 group-hover:scale-110">
                    <PlayIcon className="h-6 w-6 ml-0.5 text-gray-950" />
                  </div>
                </div>

                {/* Remaining Time / Badge (Top Right) */}
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1 rounded-md bg-black/75 px-2 py-0.5 text-[10px] font-semibold text-gray-200 backdrop-blur-md border border-white/10">
                  <ClockIcon className="h-3 w-3 text-red-500" />
                  <span>
                    {item.remainingMinutes
                      ? `${item.remainingMinutes}m`
                      : `${item.playedPercentage}%`}
                  </span>
                </div>

                {/* Progress Bar (Bottom) */}
                <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-gray-800/90 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-red-600 to-rose-500 transition-all duration-300"
                    style={{
                      width: `${Math.min(100, Math.max(4, item.playedPercentage))}%`,
                    }}
                  />
                </div>
              </a>

              {/* Information Row */}
              <div className="p-3 flex items-center justify-between gap-2 flex-1">
                <div className="min-w-0 flex-1">
                  <a
                    href={item.deepLinkUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm font-semibold text-gray-100 hover:text-indigo-300 transition-colors"
                    title={mainTitle}
                  >
                    {mainTitle}
                  </a>
                  <p
                    className="truncate text-xs font-medium text-gray-400 mt-0.5"
                    title={subTitle}
                  >
                    {subTitle}
                  </p>
                </div>

                <a
                  href={item.deepLinkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-shrink-0 flex h-8 w-8 items-center justify-center rounded-xl bg-gray-800/80 text-gray-300 border border-gray-700/60 hover:bg-indigo-600 hover:text-white hover:border-indigo-500 transition-all shadow-sm"
                  title="Reproducir en Jellyfin"
                  aria-label="Reproducir en Jellyfin"
                >
                  <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ContinueWatchingSlider;

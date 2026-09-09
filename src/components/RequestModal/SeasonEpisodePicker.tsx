import Spinner from '@app/assets/spinner.svg';
import type { MediaWatchStatus } from '@app/hooks/useWatchStatus';
import type { SeasonWithEpisodes } from '@server/models/Tv';
import { useState } from 'react';
import useSWR from 'swr';
import { CheckIcon, FunnelIcon } from '@heroicons/react/24/outline';

interface SeasonEpisodePickerProps {
  tmdbId: number;
  seasonNumber: number;
  totalEpisodeCount: number;
  selectedEpisodes?: number[];
  watchStatus?: MediaWatchStatus;
  onChange: (episodes: number[]) => void;
}

const SeasonEpisodePicker = ({
  tmdbId,
  seasonNumber,
  totalEpisodeCount,
  selectedEpisodes,
  watchStatus,
  onChange,
}: SeasonEpisodePickerProps) => {
  const { data, error, isLoading } = useSWR<SeasonWithEpisodes>(
    `/api/v1/tv/${tmdbId}/season/${seasonNumber}`
  );

  const [rangeFrom, setRangeFrom] = useState<string>('');
  const [rangeTo, setRangeTo] = useState<string>('');

  const episodes = data?.episodes ?? [];
  const allEpisodeNumbers = episodes.map((ep) => ep.episodeNumber);

  // If selectedEpisodes is undefined, it means all episodes in the season are currently selected
  const currentSelected = selectedEpisodes ?? allEpisodeNumbers;

  const isEpisodeSelected = (epNum: number) => currentSelected.includes(epNum);

  const toggleEpisode = (epNum: number) => {
    if (isEpisodeSelected(epNum)) {
      onChange(currentSelected.filter((n) => n !== epNum));
    } else {
      onChange([...currentSelected, epNum].sort((a, b) => a - b));
    }
  };

  const selectAll = () => {
    onChange(allEpisodeNumbers);
  };

  const clearAll = () => {
    onChange([]);
  };

  const selectOnlyUnwatched = () => {
    const unwatched = episodes
      .filter((ep) => {
        const epKey = `s${seasonNumber}e${ep.episodeNumber}`;
        return !watchStatus?.episodes?.[epKey]?.played;
      })
      .map((ep) => ep.episodeNumber);
    onChange(unwatched);
  };

  const selectLastN = (n: number) => {
    const sorted = [...allEpisodeNumbers].sort((a, b) => a - b);
    const lastN = sorted.slice(-n);
    onChange(lastN);
  };

  const applyRange = () => {
    const from = parseInt(rangeFrom, 10);
    const to = parseInt(rangeTo, 10);
    if (!isNaN(from) && !isNaN(to) && from <= to) {
      const ranged = allEpisodeNumbers.filter((n) => n >= from && n <= to);
      onChange(ranged);
    }
  };

  // Count watched episodes in this season
  const watchedCount = episodes.filter((ep) => {
    const epKey = `s${seasonNumber}e${ep.episodeNumber}`;
    return watchStatus?.episodes?.[epKey]?.played;
  }).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-gray-400">
        <Spinner className="mr-2 h-5 w-5" />
        <span className="text-xs">Loading Season {seasonNumber} episodes...</span>
      </div>
    );
  }

  if (error || episodes.length === 0) {
    return (
      <div className="py-4 text-center text-xs text-gray-400">
        No detailed episode data found for Season {seasonNumber}.
      </div>
    );
  }

  return (
    <div className="bg-gray-900/90 border-t border-b border-gray-700/60 p-3 sm:p-4 text-gray-200">
      {/* Preset Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-gray-800">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-gray-400 font-medium flex items-center gap-1 mr-1">
            <FunnelIcon className="w-3.5 h-3.5 text-indigo-400" />
            Presets:
          </span>
          <button
            type="button"
            onClick={selectAll}
            className={`px-2 py-1 rounded transition text-xs font-medium cursor-pointer ${
              currentSelected.length === allEpisodeNumbers.length
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
          >
            All ({allEpisodeNumbers.length})
          </button>

          {watchStatus?.hasMedia && watchedCount > 0 && (
            <button
              type="button"
              onClick={selectOnlyUnwatched}
              className="px-2 py-1 rounded bg-green-950/70 border border-green-700/50 text-green-300 hover:bg-green-900 transition text-xs font-medium cursor-pointer flex items-center gap-1"
            >
              <CheckIcon className="w-3.5 h-3.5" />
              Only Unwatched ({allEpisodeNumbers.length - watchedCount})
            </button>
          )}

          {allEpisodeNumbers.length > 5 && (
            <button
              type="button"
              onClick={() => selectLastN(5)}
              className="px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition text-xs font-medium cursor-pointer"
            >
              Last 5
            </button>
          )}

          {allEpisodeNumbers.length > 10 && (
            <button
              type="button"
              onClick={() => selectLastN(10)}
              className="px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition text-xs font-medium cursor-pointer"
            >
              Last 10
            </button>
          )}

          <button
            type="button"
            onClick={clearAll}
            className="px-2 py-1 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-red-300 transition text-xs cursor-pointer"
          >
            Clear
          </button>
        </div>

        {/* Range Selector */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-gray-400">Range:</span>
          <input
            type="number"
            min={1}
            max={allEpisodeNumbers.length}
            placeholder="From"
            value={rangeFrom}
            onChange={(e) => setRangeFrom(e.target.value)}
            className="w-14 px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-200 text-xs focus:border-indigo-500 focus:outline-none text-center"
          />
          <span className="text-gray-400">to</span>
          <input
            type="number"
            min={1}
            max={allEpisodeNumbers.length}
            placeholder="To"
            value={rangeTo}
            onChange={(e) => setRangeTo(e.target.value)}
            className="w-14 px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-200 text-xs focus:border-indigo-500 focus:outline-none text-center"
          />
          <button
            type="button"
            onClick={applyRange}
            disabled={!rangeFrom || !rangeTo}
            className="px-2 py-0.5 rounded bg-indigo-600/80 text-white hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition text-xs cursor-pointer"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Episode Selection Counter */}
      <div className="flex items-center justify-between text-xs text-gray-400 my-2">
        <span>
          Selected:{' '}
          <strong className="text-indigo-400 font-semibold">
            {currentSelected.length}
          </strong>{' '}
          of {allEpisodeNumbers.length} episodes
        </span>
        {watchedCount > 0 && (
          <span className="text-gray-400">
            {watchedCount} episode{watchedCount > 1 ? 's' : ''} watched in Jellyfin
          </span>
        )}
      </div>

      {/* Episode Checklist Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 max-h-56 overflow-y-auto pr-1">
        {episodes.map((ep) => {
          const epKey = `s${seasonNumber}e${ep.episodeNumber}`;
          const isWatched = watchStatus?.episodes?.[epKey]?.played;
          const isSelected = isEpisodeSelected(ep.episodeNumber);

          return (
            <div
              key={`ep-${ep.id}`}
              onClick={() => toggleEpisode(ep.episodeNumber)}
              className={`flex items-center gap-2 p-2 rounded-lg border text-xs transition cursor-pointer select-none ${
                isSelected
                  ? 'bg-indigo-950/40 border-indigo-700/60 text-gray-100 shadow-sm'
                  : 'bg-gray-800/40 border-gray-800 text-gray-400 hover:bg-gray-800 hover:text-gray-300'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => {}} // Handled by container onClick
                className="rounded border-gray-600 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 cursor-pointer"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-semibold truncate">
                    E{ep.episodeNumber}
                    {ep.name ? ` · ${ep.name}` : ''}
                  </span>
                  {isWatched && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.2 rounded-full bg-green-900/60 text-green-300 border border-green-700/40 flex items-center gap-0.5">
                      ✓ Watched
                    </span>
                  )}
                </div>
                {ep.airDate && (
                  <div className="text-[10px] text-gray-500">{ep.airDate}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SeasonEpisodePicker;

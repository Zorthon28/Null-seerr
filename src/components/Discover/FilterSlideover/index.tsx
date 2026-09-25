import Button from '@app/components/Common/Button';
import MultiRangeSlider from '@app/components/Common/MultiRangeSlider';
import SlideOver from '@app/components/Common/SlideOver';
import type { FilterOptions } from '@app/components/Discover/constants';
import { countActiveFilters } from '@app/components/Discover/constants';
import LanguageSelector from '@app/components/LanguageSelector';
import {
  CompanySelector,
  GenreSelector,
  KeywordSelector,
  StatusSelector,
  USCertificationSelector,
  WatchProviderSelector,
} from '@app/components/Selector';
import useSettings from '@app/hooks/useSettings';
import {
  useBatchUpdateQueryParams,
  useUpdateQueryParams,
} from '@app/hooks/useUpdateQueryParams';
import defineMessages from '@app/utils/defineMessages';
import { XCircleIcon } from '@heroicons/react/24/outline';
import Datepicker from '@seerr-team/react-tailwindcss-datepicker';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Discover.FilterSlideover', {
  filters: 'Filters',
  activefilters:
    '{count, plural, one {# Active Filter} other {# Active Filters}}',
  releaseDate: 'Release Date',
  firstAirDate: 'First Air Date',
  from: 'From',
  to: 'To',
  studio: 'Studio',
  genres: 'Genres',
  keywords: 'Keywords',
  excludeKeywords: 'Exclude Keywords',
  originalLanguage: 'Original Language',
  runtimeText: '{minValue}-{maxValue} minute runtime',
  ratingText: 'Ratings between {minValue} and {maxValue}',
  clearfilters: 'Clear Active Filters',
  tmdbuserscore: 'TMDB User Score',
  tmdbuservotecount: 'TMDB User Vote Count',
  runtime: 'Runtime',
  streamingservices: 'Streaming Services',
  voteCount: 'Number of votes between {minValue} and {maxValue}',
  status: 'Status',
  certification: 'Content Rating',
  rtScore: 'Rotten Tomatoes Tomatometer',
  imdbScore: 'IMDb Rating',
  allScores: 'Any Score',
  allRatings: 'Any Rating',
  rtFresh: 'Fresh (60%+)',
  rtCertifiedFresh: 'Certified Fresh (75%+)',
  rtTopTier: 'Top Tier (80%+)',
  rtMasterpiece: 'Masterpiece (90%+)',
  imdbGood: '6.0+ Good',
  imdbGreat: '7.0+ Great',
  imdbHighQuality: '7.5+ High Quality',
  imdbAcclaimed: '8.0+ Acclaimed',
  imdbClassic: '8.5+ All-Time Classic',
  singleVoteNotice:
    'Single-vote protection is active: sorting by rating automatically filters out obscure titles with fewer than {minVotes} votes.',
});

type FilterSlideoverProps = {
  show: boolean;
  onClose: () => void;
  type: 'movie' | 'tv';
  currentFilters: FilterOptions;
};

const FilterSlideover = ({
  show,
  onClose,
  type,
  currentFilters,
}: FilterSlideoverProps) => {
  const intl = useIntl();
  const { currentSettings } = useSettings();
  const updateQueryParams = useUpdateQueryParams({});
  const batchUpdateQueryParams = useBatchUpdateQueryParams({});

  const dateGte =
    type === 'movie' ? 'primaryReleaseDateGte' : 'firstAirDateGte';
  const dateLte =
    type === 'movie' ? 'primaryReleaseDateLte' : 'firstAirDateLte';

  return (
    <SlideOver
      show={show}
      title={intl.formatMessage(messages.filters)}
      subText={intl.formatMessage(messages.activefilters, {
        count: countActiveFilters(currentFilters),
      })}
      onClose={() => onClose()}
    >
      <div className="flex flex-col space-y-4">
        <div>
          <div className="mb-2 text-lg font-semibold">
            {intl.formatMessage(
              type === 'movie' ? messages.releaseDate : messages.firstAirDate
            )}
          </div>
          <div className="relative z-40 flex space-x-2">
            <div className="flex flex-col">
              <div className="mb-2">{intl.formatMessage(messages.from)}</div>
              <Datepicker
                primaryColor="indigo"
                value={{
                  startDate: currentFilters[dateGte] ?? null,
                  endDate: currentFilters[dateGte] ?? null,
                }}
                onChange={(value) => {
                  updateQueryParams(
                    dateGte,
                    value?.startDate ? (value.startDate as string) : undefined
                  );
                }}
                inputName="fromdate"
                useRange={false}
                asSingle
                containerClassName="datepicker-wrapper"
                inputClassName="pr-1 sm:pr-4 text-base leading-5"
              />
            </div>
            <div className="flex flex-col">
              <div className="mb-2">{intl.formatMessage(messages.to)}</div>
              <Datepicker
                primaryColor="indigo"
                value={{
                  startDate: currentFilters[dateLte] ?? null,
                  endDate: currentFilters[dateLte] ?? null,
                }}
                onChange={(value) => {
                  updateQueryParams(
                    dateLte,
                    value?.startDate ? (value.startDate as string) : undefined
                  );
                }}
                inputName="todate"
                useRange={false}
                asSingle
                containerClassName="datepicker-wrapper"
                inputClassName="pr-1 sm:pr-4 text-base leading-5"
              />
            </div>
          </div>
        </div>
        {type === 'movie' && (
          <>
            <span className="text-lg font-semibold">
              {intl.formatMessage(messages.studio)}
            </span>
            <CompanySelector
              defaultValue={currentFilters.studio}
              onChange={(value) => {
                updateQueryParams('studio', value?.value.toString());
              }}
            />
          </>
        )}
        <span className="text-lg font-semibold">
          {intl.formatMessage(messages.genres)}
        </span>
        <GenreSelector
          type={type}
          defaultValue={currentFilters.genre}
          isMulti
          onChange={(value) => {
            updateQueryParams('genre', value?.map((v) => v.value).join(','));
          }}
        />
        {type === 'tv' && (
          <>
            <span className="text-lg font-semibold">
              {intl.formatMessage(messages.status)}
            </span>
            <StatusSelector
              defaultValue={currentFilters.status}
              isMulti
              onChange={(value) => {
                updateQueryParams(
                  'status',
                  value?.map((v) => v.value).join('|')
                );
              }}
            />
          </>
        )}
        <span className="text-lg font-semibold">
          {intl.formatMessage(messages.keywords)}
        </span>
        <KeywordSelector
          defaultValue={currentFilters.keywords}
          isMulti
          onChange={(value) => {
            updateQueryParams('keywords', value?.map((v) => v.value).join(','));
          }}
        />
        <span className="text-lg font-semibold">
          {intl.formatMessage(messages.excludeKeywords)}
        </span>
        <KeywordSelector
          defaultValue={currentFilters.excludeKeywords}
          isMulti
          onChange={(value) => {
            updateQueryParams(
              'excludeKeywords',
              value?.map((v) => v.value).join(',')
            );
          }}
        />
        <span className="text-lg font-semibold">
          {intl.formatMessage(messages.originalLanguage)}
        </span>
        <LanguageSelector
          value={currentFilters.language}
          serverValue={currentSettings.originalLanguage}
          isUserSettings
          setFieldValue={(_key, value) => {
            updateQueryParams('language', value);
          }}
        />
        <span className="text-lg font-semibold">
          {intl.formatMessage(messages.certification)}
        </span>
        <USCertificationSelector
          type={type}
          certification={currentFilters.certification}
          onChange={(params) => {
            batchUpdateQueryParams(params);
          }}
        />
        <span className="text-lg font-semibold">
          {intl.formatMessage(messages.runtime)}
        </span>
        <div className="relative z-0">
          <MultiRangeSlider
            min={0}
            max={400}
            onUpdateMin={(min) => {
              updateQueryParams(
                'withRuntimeGte',
                min !== 0 && Number(currentFilters.withRuntimeLte) !== 400
                  ? min.toString()
                  : undefined
              );
            }}
            onUpdateMax={(max) => {
              updateQueryParams(
                'withRuntimeLte',
                max !== 400 && Number(currentFilters.withRuntimeGte) !== 0
                  ? max.toString()
                  : undefined
              );
            }}
            defaultMaxValue={
              currentFilters.withRuntimeLte
                ? Number(currentFilters.withRuntimeLte)
                : undefined
            }
            defaultMinValue={
              currentFilters.withRuntimeGte
                ? Number(currentFilters.withRuntimeGte)
                : undefined
            }
            subText={intl.formatMessage(messages.runtimeText, {
              minValue: currentFilters.withRuntimeGte ?? 0,
              maxValue: currentFilters.withRuntimeLte ?? 400,
            })}
          />
        </div>
        <span className="text-lg font-semibold">
          {intl.formatMessage(messages.tmdbuserscore)}
        </span>
        <div className="relative z-0">
          <MultiRangeSlider
            min={1}
            max={10}
            defaultMaxValue={
              currentFilters.voteAverageLte
                ? Number(currentFilters.voteAverageLte)
                : undefined
            }
            defaultMinValue={
              currentFilters.voteAverageGte
                ? Number(currentFilters.voteAverageGte)
                : undefined
            }
            onUpdateMin={(min) => {
              updateQueryParams(
                'voteAverageGte',
                min !== 1 && Number(currentFilters.voteAverageLte) !== 10
                  ? min.toString()
                  : undefined
              );
            }}
            onUpdateMax={(max) => {
              updateQueryParams(
                'voteAverageLte',
                max !== 10 && Number(currentFilters.voteAverageGte) !== 1
                  ? max.toString()
                  : undefined
              );
            }}
            subText={intl.formatMessage(messages.ratingText, {
              minValue: currentFilters.voteAverageGte ?? 1,
              maxValue: currentFilters.voteAverageLte ?? 10,
            })}
          />
        </div>
        <span className="text-lg font-semibold">
          {intl.formatMessage(messages.tmdbuservotecount)}
        </span>
        <div className="relative z-0">
          <MultiRangeSlider
            min={0}
            max={1000}
            defaultMaxValue={
              currentFilters.voteCountLte
                ? Number(currentFilters.voteCountLte)
                : undefined
            }
            defaultMinValue={
              currentFilters.voteCountGte
                ? Number(currentFilters.voteCountGte)
                : undefined
            }
            onUpdateMin={(min) => {
              updateQueryParams(
                'voteCountGte',
                min !== 0 && Number(currentFilters.voteCountLte) !== 1000
                  ? min.toString()
                  : undefined
              );
            }}
            onUpdateMax={(max) => {
              updateQueryParams(
                'voteCountLte',
                max !== 1000 && Number(currentFilters.voteCountGte) !== 0
                  ? max.toString()
                  : undefined
              );
            }}
            subText={intl.formatMessage(messages.voteCount, {
              minValue: currentFilters.voteCountGte ?? 0,
              maxValue: currentFilters.voteCountLte ?? 1000,
            })}
          />
        </div>
        <span className="text-lg font-semibold">
          {intl.formatMessage(messages.rtScore)}
        </span>
        <select
          id="rtScoreGte"
          name="rtScoreGte"
          value={currentFilters.rtScoreGte ?? ''}
          onChange={(e) =>
            updateQueryParams('rtScoreGte', e.target.value || undefined)
          }
          className="rounded-md border border-gray-600 bg-gray-800 text-white p-2 text-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="">{intl.formatMessage(messages.allScores)}</option>
          <option value="60">{intl.formatMessage(messages.rtFresh)}</option>
          <option value="75">
            {intl.formatMessage(messages.rtCertifiedFresh)}
          </option>
          <option value="80">{intl.formatMessage(messages.rtTopTier)}</option>
          <option value="90">
            {intl.formatMessage(messages.rtMasterpiece)}
          </option>
        </select>
        {type === 'movie' && (
          <>
            <span className="text-lg font-semibold">
              {intl.formatMessage(messages.imdbScore)}
            </span>
            <select
              id="imdbScoreGte"
              name="imdbScoreGte"
              value={currentFilters.imdbScoreGte ?? ''}
              onChange={(e) =>
                updateQueryParams('imdbScoreGte', e.target.value || undefined)
              }
              className="rounded-md border border-gray-600 bg-gray-800 text-white p-2 text-sm focus:border-indigo-500 focus:outline-none"
            >
              <option value="">
                {intl.formatMessage(messages.allRatings)}
              </option>
              <option value="6.0">
                {intl.formatMessage(messages.imdbGood)}
              </option>
              <option value="7.0">
                {intl.formatMessage(messages.imdbGreat)}
              </option>
              <option value="7.5">
                {intl.formatMessage(messages.imdbHighQuality)}
              </option>
              <option value="8.0">
                {intl.formatMessage(messages.imdbAcclaimed)}
              </option>
              <option value="8.5">
                {intl.formatMessage(messages.imdbClassic)}
              </option>
            </select>
          </>
        )}
        <div className="rounded-md bg-indigo-950/60 border border-indigo-500/30 p-2.5 text-xs text-indigo-200">
          <span className="font-semibold block mb-0.5">
            ℹ️ Quality Protection
          </span>
          {intl.formatMessage(messages.singleVoteNotice, {
            minVotes: type === 'movie' ? 100 : 50,
          })}
        </div>
        <span className="text-lg font-semibold">
          {intl.formatMessage(messages.streamingservices)}
        </span>
        <WatchProviderSelector
          type={type}
          region={currentFilters.watchRegion}
          activeProviders={
            currentFilters.watchProviders?.split('|').map((v) => Number(v)) ??
            []
          }
          onChange={(region, providers) => {
            if (providers.length) {
              batchUpdateQueryParams({
                watchRegion: region,
                watchProviders: providers.join('|'),
              });
            } else {
              batchUpdateQueryParams({
                watchRegion: undefined,
                watchProviders: undefined,
              });
            }
          }}
        />
        <div className="pt-4">
          <Button
            className="w-full"
            disabled={Object.keys(currentFilters).length === 0}
            onClick={() => {
              const copyCurrent = Object.assign({}, currentFilters);
              (
                Object.keys(copyCurrent) as (keyof typeof currentFilters)[]
              ).forEach((k) => {
                copyCurrent[k] = undefined;
              });
              batchUpdateQueryParams(copyCurrent);
              onClose();
            }}
          >
            <XCircleIcon />
            <span>{intl.formatMessage(messages.clearfilters)}</span>
          </Button>
        </div>
      </div>
    </SlideOver>
  );
};

export default FilterSlideover;

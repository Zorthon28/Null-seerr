import CachedImage from '@app/components/Common/CachedImage';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import RequestButton from '@app/components/RequestButton';
import StatusBadgeMini from '@app/components/Common/StatusBadgeMini';
import { Transition } from '@headlessui/react';
import { SparklesIcon, StarIcon } from '@heroicons/react/24/solid';
import type Media from '@server/entity/Media';
import Link from 'next/link';
import React, { useState } from 'react';
import useSWR from 'swr';

export interface SmartRecommendationItem {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  originalTitle?: string;
  overview: string;
  posterPath?: string;
  backdropPath?: string;
  releaseDate?: string;
  voteAverage: number;
  voteCount: number;
  matchScore: number;
  matchReasons: string[];
  mediaInfo?: Media;
}

interface SmartRecommendationsResponse {
  targetId: number;
  mediaType: 'movie' | 'tv';
  totalResults: number;
  results: SmartRecommendationItem[];
}

interface SimilarRecommendationsModalProps {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  show: boolean;
  onClose: () => void;
}

const SimilarRecommendationsModal: React.FC<SimilarRecommendationsModalProps> = ({
  tmdbId,
  mediaType,
  title,
  show,
  onClose,
}) => {
  const { data, error, isLoading, mutate } =
    useSWR<SmartRecommendationsResponse>(
      show ? `/api/v1/recommendations/smart/${mediaType}/${tmdbId}` : null
    );

  const [activeTab, setActiveTab] = useState<'all' | 'unrequested'>('all');

  const items = (data?.results || []).filter((item) => {
    if (activeTab === 'unrequested') {
      return !item.mediaInfo || item.mediaInfo.status === 1; // 1 = UNKNOWN / Not requested
    }
    return true;
  });

  return (
    <Transition
      as={React.Fragment}
      show={show}
      enter="transition-opacity duration-300"
      enterFrom="opacity-0"
      enterTo="opacity-100"
      leave="transition-opacity duration-300"
      leaveFrom="opacity-100"
      leaveTo="opacity-0"
    >
      <Modal
        title={`Recomendaciones Similares: ${title}`}
        subTitle="Sugerencias inteligentes generadas por afinidad temática (Suggestarr AI & Null-seerr)"
        onCancel={onClose}
        cancelText="Cerrar"
        dialogClass="w-full max-w-4xl"
      >
        <div className="space-y-4">
          {/* Header Controls & Filter */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-700/60 pb-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400">
                <SparklesIcon className="h-4 w-4" />
              </span>
              <span className="text-xs text-gray-400">
                Coincidencias encontradas:{' '}
                <strong className="text-white">
                  {data?.results?.length ?? 0}
                </strong>
              </span>
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-gray-800/80 p-1 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={`rounded-md px-3 py-1 font-medium transition ${
                  activeTab === 'all'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Todos ({data?.results?.length ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('unrequested')}
                className={`rounded-md px-3 py-1 font-medium transition ${
                  activeTab === 'unrequested'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                Solo No Solicitados
              </button>
            </div>
          </div>

          {/* Body List */}
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <LoadingSpinner />
              <p className="mt-3 text-xs text-gray-400">
                Calculando similitudes y consultando Suggestarr...
              </p>
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-6 text-center text-sm text-red-300">
              No se pudieron cargar las recomendaciones en este momento.
            </div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              No hay títulos disponibles con el filtro seleccionado.
            </div>
          ) : (
            <div className="custom-scrollbar max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {items.map((item) => {
                const year = item.releaseDate
                  ? item.releaseDate.slice(0, 4)
                  : '';
                const detailUrl = `/${item.mediaType}/${item.id}`;

                return (
                  <div
                    key={`rec-${item.mediaType}-${item.id}`}
                    className="group relative flex flex-col gap-3 rounded-xl border border-gray-700/60 bg-gray-800/40 p-3.5 transition hover:border-indigo-500/40 hover:bg-gray-800/80 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-start gap-3.5 sm:items-center">
                      {/* Poster */}
                      <Link
                        href={detailUrl}
                        className="relative h-24 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-gray-900 shadow-md ring-1 ring-white/10 transition group-hover:scale-105"
                      >
                        <CachedImage
                          type="tmdb"
                          src={
                            item.posterPath
                              ? `https://image.tmdb.org/t/p/w300_and_h450_bestv2${item.posterPath}`
                              : '/images/seerr_poster_not_found.png'
                          }
                          alt={item.title}
                          fill
                          style={{ objectFit: 'cover' }}
                        />
                      </Link>

                      {/* Content details */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            href={detailUrl}
                            className="font-semibold text-white transition hover:text-indigo-400 text-sm sm:text-base truncate"
                          >
                            {item.title}
                          </Link>
                          {year && (
                            <span className="text-xs text-gray-400 font-medium">
                              ({year})
                            </span>
                          )}

                          {/* Match percentage score */}
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset ${
                              item.matchScore >= 90
                                ? 'bg-emerald-950/80 text-emerald-300 ring-emerald-500/40'
                                : item.matchScore >= 82
                                ? 'bg-sky-950/80 text-sky-300 ring-sky-500/40'
                                : 'bg-indigo-950/80 text-indigo-300 ring-indigo-500/40'
                            }`}
                          >
                            🎯 {item.matchScore}% Match
                          </span>

                          {item.voteAverage > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-xs text-amber-400">
                              <StarIcon className="h-3.5 w-3.5" />
                              {item.voteAverage.toFixed(1)}
                            </span>
                          )}
                        </div>

                        {/* Affinity tags */}
                        <div className="flex flex-wrap gap-1">
                          {item.matchReasons.map((reason, idx) => (
                            <span
                              key={idx}
                              className="rounded-md bg-gray-700/50 px-1.5 py-0.5 text-[10px] font-medium text-gray-300"
                            >
                              {reason}
                            </span>
                          ))}
                        </div>

                        {/* Overview snippet */}
                        <p className="line-clamp-2 text-xs text-gray-400 leading-relaxed">
                          {item.overview || 'Sin descripción disponible.'}
                        </p>
                      </div>
                    </div>

                    {/* Quick action button */}
                    <div className="flex items-center justify-end gap-2 sm:flex-shrink-0 pt-2 sm:pt-0 border-t border-gray-700/30 sm:border-0">
                      {item.mediaInfo && (
                        <StatusBadgeMini
                          status={item.mediaInfo.status}
                        />
                      )}
                      <RequestButton
                        mediaType={item.mediaType}
                        tmdbId={item.id}
                        media={item.mediaInfo}
                        onUpdate={() => mutate()}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>
    </Transition>
  );
};

export default SimilarRecommendationsModal;

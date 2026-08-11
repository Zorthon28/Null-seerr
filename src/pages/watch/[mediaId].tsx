import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import Script from 'next/script';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import { ArrowLeftIcon, PlayIcon } from '@heroicons/react/24/outline';
import type { MovieDetails } from '@server/models/Movie';
import type { TvDetails } from '@server/models/Tv';

interface EpisodeResult {
  id: number;
  name: string;
  airDate: string | null;
  episodeNumber: number;
  overview: string;
  productionCode: string;
  seasonNumber: number;
  showId: number;
  stillPath?: string;
  voteAverage: number;
  voteCount: number;
}

interface SeasonWithEpisodes {
  id: number;
  name: string;
  overview: string;
  seasonNumber: number;
  episodes: EpisodeResult[];
}

const WatchPage = () => {
  const router = useRouter();
  const { mediaId, type } = router.query;

  const isMovie = type === 'movie';

  // Fetch Movie or TV Details
  const { data: mediaData, error: mediaError } = useSWR<any>(
    mediaId && type ? `/api/v1/${type}/${mediaId}` : null
  );

  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [activeEpisode, setActiveEpisode] = useState<{ season: number; episode: number } | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [streamLoading, setStreamLoading] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  // Advanced Plex playback options state
  const [plexWebUrl, setPlexWebUrl] = useState<string | null>(null);
  const [subtitleTracks, setSubtitleTracks] = useState<any[]>([]);
  const [audioTracks, setAudioTracks] = useState<any[]>([]);
  const [selectedSubtitle, setSelectedSubtitle] = useState<number | null>(null);
  const [selectedAudio, setSelectedAudio] = useState<number | null>(null);

  // Fetch episodes for TV shows
  const { data: seasonData, error: seasonError } = useSWR<SeasonWithEpisodes>(
    !isMovie && mediaId && selectedSeason !== undefined
      ? `/api/v1/tv/${mediaId}/season/${selectedSeason}`
      : null
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<any>(null);
  const lastTimeRef = useRef<number>(0);

  // Set first season when TV data loads
  useEffect(() => {
    if (!isMovie && mediaData && mediaData.seasons && mediaData.seasons.length > 0) {
      // Find first non-special season, or fallback to first season
      const firstSeason = mediaData.seasons.find((s: any) => s.seasonNumber > 0) || mediaData.seasons[0];
      setSelectedSeason(firstSeason.seasonNumber);
    }
  }, [mediaData, isMovie]);

  // Load stream URL helper
  const loadStream = (subId?: number, audId?: number) => {
    if (!mediaId) return;
    setStreamLoading(true);
    setStreamError(null);

    let url = `/api/v1/media/${mediaId}/stream?`;
    if (!isMovie && activeEpisode) {
      url += `season=${activeEpisode.season}&episode=${activeEpisode.episode}&`;
    }
    if (subId !== undefined) {
      if (subId !== -1) url += `subtitleStreamID=${subId}&`;
    } else if (selectedSubtitle !== null && selectedSubtitle !== -1) {
      url += `subtitleStreamID=${selectedSubtitle}&`;
    }
    if (audId !== undefined) {
      url += `audioStreamID=${audId}&`;
    } else if (selectedAudio !== null) {
      url += `audioStreamID=${selectedAudio}&`;
    }

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to resolve stream URL');
        return res.json();
      })
      .then((data) => {
        if (data.streamUrl) {
          setStreamUrl(data.streamUrl);
          setPlexWebUrl(data.plexWebUrl || null);
          if (data.subtitleTracks) setSubtitleTracks(data.subtitleTracks);
          if (data.audioTracks) setAudioTracks(data.audioTracks);
        } else {
          throw new Error('Stream URL not found');
        }
      })
      .catch((err) => {
        setStreamError(err.message);
      })
      .finally(() => {
        setStreamLoading(false);
      });
  };

  // Load stream URL for movies immediately when available
  useEffect(() => {
    if (isMovie && mediaId) {
      setSelectedSubtitle(null);
      setSelectedAudio(null);
      loadStream(undefined, undefined);
    }
  }, [mediaId, isMovie]);

  // Load stream URL for selected TV episode
  useEffect(() => {
    if (!isMovie && mediaId && activeEpisode) {
      setSelectedSubtitle(null);
      setSelectedAudio(null);
      setStreamUrl(null);
      loadStream(undefined, undefined);
    }
  }, [mediaId, activeEpisode, isMovie]);

  const handleSubtitleChange = (subId: number) => {
    if (videoRef.current) {
      lastTimeRef.current = videoRef.current.currentTime;
    }
    setSelectedSubtitle(subId);
    loadStream(subId, selectedAudio !== null ? selectedAudio : undefined);
  };

  const handleAudioChange = (audId: number) => {
    if (videoRef.current) {
      lastTimeRef.current = videoRef.current.currentTime;
    }
    setSelectedAudio(audId);
    loadStream(selectedSubtitle !== null ? selectedSubtitle : undefined, audId);
  };

  // Initialize Plyr and Hls.js
  useEffect(() => {
    if (!videoRef.current || !streamUrl || typeof window === 'undefined') return;

    const video = videoRef.current;
    let hls: any;

    const initPlayer = () => {
      const Hls = (window as any).Hls;
      const Plyr = (window as any).Plyr;

      if (!Hls || !Plyr) return;

      const plyrOptions = {
        controls: [
          'play-large',
          'play',
          'progress',
          'current-time',
          'duration',
          'mute',
          'volume',
          'captions',
          'settings',
          'pip',
          'airplay',
          'fullscreen',
        ],
        settings: ['quality', 'speed'],
      };

      if (Hls.isSupported()) {
        hls = new Hls();
        hls.loadSource(streamUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          playerRef.current = new Plyr(video, plyrOptions);
          if (lastTimeRef.current > 0) {
            video.currentTime = lastTimeRef.current;
            video.play().catch(() => {});
            lastTimeRef.current = 0;
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (Safari)
        video.src = streamUrl;
        playerRef.current = new Plyr(video, plyrOptions);
        if (lastTimeRef.current > 0) {
          video.currentTime = lastTimeRef.current;
          video.play().catch(() => {});
          lastTimeRef.current = 0;
        }
      }
    };

    if ((window as any).Hls && (window as any).Plyr) {
      initPlayer();
    } else {
      const checkInterval = setInterval(() => {
        if ((window as any).Hls && (window as any).Plyr) {
          clearInterval(checkInterval);
          initPlayer();
        }
      }, 100);
      return () => clearInterval(checkInterval);
    }

    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
      }
      if (hls) {
        hls.destroy();
      }
    };
  }, [streamUrl]);

  if (!mediaData && !mediaError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-gray-950 text-white">
        <LoadingSpinner />
      </div>
    );
  }

  if (mediaError || !mediaData) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-gray-950 px-4 text-center text-white">
        <h1 className="text-2xl font-bold text-red-500">Failed to load media details</h1>
        <p className="mt-2 text-gray-400">Please make sure the ID and media type are correct.</p>
        <button
          onClick={() => router.back()}
          className="mt-6 flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 hover:bg-gray-700 transition duration-300 border border-gray-700"
        >
          <ArrowLeftIcon className="h-5 w-5" />
          <span>Go Back</span>
        </button>
      </div>
    );
  }

  const titleText = isMovie ? mediaData.title : mediaData.name;
  const backdropUrl = mediaData.backdropPath
    ? `https://image.tmdb.org/t/p/original${mediaData.backdropPath}`
    : null;

  return (
    <>
      <Head>
        <title>Watching {titleText}</title>
        <link rel="stylesheet" href="https://cdn.plyr.io/3.7.8/plyr.css" />
      </Head>

      <Script src="https://cdn.jsdelivr.net/npm/hls.js@latest" strategy="beforeInteractive" />
      <Script src="https://cdn.plyr.io/3.7.8/plyr.polyfilled.js" strategy="beforeInteractive" />

      <div className="min-h-screen w-screen bg-gray-950 text-white font-sans overflow-x-hidden selection:bg-indigo-600 selection:text-white">
        {/* Floating Back Button */}
        <button
          onClick={() => {
            if (!isMovie && activeEpisode) {
              setActiveEpisode(null);
              setStreamUrl(null);
            } else {
              router.back();
            }
          }}
          className="fixed top-6 left-6 z-50 flex items-center justify-center h-12 w-12 rounded-full bg-black/40 text-white hover:bg-black/70 hover:scale-105 active:scale-95 transition-all duration-300 border border-white/10 backdrop-blur-md shadow-lg cursor-pointer"
        >
          <ArrowLeftIcon className="h-6 w-6" />
        </button>

        {/* Video Player Section */}
        {(isMovie || activeEpisode) && (
          <div className="relative w-screen bg-black flex items-center justify-center shadow-2xl" style={{ height: '70vh' }}>
            {streamLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 z-20 backdrop-blur-sm">
                <div className="text-center">
                  <LoadingSpinner />
                  <p className="mt-4 text-sm text-gray-400 font-medium animate-pulse">Initializing Stream...</p>
                </div>
              </div>
            )}

            {streamError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950/95 z-20 px-4 text-center">
                <h2 className="text-xl font-bold text-red-500">Unable to load video stream</h2>
                <p className="mt-2 text-gray-400 max-w-md">{streamError}</p>
                <p className="mt-1 text-xs text-gray-500">Ensure your Plex Media Server is active and this title is fully synced.</p>
                <button
                  onClick={() => {
                    if (isMovie) {
                      router.back();
                    } else {
                      setActiveEpisode(null);
                      setStreamUrl(null);
                    }
                  }}
                  className="mt-6 rounded-lg bg-gray-800 px-4 py-2 hover:bg-gray-700 transition duration-300 border border-gray-700 text-sm font-medium"
                >
                  Return
                </button>
              </div>
            )}

            {streamUrl && (
              <video
                ref={videoRef}
                playsInline
                controls
                crossOrigin="anonymous"
                className="w-full h-full object-contain"
              />
            )}
          </div>
        )}

        {/* Metadata & Episode Selector Section */}
        <div className="max-w-7xl mx-auto px-6 py-8">
          {(isMovie || activeEpisode) ? (
            <>
              {/* Playback Settings / Track Selectors */}
              <div className="mb-6 flex flex-wrap gap-6 items-end justify-between bg-gray-900/40 border border-gray-800/80 rounded-xl p-5 backdrop-blur-md">
                <div className="flex flex-wrap gap-6 items-center">
                  {/* Audio Track Selector */}
                  {audioTracks.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Audio Track</span>
                      <div className="relative">
                        <select
                          value={selectedAudio !== null ? selectedAudio : (audioTracks.find(t => t.selected)?.id || '')}
                          onChange={(e) => handleAudioChange(Number(e.target.value))}
                          className="appearance-none bg-gray-950 border border-gray-700/80 text-xs font-semibold text-gray-200 rounded-lg px-4 py-2 pr-10 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer hover:border-gray-600 transition"
                        >
                          {audioTracks.map((track) => (
                            <option key={track.id} value={track.id}>
                              {track.title}
                            </option>
                          ))}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-400">
                          <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                            <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                          </svg>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Subtitle Track Selector */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Subtitles</span>
                    <div className="relative">
                      <select
                        value={selectedSubtitle !== null ? selectedSubtitle : (subtitleTracks.find(t => t.selected)?.id || '-1')}
                        onChange={(e) => handleSubtitleChange(Number(e.target.value))}
                        className="appearance-none bg-gray-950 border border-gray-700/80 text-xs font-semibold text-gray-200 rounded-lg px-4 py-2 pr-10 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer hover:border-gray-600 transition"
                      >
                        <option value="-1">Off</option>
                        {subtitleTracks.map((track) => (
                          <option key={track.id} value={track.id}>
                            {track.title}
                          </option>
                        ))}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-400">
                        <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                          <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Open in Plex Button */}
                {plexWebUrl && (
                  <a
                    href={plexWebUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-yellow-500/10 text-yellow-500 hover:bg-yellow-500/25 border border-yellow-500/20 text-xs font-bold transition duration-300 shadow-lg"
                  >
                    <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                    </svg>
                    <span>Open in Plex</span>
                  </a>
                )}
              </div>

              <div className="mt-4">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 uppercase tracking-wider">
                  {isMovie ? 'Movie' : `Season ${activeEpisode?.season} Episode ${activeEpisode?.episode}`}
                </span>
                <h1 className="text-4xl font-extrabold tracking-tight mt-3 text-white">
                  {titleText}
                </h1>
                {!isMovie && activeEpisode && seasonData && (
                  <div className="mt-4">
                    {(() => {
                      const ep = seasonData.episodes.find(e => e.episodeNumber === activeEpisode.episode);
                      return ep ? (
                        <div>
                          <h2 className="text-xl font-semibold text-gray-200">{ep.name}</h2>
                          <p className="mt-2 text-gray-400 max-w-3xl leading-relaxed text-sm">{ep.overview || "No overview available for this episode."}</p>
                        </div>
                      ) : null;
                    })()}
                  </div>
                )}
                {isMovie && mediaData.overview && (
                  <p className="mt-4 text-gray-400 max-w-4xl leading-relaxed text-sm">{mediaData.overview}</p>
                )}
              </div>
            </>
          ) : (
            // TV Show Homepage Mode (backdrops, details and seasons lists)
            <div className="pt-10">
              {/* Hero header */}
              <div className="relative rounded-2xl overflow-hidden bg-cover bg-center h-80 flex items-end border border-white/5 shadow-2xl"
                   style={{ backgroundImage: backdropUrl ? `linear-gradient(to top, rgba(10,10,12,0.95) 0%, rgba(10,10,12,0.5) 100%), url(${backdropUrl})` : 'none' }}>
                <div className="p-8 w-full">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20 uppercase tracking-wider">
                    TV Show
                  </span>
                  <h1 className="text-4xl sm:text-5xl font-black mt-3 drop-shadow-md">{titleText}</h1>
                  <p className="mt-3 text-gray-300 max-w-3xl leading-relaxed text-sm line-clamp-3 drop-shadow-sm">{mediaData.overview}</p>
                </div>
              </div>

              {/* Season Selector */}
              <div className="mt-10 flex items-center justify-between border-b border-gray-800 pb-4">
                <h2 className="text-2xl font-bold tracking-tight">Episodes</h2>
                <div className="relative">
                  <select
                    value={selectedSeason}
                    onChange={(e) => setSelectedSeason(Number(e.target.value))}
                    className="appearance-none bg-gray-900 border border-gray-700 text-white rounded-lg px-4 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-semibold transition cursor-pointer"
                  >
                    {mediaData.seasons.map((season: any) => (
                      <option key={season.id} value={season.seasonNumber}>
                        {season.name}
                      </option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-400">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">
                      <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/>
                    </svg>
                  </div>
                </div>
              </div>

              {/* Episode list */}
              {(!seasonData && !seasonError) ? (
                <div className="py-20 flex justify-center">
                  <LoadingSpinner />
                </div>
              ) : seasonError || !seasonData ? (
                <div className="py-12 text-center text-gray-500">
                  Failed to load episodes for this season.
                </div>
              ) : (
                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                  {seasonData.episodes.map((ep) => {
                    const epStill = ep.stillPath
                      ? `https://image.tmdb.org/t/p/w300${ep.stillPath}`
                      : null;
                    return (
                      <div
                        key={ep.id}
                        className="flex flex-col sm:flex-row bg-gray-900/50 rounded-xl overflow-hidden border border-gray-800/80 hover:border-gray-700/80 hover:bg-gray-900/80 transition duration-300 shadow-md group"
                      >
                        {/* Still Image / Poster */}
                        <div className="relative w-full sm:w-44 h-28 bg-gray-950 flex-shrink-0 flex items-center justify-center overflow-hidden">
                          {epStill ? (
                            <img
                              src={epStill}
                              alt=""
                              className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
                            />
                          ) : (
                            <div className="text-gray-700 text-xs font-bold font-mono">S{ep.seasonNumber}E{ep.episodeNumber}</div>
                          )}
                          <button
                            onClick={() => setActiveEpisode({ season: ep.seasonNumber, episode: ep.episodeNumber })}
                            className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-black/60 opacity-0 group-hover:opacity-100 transition-all duration-300 cursor-pointer"
                          >
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg transform translate-y-2 group-hover:translate-y-0 transition duration-300">
                              <PlayIcon className="h-5 w-5 fill-current" />
                            </div>
                          </button>
                        </div>

                        {/* Text Metadata */}
                        <div className="p-4 flex flex-col justify-between">
                          <div>
                            <div className="flex items-baseline gap-2">
                              <span className="text-xs font-bold text-indigo-400">Episode {ep.episodeNumber}</span>
                              {ep.airDate && <span className="text-[10px] text-gray-500 font-medium">{new Date(ep.airDate).toLocaleDateString()}</span>}
                            </div>
                            <h3 className="text-base font-bold mt-1 text-white group-hover:text-indigo-400 transition leading-snug">{ep.name}</h3>
                            <p className="mt-2 text-xs text-gray-400 leading-relaxed line-clamp-2">{ep.overview || "No overview available for this episode."}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default WatchPage;

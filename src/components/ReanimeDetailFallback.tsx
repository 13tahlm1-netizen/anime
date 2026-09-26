"use client";

import { useEffect, useState } from "react";
import FavoriteButton from "@/components/FavoriteButton";
import EpisodeListSection from "@/components/EpisodeListSection";
import { AnimeDetail, EpisodeItem } from "@/lib/providers/types";
import { stripReanimeId } from "@/lib/providers";
import Link from "next/link";
import { Play, Calendar, CheckCircle2, Loader2, RefreshCw } from "lucide-react";

interface ReanimeDetailFallbackProps {
  id: string;
  initialIsDub?: boolean;
}

export default function ReanimeDetailFallback({
  id,
  initialIsDub = false,
}: ReanimeDetailFallbackProps) {
  const [anime, setAnime] = useState<AnimeDetail | null>(null);
  const [historyMap, setHistoryMap] = useState<Record<number, { is_completed: boolean; watch_time: number; duration: number }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const slug = stripReanimeId(id);

  const loadDetail = async () => {
    setLoading(true);
    setError(null);

    try {
      let baseUrl = "https://reanime.to";
      try {
        const settingsRes = await fetch("/api/settings/base-url?provider=reanime");
        const settingsData = await settingsRes.json();
        if (settingsData.success && settingsData.baseUrl) {
          baseUrl = settingsData.baseUrl;
        }
      } catch {}

      // 1. 디테일 & 에피소드 병렬 조회
      const [rDetail, rEps, histRes] = await Promise.all([
        fetch(`${baseUrl}/api/v1/anime/${slug}`),
        fetch(`${baseUrl}/api/v1/anime/${slug}/episodes`),
        fetch(`/api/anime/history?anime_id=${id}`).catch(() => null),
      ]);

      if (!rDetail.ok) {
        throw new Error(`작품 정보를 불러오지 못했습니다 (${rDetail.status})`);
      }

      const rawAnime = await rDetail.json();
      const epsJson = rEps.ok ? await rEps.json() : {};
      const rawEpisodes: any[] = Array.isArray(epsJson.data) ? epsJson.data : [];
      const anilistId = Number(rawAnime.anilist_id || 0);

      const title =
        rawAnime.title?.english ||
        rawAnime.title?.romaji ||
        rawAnime.title?.native ||
        rawAnime.title?.user_preferred ||
        slug;

      const poster =
        rawAnime.cover_image?.extra_large ||
        rawAnime.cover_image?.large ||
        rawAnime.cover_image?.medium ||
        rawAnime.banner_image ||
        "";

      const subEpisodes: EpisodeItem[] = rawEpisodes.map((ep: any) => {
        const epNum = Number(ep.episode_number ?? ep.number ?? 1);
        return {
          number: epNum,
          title: ep.title ? `${epNum}화 - ${ep.title}` : `${epNum}화`,
          watch_url: `${baseUrl}/watch/${slug}?ep=${epNum}&anilist=${anilistId}`,
        };
      });

      const isFinished = rawAnime.status === "Finished";
      const statusText = isFinished ? "완결" : (rawAnime.status === "Releasing" ? "방영중" : (rawAnime.status || ""));

      const detail: AnimeDetail = {
        id,
        title,
        poster,
        description: rawAnime.description ? rawAnime.description.replace(/<br\s*[\/]?>/gi, "\n") : "",
        genres: Array.isArray(rawAnime.genres) ? rawAnime.genres : [],
        sub_episodes: subEpisodes,
        dub_episodes: [],
        total_episodes: Number(rawAnime.episodes_total || rawEpisodes.length || 0),
        status_text: statusText,
        year: String(rawAnime.season_year || ""),
        is_finished: isFinished,
      };

      setAnime(detail);

      // 시청 기록 맵 빌드
      if (histRes && histRes.ok) {
        try {
          const histData = await histRes.json();
          if (histData.success && Array.isArray(histData.items)) {
            const map: Record<number, any> = {};
            for (const item of histData.items) {
              map[item.episode_number] = {
                is_completed: Boolean(item.is_completed),
                watch_time: Number(item.watch_time || 0),
                duration: Number(item.duration || 0),
              };
            }
            setHistoryMap(map);
          }
        } catch {}
      }
    } catch (err: any) {
      console.error("[ReanimeDetailFallback error]:", err);
      setError(err?.message || "작품 상세 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-3 text-purple-400">
        <Loader2 className="h-8 w-8 animate-spin" />
        <p className="text-sm font-semibold">ReAnime 작품 정보를 불러오는 중입니다...</p>
      </div>
    );
  }

  if (error || !anime) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 text-slate-400">
        <p className="text-sm text-rose-400">{error || "작품 정보를 찾을 수 없습니다."}</p>
        <button
          onClick={loadDetail}
          className="inline-flex items-center gap-2 rounded-xl border border-purple-500/30 bg-purple-600/20 px-5 py-2.5 text-xs font-bold text-purple-300 hover:bg-purple-600/30 transition"
        >
          <RefreshCw className="h-4 w-4" /> 다시 시도
        </button>
      </div>
    );
  }

  const episodes = initialIsDub ? anime.dub_episodes : anime.sub_episodes;

  return (
    <>
      {/* Banner Card */}
      <div className="overflow-hidden rounded-3xl border border-purple-500/20 bg-slate-900/60 p-6 backdrop-blur-md sm:p-8">
        <div className="flex flex-col gap-8 md:flex-row">
          {/* Poster */}
          <div className="mx-auto w-48 flex-shrink-0 sm:w-60 md:mx-0">
            <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-purple-500/30 shadow-2xl shadow-purple-900/30 bg-slate-950">
              {anime.poster && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={anime.poster}
                  alt={anime.title}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
          </div>

          {/* Info */}
          <div className="flex flex-1 flex-col justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                {anime.is_finished ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300 border border-emerald-500/30">
                    <CheckCircle2 className="h-3 w-3" /> 완결
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/20 px-3 py-1 text-xs font-semibold text-purple-300 border border-purple-500/30">
                    방영중
                  </span>
                )}
                {anime.year && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                    <Calendar className="h-3 w-3" /> {anime.year}
                  </span>
                )}
              </div>

              <h1 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl lg:text-4xl">
                {anime.title}
              </h1>

              {anime.genres.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {anime.genres.map((g) => (
                    <span
                      key={g}
                      className="rounded-lg bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-300"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}

              {anime.description && (
                <p className="mt-5 text-sm leading-relaxed text-slate-300 whitespace-pre-line line-clamp-4">
                  {anime.description}
                </p>
              )}
            </div>

            {/* Action */}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              {episodes.length > 0 && (
                <Link
                  href={`/watch/${anime.id}/1${initialIsDub ? "?dub=1" : ""}`}
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-3 font-bold text-white shadow-xl shadow-purple-600/30 transition hover:scale-105 active:scale-95 text-sm"
                >
                  <Play className="h-4 w-4 fill-white" />
                  1화 바로 시청
                </Link>
              )}
              <FavoriteButton
                animeId={anime.id}
                animeTitle={anime.title}
                animePoster={anime.poster}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Episodes Section */}
      <EpisodeListSection
        animeId={anime.id}
        subEpisodes={anime.sub_episodes}
        dubEpisodes={anime.dub_episodes}
        initialIsDub={initialIsDub}
        initialHistoryMap={historyMap}
      />
    </>
  );
}

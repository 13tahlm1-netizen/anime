"use client";

import { useEffect, useState } from "react";
import AnimeCard from "@/components/AnimeCard";
import { AnimeListItem } from "@/lib/providers/types";
import { toReanimeId } from "@/lib/providers";
import { Loader2, RefreshCw } from "lucide-react";

interface ReanimeFeedFallbackProps {
  tab: string;
  q?: string;
  genre?: string;
  page?: number;
}

export default function ReanimeFeedFallback({
  tab,
  q = "",
  genre = "",
  page = 1,
}: ReanimeFeedFallbackProps) {
  const [items, setItems] = useState<AnimeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mapItem = (raw: any, rankIdx?: number): AnimeListItem => {
    const slug = raw.anime_id || raw.slug || raw.id || "";
    const id = toReanimeId(slug);
    const title =
      raw.title?.english ||
      raw.title?.romaji ||
      raw.title?.native ||
      raw.title?.user_preferred ||
      (typeof raw.title === "string" ? raw.title : slug);

    const poster =
      raw.banner_image ||
      raw.cover_image?.large ||
      raw.cover_image?.extra_large ||
      raw.cover_image?.medium ||
      "";

    let remarks = "";
    if (raw.subbed) {
      remarks = `${raw.subbed}화`;
    } else if (raw.episodes) {
      remarks = `${raw.episodes}화`;
    } else if (raw.format) {
      remarks = raw.format;
    }

    return {
      id,
      title,
      poster,
      detail_url: `/anime/${id}`,
      remarks,
      rank: typeof rankIdx === "number" ? rankIdx + 1 : undefined,
    };
  };

  const loadFeed = async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. 베이스 URL 조회 (설정된 커스텀 URL이 있으면 사용)
      let baseUrl = "https://reanime.to";
      try {
        const settingsRes = await fetch("/api/settings/base-url?provider=reanime");
        const settingsData = await settingsRes.json();
        if (settingsData.success && settingsData.baseUrl) {
          baseUrl = settingsData.baseUrl;
        }
      } catch {}

      const limit = 20;
      const offset = Math.max(0, (page - 1) * limit);

      // 2. 검색인 경우
      if (q.trim()) {
        const query = q.trim();
        const searchTerms = [query];

        // 한글 검색어인 경우 Anissia API를 통한 영문/원어 변환 시도
        const hasHangul = /[\uac00-\ud7af]|[\u1100-\u11ff]|[\u3130-\u318f]/.test(query);
        if (hasHangul) {
          try {
            const anissiaRes = await fetch(
              `https://api.anissia.net/anime/list/0?q=${encodeURIComponent(query)}`
            );
            if (anissiaRes.ok) {
              const anissiaList = await anissiaRes.json();
              if (Array.isArray(anissiaList) && anissiaList.length > 0) {
                for (const a of anissiaList.slice(0, 3)) {
                  if (a.subject && !searchTerms.includes(a.subject)) searchTerms.push(a.subject);
                  if (a.originalSubject && !searchTerms.includes(a.originalSubject))
                    searchTerms.push(a.originalSubject);
                }
              }
            }
          } catch {}
        }

        let found: AnimeListItem[] = [];
        for (const term of searchTerms) {
          try {
            const res = await fetch(`${baseUrl}/api/v1/search?q=${encodeURIComponent(term)}&offset=${offset}&limit=${limit}`);
            if (res.ok) {
              const json = await res.json();
              const results = Array.isArray(json.results) ? json.results : [];
              if (results.length > 0) {
                found = results.map((r: any) => mapItem(r));
                break;
              }
            }
          } catch {}
        }
        setItems(found);
        return;
      }

      // 3. 장르별 탐색 (list 탭)
      if (tab === "list" && genre) {
        try {
          const queryGenre = encodeURIComponent(genre);
          const genreRes = await fetch(`${baseUrl}/api/v1/search?q=${queryGenre}&offset=${offset}&limit=${limit}`);
          if (genreRes.ok) {
            const gJson = await genreRes.json();
            const results = Array.isArray(gJson.results) ? gJson.results : [];
            setItems(results.map((r: any) => mapItem(r)));
            return;
          }
        } catch {}
      }

      // 4. 카테고리/홈 피드인 경우
      if (page > 1) {
        try {
          let searchUrl = `${baseUrl}/api/v1/search?q=*&offset=${offset}&limit=${limit}`;
          if (tab === "airing") {
            searchUrl = `${baseUrl}/api/v1/search?status=Releasing&sort=year_desc&offset=${offset}&limit=${limit}`;
          } else if (tab === "upcoming") {
            searchUrl = `${baseUrl}/api/v1/search?status=Not%20Yet%20Released&sort=popularity_desc&offset=${offset}&limit=${limit}`;
          } else if (tab === "top") {
            searchUrl = `${baseUrl}/api/v1/search?sort=score_desc&offset=${offset}&limit=${limit}`;
          }
          const res = await fetch(searchUrl);
          if (res.ok) {
            const json = await res.json();
            const results = Array.isArray(json.results) ? json.results : [];
            setItems(results.map((r: any) => mapItem(r)));
            return;
          }
        } catch {}
      }

      const homeRes = await fetch(`${baseUrl}/api/v1/home`);
      if (!homeRes.ok) {
        throw new Error(`홈 데이터를 불러오지 못했습니다 (${homeRes.status})`);
      }
      const data = await homeRes.json();

      let targetList: any[] = [];
      if (tab === "trending") {
        targetList = Array.isArray(data.trending) ? data.trending : [];
      } else if (tab === "top") {
        targetList = Array.isArray(data.top_rated) ? data.top_rated : data.trending || [];
      } else if (tab === "upcoming") {
        targetList = Array.isArray(data.upcoming) ? data.upcoming : [];
      } else {
        // Default: airing (최신 방영)
        const latest = Array.isArray(data.latest_aired) ? data.latest_aired : [];
        try {
          const sRes = await fetch(`${baseUrl}/api/v1/search?status=Releasing&sort=year_desc&limit=${limit}&offset=0`);
          if (sRes.ok) {
            const sJson = await sRes.json();
            const sResults = Array.isArray(sJson.results) ? sJson.results : [];
            const seen = new Set(latest.map((it: any) => it.anime_id));
            targetList = [...latest];
            for (const item of sResults) {
              if (!seen.has(item.anime_id)) {
                targetList.push(item);
                seen.add(item.anime_id);
              }
              if (targetList.length >= limit) break;
            }
          } else {
            targetList = latest;
          }
        } catch {
          targetList = latest;
        }
      }

      const mapped = targetList.map((item: any, idx: number) =>
        mapItem(item, tab === "top" ? idx : undefined)
      );
      setItems(mapped);
    } catch (err: any) {
      console.error("[ReanimeFeedFallback error]:", err);
      setError(err?.message || "작품 목록을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeed();
  }, [tab, q, genre, page]);

  if (loading) {
    return (
      <div className="mt-6">
        <div className="mb-4 flex items-center gap-2 text-xs text-purple-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>ReAnime 작품 목록을 불러오는 중입니다...</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col overflow-hidden rounded-2xl border border-white/5 bg-[#10182c]/40 animate-pulse"
            >
              <div className="aspect-video w-full bg-slate-800/50" />
              <div className="p-3 space-y-2">
                <div className="h-4 w-3/4 rounded bg-slate-800/60" />
                <div className="h-3 w-1/2 rounded bg-slate-800/40" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center text-slate-400 gap-3">
        <p className="text-sm text-rose-400">{error}</p>
        <button
          onClick={loadFeed}
          className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/30 bg-purple-600/20 px-4 py-2 text-xs font-semibold text-purple-300 hover:bg-purple-600/30 transition"
        >
          <RefreshCw className="h-3.5 w-3.5" /> 다시 시도
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center text-slate-400">
        <p className="text-base font-semibold">작품 목록이 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {items.map((anime) => (
        <AnimeCard key={anime.id} anime={anime} />
      ))}
    </div>
  );
}

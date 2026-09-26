import Navbar from "@/components/Navbar";
import AnimeCard from "@/components/AnimeCard";
import HistoryList, { HistoryItem } from "@/components/HistoryList";
import ReanimeFeedFallback from "@/components/ReanimeFeedFallback";
import { cookies } from "next/headers";
import {
  getProvider,
  LINKKF_GENRES,
  LINKKF_YEARS,
  LINKKF_TYPES,
  REANIME_GENRES,
  ANISSIA_PRIMARY_GENRES,
  ANISSIA_ALL_GENRES,
  AnimeListItem,
} from "@/lib/providers";
import { OHLI24_GENRES } from "@/lib/providers/ohli24";
import { getDb, initDb } from "@/lib/db";
import { checkAndPromoteNewEpisodes } from "@/lib/historyPromotion";
import { getCurrentUserId, requireAuth } from "@/lib/auth";
import Link from "next/link";
import {
  Flame,
  Tv,
  Filter,
  ChevronLeft,
  ChevronRight,
  Star,
  Clock,
  Award,
  Calendar,
  CheckCircle2,
  Zap,
  CalendarDays,
  Sparkles,
} from "lucide-react";

interface SearchParams {
  tab?: string;
  q?: string;
  page?: string;
  genre?: string;
  year?: string;
  type?: string;
  period?: "day" | "week" | "month" | "all";
  day?: string;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // 인증 검사: 관리자 없으면 /setup 강제 이동, 미로그인이면 /login 강제 이동
  await requireAuth();

  const cookieStore = await cookies();
  const rawSource = cookieStore.get("anime_source")?.value;
  const activeSource = (
    rawSource === "linkkf" ? "linkkf" : rawSource === "reanime" ? "reanime" : rawSource === "ohli24" ? "ohli24" : "anissia"
  ) as "anissia" | "linkkf" | "ohli24" | "reanime";
  const provider = getProvider(activeSource);

  const params = await searchParams;
  const defaultTab = activeSource === "anissia" ? "recent_caption" : "airing";
  const tab = params.tab || (params.q ? "search" : defaultTab);
  const q = params.q?.trim() || "";
  const page = parseInt(params.page || "1", 10) || 1;
  const genre = params.genre || "";
  const year = params.year || "";
  const typeLang = params.type || "";
  const period = params.period || "day";
  const day = params.day !== undefined ? parseInt(params.day, 10) : new Date().getDay();

  let items: AnimeListItem[] = [];
  let historyItems: HistoryItem[] = [];
  let has_next = false;
  let total_pages = 1;

  if (q) {
    const res = await provider.searchAnime(q, page);
    items = res.items;
    has_next = res.has_next;
    total_pages = res.total_pages;
  } else if (tab === "favorites") {
    const sql = getDb();
    if (sql) {
      await initDb();
      try {
        const currentUserId = await getCurrentUserId();
        const rows = await sql`
          SELECT anime_id as id, anime_title as title, anime_poster as poster, '' as detail_url, '즐겨찾기' as remarks
          FROM anime_favorites
          WHERE user_id = ${currentUserId}
          ORDER BY created_at DESC;
        `;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items = rows.map((r: any) => ({
          id: r.id,
          title: r.title,
          poster: r.poster,
          detail_url: `/anime/${r.id}`,
          remarks: "★ 즐겨찾기",
        }));
      } catch {}
    }
  } else if (tab === "history") {
    const sql = getDb();
    if (sql) {
      await initDb();
      try {
        const currentUserId = await getCurrentUserId();
        await checkAndPromoteNewEpisodes(currentUserId);

        const rows = await sql`
          SELECT * FROM (
            SELECT DISTINCT ON (anime_id)
              id, anime_id, anime_title, anime_poster, episode_number, episode_title, watch_url, watch_time, duration, is_completed, updated_at
            FROM anime_history
            WHERE user_id = ${currentUserId}
            ORDER BY anime_id, updated_at DESC
          ) t
          ORDER BY updated_at DESC
          LIMIT 50;
        `;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        historyItems = rows.map((r: any) => ({
          id: r.id,
          anime_id: r.anime_id,
          anime_title: r.anime_title,
          anime_poster: r.anime_poster || "",
          episode_number: r.episode_number,
          episode_title: r.episode_title || "",
          watch_url: r.watch_url,
          watch_time: parseFloat(r.watch_time || "0"),
          duration: parseFloat(r.duration || "0"),
          is_completed: Boolean(r.is_completed),
          updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
        }));
      } catch (e) {
        console.error("Failed to fetch history:", e);
      }
    }
  } else if (activeSource === "anissia") {
    // Anissia Hub 소스 구조: 최근 등록 자막(기본), 요일별 편성표, 글로벌 인기, 역대 명작, 장르별 탐색
    if (tab === "airing" || tab === "schedule") {
      const res = await provider.getAnimeList({ category: "airing", day });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    } else if (tab === "trending") {
      const res = await provider.getAnimeList({ category: "trending", page });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    } else if (tab === "finished") {
      const res = await provider.getAnimeList({ category: "finished", page });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    } else if (tab === "list") {
      const res = await provider.getAnimeList({ genre: genre || undefined, page });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    } else {
      // Default: recent_caption (최근 등록 자막 실시간 피드)
      const res = await provider.getAnimeList({ category: "recent_caption", page });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    }
  } else if (activeSource === "reanime") {
    // ReAnime 소스 구조: 방영작(최신방영), 실시간 트렌딩, 평점순 명작, 방영예정작, 장르별 탐색
    if (tab === "trending") {
      const res = await provider.getAnimeList({ category: "trending", page });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    } else if (tab === "top") {
      const res = await provider.getAnimeList({ category: "top", page });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    } else if (tab === "upcoming") {
      const res = await provider.getAnimeList({ category: "upcoming", page });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    } else if (tab === "list") {
      const res = await provider.getAnimeList({ genre: genre || undefined, page });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    } else {
      // Default: airing (최신 방영)
      const res = await provider.getAnimeList({ category: "airing", page });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    }
  } else if (activeSource === "ohli24") {
    // Ohli24 소스 구조: 신작 방영, 완결 애니, 카테고리 탐색
    if (tab === "finished") {
      const res = await provider.getAnimeList({ category: "finished", page });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    } else if (tab === "list") {
      const res = await provider.getAnimeList({ genre: genre || undefined, page });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    } else {
      // Default: airing
      const res = await provider.getAnimeList({ category: "airing", page });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    }
  } else {
    // Linkkf 소스 구조: 신작 방영, 인기 순위 (기간별), 카테고리 필터
    if (tab === "top") {
      const res = await provider.getAnimeList({ category: "top", page: 1, period });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    } else if (tab === "list") {
      const res = await provider.getAnimeListFiltered({ section: "2", genre, year, typeLang, page });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    } else {
      // Default: airing
      const res = await provider.getAnimeListFiltered({ section: "2", page, category: "airing" });
      items = res.items;
      has_next = res.has_next;
      total_pages = res.total_pages;
    }
  }

  const buildUrl = (newParams: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (tab) p.set("tab", tab);
    if (q) p.set("q", q);
    if (genre) p.set("genre", genre);
    if (year) p.set("year", year);
    if (typeLang) p.set("type", typeLang);
    if (period) p.set("period", period);
    if (params.day !== undefined) p.set("day", String(day));
    p.set("page", String(page));

    Object.entries(newParams).forEach(([k, v]) => {
      if (v === "") p.delete(k);
      else p.set(k, String(v));
    });

    return `/?${p.toString()}`;
  };

  const genresToDisplay =
    activeSource === "anissia"
      ? ANISSIA_PRIMARY_GENRES.map((g) => [g, g] as [string, string])
      : activeSource === "reanime"
      ? REANIME_GENRES
      : activeSource === "ohli24"
      ? OHLI24_GENRES
      : LINKKF_GENRES;

  let sectionTitle = "";
  let sectionSubtitle = "";

  if (q) {
    sectionTitle = `"${q}" 검색 결과 (${items.length}개)`;
  } else if (activeSource === "anissia") {
    const dayNames = ["일", "월", "화", "수", "목", "금", "토", "기타"];
    if (tab === "recent_caption") {
      sectionTitle = "⚡ 최근 등록 자막 피드";
      sectionSubtitle = "국내 자막 제작자가 방금 등록/갱신한 최신 회차 자막 실시간 현황";
    } else if (tab === "airing" || tab === "schedule") {
      sectionTitle = `📅 ${dayNames[day] || "신작"}요일 실시간 방영 시간표`;
      sectionSubtitle = "애니시아 공식 시간표 기반 실시간 방영작 및 자막 제작 현황";
    } else if (tab === "trending") {
      sectionTitle = "🔥 글로벌 인기 랭킹 TOP 30";
      sectionSubtitle = "전 세계 애니 팬덤(AniList) 기준 실시간 최고 인기 화제작";
    } else if (tab === "finished") {
      sectionTitle = "⭐ 역대 최고 명작 (Top Rated)";
      sectionSubtitle = "글로벌 평점이 가장 높은 검증된 역대 명작 컬렉션";
    } else if (tab === "list") {
      sectionTitle = genre ? `🎭 ${genre} 장르 애니메이션` : "🎭 40대 장르별 탐색";
      sectionSubtitle = "선택하신 장르에 해당하는 작품 목록입니다.";
    }
  } else if (activeSource === "reanime") {
    if (tab === "trending") {
      sectionTitle = "🔥 실시간 트렌딩 인기작";
      sectionSubtitle = "전 세계 애니 팬들이 지금 가장 많이 시청 중인 화제작";
    } else if (tab === "top") {
      sectionTitle = "⭐ 역대 최고 평점 명작";
      sectionSubtitle = "글로벌 평점이 가장 높은 검증된 명작 애니메이션";
    } else if (tab === "airing") {
      sectionTitle = "📺 최신 방영 에피소드";
      sectionSubtitle = "실시간 방영 중인 신작 애니메이션 업데이트";
    } else if (tab === "upcoming") {
      sectionTitle = "📅 방영 예정 기대작";
      sectionSubtitle = "앞으로 공개될 글로벌 기대작 라인업";
    } else if (tab === "list") {
      sectionTitle = genre ? `🎭 ${genre} 장르 작품` : "🎭 장르별 애니메이션 탐색";
      sectionSubtitle = "선택하신 장르에 해당하는 작품 목록입니다.";
    }
  } else if (activeSource === "ohli24") {
    if (tab === "airing") {
      sectionTitle = "📺 신작 방영 목록";
      sectionSubtitle = "현재 방송 중인 최신 애니메이션";
    } else if (tab === "finished") {
      sectionTitle = "✅ 완결 애니메이션";
      sectionSubtitle = "정주행하기 좋은 전편 완결 작품";
    } else if (tab === "list") {
      sectionTitle = genre ? `🎭 ${genre} 장르 작품` : "🎭 카테고리별 애니메이션";
    }
  } else {
    if (tab === "airing") {
      sectionTitle = "📺 실시간 방영 애니";
    } else if (tab === "top") {
      sectionTitle = "🔥 실시간 인기 순위";
    } else if (tab === "list") {
      sectionTitle = "🎭 카테고리 필터 탐색";
    }
  }

  return (
    <div className="min-h-screen bg-[#0b0f19]">
      <Navbar />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Navigation Tabs - 스트리밍 사이트별 개별화 */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-purple-500/20 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            {activeSource === "anissia" ? (
              <>
                <Link
                  href="/?tab=recent_caption"
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === "recent_caption"
                      ? "bg-emerald-600 text-white shadow-lg shadow-emerald-500/25"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <Zap className="h-4 w-4 text-emerald-400" />
                  최근 등록 자막
                </Link>

                <Link
                  href={`/?tab=airing&day=${new Date().getDay()}`}
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === "airing" || tab === "schedule"
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <CalendarDays className="h-4 w-4 text-purple-400" />
                  요일별 편성표
                </Link>

                <Link
                  href="/?tab=trending"
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === "trending"
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <Flame className="h-4 w-4 text-orange-400" />
                  글로벌 인기
                </Link>

                <Link
                  href="/?tab=finished"
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === "finished"
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <Award className="h-4 w-4 text-amber-400" />
                  역대 명작
                </Link>

                <Link
                  href="/?tab=list"
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === "list"
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <Filter className="h-4 w-4 text-pink-400" />
                  40대 장르 탐색
                </Link>
              </>
            ) : activeSource === "reanime" ? (
              <>
                <Link
                  href="/?tab=airing"
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === "airing"
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <Tv className="h-4 w-4 text-emerald-400" />
                  최신 방영
                </Link>

                <Link
                  href="/?tab=trending"
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === "trending"
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <Flame className="h-4 w-4 text-orange-400" />
                  실시간 트렌딩
                </Link>

                <Link
                  href="/?tab=top"
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === "top"
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <Award className="h-4 w-4 text-yellow-400" />
                  최고 평점작
                </Link>

                <Link
                  href="/?tab=upcoming"
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === "upcoming"
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <Calendar className="h-4 w-4 text-blue-400" />
                  방영 예정작
                </Link>

                <Link
                  href="/?tab=list"
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === "list"
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <Filter className="h-4 w-4 text-pink-400" />
                  장르별 탐색
                </Link>
              </>
            ) : activeSource === "ohli24" ? (
              <>
                <Link
                  href="/?tab=airing"
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === "airing"
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <Tv className="h-4 w-4" />
                  신작 방영
                </Link>

                <Link
                  href="/?tab=finished"
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === "finished"
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  완결 애니
                </Link>

                <Link
                  href="/?tab=list"
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === "list"
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <Filter className="h-4 w-4" />
                  카테고리 탐색
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/?tab=airing"
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === "airing"
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <Tv className="h-4 w-4" />
                  신작 방영
                </Link>

                <Link
                  href="/?tab=top"
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === "top"
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <Flame className="h-4 w-4" />
                  인기 순위
                </Link>

                <Link
                  href="/?tab=list"
                  className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    tab === "list"
                      ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                      : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                  }`}
                >
                  <Filter className="h-4 w-4" />
                  카테고리 탐색
                </Link>
              </>
            )}

            <Link
              href="/?tab=favorites"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "favorites"
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
              즐겨찾기
            </Link>

            <Link
              href="/?tab=history"
              className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition ${
                tab === "history"
                  ? "bg-purple-600 text-white shadow-lg shadow-purple-500/25"
                  : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
              }`}
            >
              <Clock className="h-4 w-4 text-purple-400" />
              시청 기록
            </Link>
          </div>

          {/* Top Ranking Period Switcher (Linkkf 전용) */}
          {activeSource === "linkkf" && tab === "top" && (
            <div className="flex items-center gap-1 rounded-lg bg-slate-900/80 p-1 text-xs border border-purple-500/20">
              {(
                [
                  ["day", "일간"],
                  ["week", "주간"],
                  ["month", "월간"],
                  ["all", "전체"],
                ] as const
              ).map(([key, label]) => (
                <Link
                  key={key}
                  href={buildUrl({ period: key, page: 1 })}
                  className={`rounded-md px-2.5 py-1 transition ${
                    period === key ? "bg-purple-600 text-white font-bold" : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {label}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* 요일별 신작 편성표 서브 탭 바 (애니시아 허브 전용) */}
        {activeSource === "anissia" && (tab === "airing" || tab === "schedule") && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5 rounded-2xl bg-slate-900/60 p-2 border border-purple-500/20 backdrop-blur-md">
            {[
              { d: 1, label: "월요일" },
              { d: 2, label: "화요일" },
              { d: 3, label: "수요일" },
              { d: 4, label: "목요일" },
              { d: 5, label: "금요일" },
              { d: 6, label: "토요일" },
              { d: 0, label: "일요일" },
              { d: 7, label: "기타/신작" },
            ].map(({ d, label }) => {
              const isToday = new Date().getDay() === d;
              const isSelected = day === d;
              return (
                <Link
                  key={d}
                  href={`/?tab=airing&day=${d}`}
                  className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                    isSelected
                      ? "bg-purple-600 text-white shadow-md shadow-purple-900/30"
                      : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  <span>{label}</span>
                  {isToday && (
                    <span className="rounded bg-emerald-500/20 border border-emerald-500/40 px-1 text-[9px] text-emerald-300">
                      오늘
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}

        {/* Category Filters (Only on 'list' tab) - 스트리밍 사이트별 완전 맞춤형 탐색 UI */}
        {tab === "list" && (
          <div className="mt-6 rounded-2xl border border-purple-500/20 bg-slate-900/60 p-5 backdrop-blur-md">
            {activeSource === "anissia" ? (
              /* =================== 0. Anissia Hub 40대 장르 맞춤 탐색 =================== */
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-500/20 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 items-center rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 px-2.5 text-[11px] font-extrabold text-white shadow-sm">
                      애니시아 40대 장르 카탈로그
                    </span>
                    <span className="text-xs text-slate-400">100% 한글 자막 보장 애니메이션 탐색</span>
                  </div>
                  {genre && (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-300">
                      <span>선택된 장르:</span>
                      <span className="font-bold text-white underline underline-offset-4">{genre}</span>
                      <Link
                        href={buildUrl({ genre: "", page: 1 })}
                        className="ml-1 rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-white"
                      >
                        초기화
                      </Link>
                    </div>
                  )}
                </div>

                {/* 12대 대표 장르 칩 */}
                <div className="flex items-start gap-2 text-xs pt-1">
                  <span className="font-bold text-emerald-400 mr-1 min-w-[55px] pt-1">인기 장르:</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ANISSIA_PRIMARY_GENRES.map((g) => {
                      const isSelected = genre === g;
                      return (
                        <Link
                          key={g}
                          href={buildUrl({ genre: isSelected ? "" : g, page: 1 })}
                          className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                            isSelected
                              ? "bg-emerald-600 text-white font-bold shadow-md shadow-emerald-900/30"
                              : "border border-white/10 bg-slate-800/80 text-slate-300 hover:border-emerald-500/40 hover:bg-slate-800"
                          }`}
                        >
                          {g}
                        </Link>
                      );
                    })}
                  </div>
                </div>

                {/* 전체 40개 세부 장르 칩 그리드 */}
                <div className="flex items-start gap-2 text-xs pt-1 border-t border-white/5">
                  <span className="font-bold text-purple-400 mr-1 min-w-[55px] pt-1">전체 장르:</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ANISSIA_ALL_GENRES.map((g) => {
                      const isSelected = genre === g;
                      return (
                        <Link
                          key={g}
                          href={buildUrl({ genre: isSelected ? "" : g, page: 1 })}
                          className={`rounded-lg px-2 py-0.5 text-[11px] transition ${
                            isSelected
                              ? "bg-purple-600 text-white font-bold shadow-sm"
                              : "border border-white/5 bg-slate-900/80 text-slate-400 hover:text-white hover:border-purple-500/30"
                          }`}
                        >
                          {g}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : activeSource === "reanime" ? (
              /* =================== 1. ReAnime 전용 맞춤 탐색 =================== */
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-500/20 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 items-center rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 px-2.5 text-[11px] font-extrabold text-white shadow-sm">
                      ReAnime 글로벌 카탈로그
                    </span>
                    <span className="text-xs text-slate-400">22,000+ 편의 작품 탐색</span>
                  </div>
                  {genre && (
                    <div className="flex items-center gap-1.5 text-xs text-purple-300">
                      <span>선택된 장르:</span>
                      <span className="font-bold text-white underline underline-offset-4">{genre}</span>
                      <Link
                        href={buildUrl({ genre: "", page: 1 })}
                        className="ml-1 rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-white"
                      >
                        초기화
                      </Link>
                    </div>
                  )}
                </div>

                {/* 테마 퀵 필터 */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-bold text-purple-400 mr-1 min-w-[36px]">추천:</span>
                  <Link
                    href="/?tab=airing"
                    className="flex items-center gap-1 rounded-lg border border-purple-500/30 bg-purple-600/10 px-2.5 py-1 text-purple-200 transition hover:bg-purple-600/20"
                  >
                    <Tv className="h-3 w-3 text-emerald-400" />
                    최신 방영작
                  </Link>
                  <Link
                    href="/?tab=trending"
                    className="flex items-center gap-1 rounded-lg border border-purple-500/30 bg-purple-600/10 px-2.5 py-1 text-purple-200 transition hover:bg-purple-600/20"
                  >
                    <Flame className="h-3 w-3 text-orange-400" />
                    인기 화제작
                  </Link>
                  <Link
                    href="/?tab=top"
                    className="flex items-center gap-1 rounded-lg border border-purple-500/30 bg-purple-600/10 px-2.5 py-1 text-purple-200 transition hover:bg-purple-600/20"
                  >
                    <Award className="h-3 w-3 text-yellow-400" />
                    최고 평점 명작
                  </Link>
                  <Link
                    href="/?tab=upcoming"
                    className="flex items-center gap-1 rounded-lg border border-purple-500/30 bg-purple-600/10 px-2.5 py-1 text-purple-200 transition hover:bg-purple-600/20"
                  >
                    <Calendar className="h-3 w-3 text-blue-400" />
                    방영 예정작
                  </Link>
                </div>

                {/* ReAnime 장르 칩 그리드 */}
                <div className="flex items-start gap-2 text-xs pt-1">
                  <span className="font-bold text-purple-400 mr-1 min-w-[36px] pt-1">장르:</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link
                      href={buildUrl({ genre: "", page: 1 })}
                      className={`rounded-xl px-3 py-1.5 text-xs transition ${
                        !genre
                          ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold shadow-md shadow-purple-500/30"
                          : "border border-white/5 bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white"
                      }`}
                    >
                      전체 보기
                    </Link>
                    {REANIME_GENRES.map(([gKo, gEn]) => (
                      <Link
                        key={gKo}
                        href={buildUrl({ genre: gKo, page: 1 })}
                        className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs transition ${
                          genre === gKo
                            ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold shadow-md shadow-purple-500/30"
                            : "border border-white/5 bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white"
                        }`}
                      >
                        <span>{gKo}</span>
                        <span className="text-[10px] opacity-60">({gEn})</span>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            ) : activeSource === "ohli24" ? (
              /* =================== 2. Ohli24(애니24) 전용 맞춤 탐색 =================== */
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-500/20 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 items-center rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 px-2.5 text-[11px] font-extrabold text-white shadow-sm">
                      애니24 한국어 서브컬처 카탈로그
                    </span>
                    <span className="text-xs text-slate-400">한국어 특화 스트리밍</span>
                  </div>
                  {genre && (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-300">
                      <span>선택 태그:</span>
                      <span className="font-bold text-white underline underline-offset-4">{genre}</span>
                      <Link
                        href={buildUrl({ genre: "", page: 1 })}
                        className="ml-1 rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-white"
                      >
                        초기화
                      </Link>
                    </div>
                  )}
                </div>

                {/* 상태 퀵 전환 */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-bold text-emerald-400 mr-1 min-w-[36px]">구분:</span>
                  <Link
                    href="/?tab=airing"
                    className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-600/10 px-2.5 py-1 text-emerald-200 transition hover:bg-emerald-600/20"
                  >
                    <Tv className="h-3 w-3 text-emerald-400" />
                    신작 방영작
                  </Link>
                  <Link
                    href="/?tab=finished"
                    className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-600/10 px-2.5 py-1 text-emerald-200 transition hover:bg-emerald-600/20"
                  >
                    <CheckCircle2 className="h-3 w-3 text-teal-400" />
                    완결 애니 정주행
                  </Link>
                </div>

                {/* 애니24 서브컬처 특화 장르 태그 칩 */}
                <div className="flex items-start gap-2 text-xs pt-1">
                  <span className="font-bold text-emerald-400 mr-1 min-w-[36px] pt-1">테마:</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link
                      href={buildUrl({ genre: "", page: 1 })}
                      className={`rounded-xl px-3 py-1.5 text-xs transition ${
                        !genre
                          ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold shadow-md shadow-emerald-500/30"
                          : "border border-white/5 bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white"
                      }`}
                    >
                      전체 태그
                    </Link>
                    {OHLI24_GENRES.map(([gKey, gLabel]) => (
                      <Link
                        key={gKey}
                        href={buildUrl({ genre: gKey, page: 1 })}
                        className={`rounded-xl px-3 py-1.5 text-xs transition ${
                          genre === gKey
                            ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold shadow-md shadow-emerald-500/30"
                            : "border border-white/5 bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-white"
                        }`}
                      >
                        #{gLabel}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              /* =================== 3. Linkkf 전용 맞춤 탐색 =================== */
              <div className="space-y-4">
                <div className="flex items-center gap-2 border-b border-purple-500/20 pb-3">
                  <span className="flex h-6 items-center rounded-full bg-gradient-to-r from-indigo-600 to-purple-600 px-2.5 text-[11px] font-extrabold text-white shadow-sm">
                    Linkkf 고화질 아카이브
                  </span>
                  <span className="text-xs text-slate-400">타입 • 장르 • 연도별 복합 필터</span>
                </div>

                {/* Types (TV / Movie / OVA) */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-bold text-purple-400 mr-2 min-w-[36px]">타입:</span>
                  <Link
                    href={buildUrl({ type: "", page: 1 })}
                    className={`rounded-lg px-2.5 py-1 transition ${
                      !typeLang ? "bg-purple-600 text-white font-bold" : "text-slate-400 hover:bg-slate-800"
                    }`}
                  >
                    전체
                  </Link>
                  {LINKKF_TYPES.map(([tKey, tLabel]) => (
                    <Link
                      key={tKey}
                      href={buildUrl({ type: tKey, page: 1 })}
                      className={`rounded-lg px-2.5 py-1 transition ${
                        typeLang === tKey ? "bg-purple-600 text-white font-bold" : "text-slate-400 hover:bg-slate-800"
                      }`}
                    >
                      {tLabel}
                    </Link>
                  ))}
                </div>

                {/* Genres */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-bold text-purple-400 mr-2 min-w-[36px]">장르:</span>
                  <Link
                    href={buildUrl({ genre: "", page: 1 })}
                    className={`rounded-lg px-2.5 py-1 transition ${
                      !genre ? "bg-purple-600 text-white font-bold" : "text-slate-400 hover:bg-slate-800"
                    }`}
                  >
                    전체
                  </Link>
                  {LINKKF_GENRES.map(([gKey, gLabel]) => (
                    <Link
                      key={gKey}
                      href={buildUrl({ genre: gKey, page: 1 })}
                      className={`rounded-lg px-2.5 py-1 transition ${
                        genre === gKey ? "bg-purple-600 text-white font-bold" : "text-slate-400 hover:bg-slate-800"
                      }`}
                    >
                      {gLabel}
                    </Link>
                  ))}
                </div>

                {/* Years (1990 ~ 현재 연도 전체) */}
                <div className="flex items-start gap-1.5 text-xs">
                  <span className="font-bold text-purple-400 mr-2 min-w-[36px] pt-1">연도:</span>
                  <div className="flex flex-wrap items-center gap-1.5 max-h-28 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-purple-500/30">
                    <Link
                      href={buildUrl({ year: "", page: 1 })}
                      className={`rounded-lg px-2.5 py-1 transition ${
                        !year ? "bg-purple-600 text-white font-bold" : "text-slate-400 hover:bg-slate-800"
                      }`}
                    >
                      전체
                    </Link>
                    {LINKKF_YEARS.map((y) => (
                      <Link
                        key={y}
                        href={buildUrl({ year: y, page: 1 })}
                        className={`rounded-lg px-2.5 py-1 transition ${
                          year === y ? "bg-purple-600 text-white font-bold" : "text-slate-400 hover:bg-slate-800"
                        }`}
                      >
                        {y}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Section Title Header */}
        {sectionTitle && (
          <div className="mt-6 mb-2">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              {sectionTitle}
            </h2>
            {sectionSubtitle && (
              <p className="mt-1 text-xs text-slate-400">{sectionSubtitle}</p>
            )}
          </div>
        )}

        {/* History Tab vs General Grid */}
        {tab === "history" ? (
          <div className="mt-6">
            <HistoryList initialItems={historyItems} />
          </div>
        ) : (
          <>
            {/* Anime Grid */}
            {items.length > 0 ? (
              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {items.map((anime, idx) => (
                  <AnimeCard key={`${anime.id}-${idx}`} anime={anime} />
                ))}
              </div>
            ) : activeSource === "reanime" && tab !== "favorites" ? (
              <ReanimeFeedFallback tab={tab} q={q} genre={genre} page={page} />
            ) : (
              <div className="flex min-h-[300px] flex-col items-center justify-center text-slate-400">
                <p className="text-base font-semibold">
                  {tab === "favorites"
                    ? "등록된 즐겨찾기가 없습니다. 마음에 드는 작품을 추가해 보세요!"
                    : "작품 목록이 없습니다."}
                </p>
              </div>
            )}
          </>
        )}

        {/* Pagination: ReAnime 모든 탭 및 애니24, Linkkf에서 페이지 이동 가능 */}
        {tab !== "favorites" && tab !== "history" && !(activeSource === "linkkf" && tab === "top") && total_pages > 1 && (
          <div className="mt-10 flex items-center justify-center gap-2">
            {page > 1 && (
              <Link
                href={buildUrl({ page: page - 1 })}
                className="flex items-center gap-1 rounded-xl border border-purple-500/20 bg-slate-900/80 px-4 py-2 text-sm text-slate-300 transition hover:border-purple-500 hover:text-white"
              >
                <ChevronLeft className="h-4 w-4" />
                이전
              </Link>
            )}

            <span className="px-4 py-2 text-sm font-semibold text-purple-300">
              {page} / {total_pages || 1} 페이지
            </span>

            {has_next && (
              <Link
                href={buildUrl({ page: page + 1 })}
                className="flex items-center gap-1 rounded-xl border border-purple-500/20 bg-slate-900/80 px-4 py-2 text-sm text-slate-300 transition hover:border-purple-500 hover:text-white"
              >
                다음
                <ChevronRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

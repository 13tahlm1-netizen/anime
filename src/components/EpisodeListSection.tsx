"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import {
  Film,
  ArrowUpDown,
  Search,
  CheckCircle2,
  Play,
  Volume2,
  Loader2,
} from "lucide-react";
import { EpisodeItem } from "@/lib/linkkf";

interface EpisodeListSectionProps {
  animeId: string;
  subEpisodes: EpisodeItem[];
  dubEpisodes: EpisodeItem[];
  initialIsDub?: boolean;
  initialHistoryMap?: Record<number, EpisodeHistory>;
}

export interface EpisodeHistory {
  watch_time: number;
  duration: number;
  is_completed: boolean;
}

const CHUNK_SIZE = 50;

export default function EpisodeListSection({
  animeId,
  subEpisodes,
  dubEpisodes,
  initialIsDub = false,
  initialHistoryMap,
}: EpisodeListSectionProps) {
  const [isDub, setIsDub] = useState<boolean>(initialIsDub);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [selectedRange, setSelectedRange] = useState<{ min: number; max: number } | null>(null);
  const [jumpInput, setJumpInput] = useState<string>("");
  const [highlightedEp, setHighlightedEp] = useState<number | null>(null);
  const [loadingEp, setLoadingEp] = useState<number | null>(null);
  const [historyMap, setHistoryMap] = useState<Record<number, EpisodeHistory>>(initialHistoryMap || {});
  const containerRef = useRef<HTMLDivElement>(null);

  // 1. 시청 기록 조회 및 맵핑 (회차별 진행도 및 완주 상태)
  useEffect(() => {
    let isCancelled = false;

    // 클라우드 DB 기록 조회
    fetch(`/api/anime/history?anime_id=${animeId}`)
      .then((r) => r.json())
      .then((data) => {
        if (isCancelled || !data.success || !Array.isArray(data.items)) return;

        const map: Record<number, EpisodeHistory> = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data.items.forEach((item: any) => {
          if (item.episode_number > 0) {
            map[item.episode_number] = {
              watch_time: parseFloat(item.watch_time || item.current_time || "0"),
              duration: parseFloat(item.duration || "0"),
              is_completed: Boolean(item.is_completed),
            };
          }
        });

        // 로컬스토리지 백업 데이터 병합
        for (let i = 1; i <= 2000; i++) {
          const localSec = localStorage.getItem(`anime_progress_${animeId}_ep${i}`);
          if (localSec && !map[i]) {
            const sec = parseFloat(localSec);
            if (sec > 5) {
              map[i] = { watch_time: sec, duration: 0, is_completed: false };
            }
          }
        }

        setHistoryMap(map);
      })
      .catch((e) => console.error("[EpisodeListSection] History error:", e));

    return () => {
      isCancelled = true;
    };
  }, [animeId]);

  // 2. 현재 선택된 판본(자막/더빙)에 따른 회차 목록
  const currentEpisodes = useMemo(() => {
    return isDub ? dubEpisodes : subEpisodes;
  }, [isDub, dubEpisodes, subEpisodes]);

  // 3. 50화 단위 구간(Ranges) 계산
  const ranges = useMemo(() => {
    if (currentEpisodes.length <= CHUNK_SIZE) return [];

    const epNums = currentEpisodes.map((e) => e.number).filter((n) => n > 0);
    if (epNums.length === 0) return [];

    const minEp = Math.min(...epNums);
    const maxEp = Math.max(...epNums);

    const list: Array<{ min: number; max: number }> = [];
    const startBase = Math.floor((minEp - 1) / CHUNK_SIZE) * CHUNK_SIZE + 1;

    for (let s = startBase; s <= maxEp; s += CHUNK_SIZE) {
      const e = s + CHUNK_SIZE - 1;
      const hasCards = currentEpisodes.some((ep) => ep.number >= s && ep.number <= e);
      if (hasCards) {
        list.push({ min: s, max: e });
      }
    }

    if (sortOrder === "desc") {
      return [...list].reverse();
    }
    return list;
  }, [currentEpisodes, sortOrder]);

  // 4. 기본 선택 구간 자동 초기화
  useEffect(() => {
    if (ranges.length === 0) {
      setSelectedRange(null);
      return;
    }

    // 마지막으로 시청한 회차가 있는 구간을 우선 자동 선택
    const watchedEps = Object.keys(historyMap)
      .map(Number)
      .filter((n) => n > 0)
      .sort((a, b) => b - a);

    if (watchedEps.length > 0) {
      const lastWatched = watchedEps[0];
      const matchedRange = ranges.find((r) => lastWatched >= r.min && lastWatched <= r.max);
      if (matchedRange) {
        setSelectedRange(matchedRange);
        return;
      }
    }

    // 기본 첫 번째 구간 선택
    setSelectedRange(ranges[0]);
  }, [ranges, historyMap]);

  // 5. 정렬 및 필터링된 표시용 에피소드 목록
  const displayEpisodes = useMemo(() => {
    let list = [...currentEpisodes];

    // 정렬 (오름차순 / 내림차순)
    if (sortOrder === "asc") {
      list.sort((a, b) => a.number - b.number);
    } else {
      list.sort((a, b) => b.number - a.number);
    }

    // 50화 단위 구간 필터
    if (selectedRange && ranges.length > 0) {
      list = list.filter(
        (ep) => ep.number >= selectedRange.min && ep.number <= selectedRange.max
      );
    }

    return list;
  }, [currentEpisodes, sortOrder, selectedRange, ranges]);

  // 6. 회차 정렬 토글 핸들러
  const toggleSort = () => {
    setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
  };

  // 7. 빠른 회차 점프 이동 핸들러
  const handleJump = (e: React.FormEvent) => {
    e.preventDefault();
    const targetNum = parseInt(jumpInput.trim(), 10);
    if (isNaN(targetNum) || targetNum <= 0) return;

    const exists = currentEpisodes.some((ep) => ep.number === targetNum);
    if (!exists) {
      alert(`${targetNum}화는 등록되어 있지 않은 회차입니다.`);
      return;
    }

    // 50화 구간이 활성화되어 있다면 해당 회차의 구간으로 자동 전환
    if (ranges.length > 0) {
      const matched = ranges.find((r) => targetNum >= r.min && targetNum <= r.max);
      if (matched) {
        setSelectedRange(matched);
      }
    }

    setHighlightedEp(targetNum);
    setJumpInput("");

    setTimeout(() => {
      const el = document.getElementById(`ep-card-${targetNum}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 100);

    setTimeout(() => {
      setHighlightedEp(null);
    }, 2800);
  };

  return (
    <div ref={containerRef} className="mt-10">
      {/* 툴바 상단: 타이틀 & 판본 선택 & 정렬 & 회차 검색 점프 */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-purple-500/20 pb-4">
        {/* 타이틀 및 에피소드 수 */}
        <div className="flex items-center gap-2">
          <Film className="h-5 w-5 text-purple-400" />
          <h2 className="text-xl font-bold text-white">회차 목록</h2>
          <span className="text-xs text-slate-400">
            ({currentEpisodes.length}개 에피소드)
          </span>
        </div>

        {/* 컨트롤 영역 */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* 자막판 / 더빙판 슬림 스위치 */}
          {dubEpisodes.length > 0 && (
            <div className="flex items-center rounded-xl bg-slate-900/80 p-1 border border-purple-500/20 text-xs">
              <button
                type="button"
                onClick={() => setIsDub(false)}
                className={`flex items-center gap-1 rounded-lg px-3 py-1.5 font-semibold transition ${
                  !isDub
                    ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <span>자막판</span>
                <span className="text-[10px] opacity-75">({subEpisodes.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setIsDub(true)}
                className={`flex items-center gap-1 rounded-lg px-3 py-1.5 font-semibold transition ${
                  isDub
                    ? "bg-purple-600 text-white shadow-md shadow-purple-600/30"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Volume2 className="h-3 w-3" />
                <span>더빙판</span>
                <span className="text-[10px] opacity-75">({dubEpisodes.length})</span>
              </button>
            </div>
          )}

          {/* 회차 정렬 토글 버튼 */}
          <button
            type="button"
            onClick={toggleSort}
            className="flex items-center gap-1.5 rounded-xl border border-purple-500/20 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-purple-500/50 hover:bg-slate-800 transition"
            title="회차 정렬 순서 변경"
          >
            <ArrowUpDown className="h-3.5 w-3.5 text-purple-400" />
            <span>{sortOrder === "asc" ? "1화부터" : "최신화부터"}</span>
          </button>

          {/* 회차 직접 번호 입력 점프창 */}
          <form onSubmit={handleJump} className="flex items-center">
            <div className="relative flex items-center">
              <input
                type="number"
                min="1"
                placeholder="회차 이동"
                value={jumpInput}
                onChange={(e) => setJumpInput(e.target.value)}
                className="w-24 rounded-l-xl border border-purple-500/20 bg-slate-900/80 px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-purple-500"
              />
              <button
                type="submit"
                className="flex items-center gap-1 rounded-r-xl bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-500 transition shadow-sm"
              >
                <Search className="h-3 w-3" />
                이동
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* 50화 단위 구간 선택 바 (50화 초과 장편 애니일 때 자동 활성화) */}
      {ranges.length > 0 && (
        <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
          <span className="text-xs font-bold text-purple-400 flex-shrink-0 mr-1">
            구간 선택:
          </span>
          {ranges.map((range, idx) => {
            const isSelected =
              selectedRange?.min === range.min && selectedRange?.max === range.max;
            const hasWatchedInRange = currentEpisodes.some((ep) => {
              if (ep.number < range.min || ep.number > range.max) return false;
              const h = historyMap[ep.number];
              return h && (h.is_completed || h.watch_time > 10);
            });

            return (
              <button
                key={idx}
                type="button"
                onClick={() => setSelectedRange(range)}
                className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold transition ${
                  isSelected
                    ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-900/40 ring-1 ring-purple-400"
                    : "border border-purple-500/20 bg-slate-900/70 text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
              >
                <span>{range.min} - {range.max}화</span>
                {hasWatchedInRange && (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* 회차 그리드 목록 */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
        {displayEpisodes.map((ep) => {
          const watched = historyMap[ep.number];
          let pct = 0;
          let isCompleted = false;

          if (watched) {
            if (watched.is_completed) {
              isCompleted = true;
              pct = 100;
            } else if (watched.duration > 0) {
              pct = Math.min(100, Math.round((watched.watch_time / watched.duration) * 100));
              if (pct >= 85 || (watched.duration - watched.watch_time < 90 && watched.watch_time > 120)) {
                isCompleted = true;
                pct = 100;
              }
            } else if (watched.watch_time > 10) {
              pct = 50;
            }
          }

          const hasProgress = watched && (isCompleted || pct > 0 || watched.watch_time > 0);
          const isHighlighted = highlightedEp === ep.number;

          const isLoadingThis = loadingEp === ep.number;
          const isOtherLoading = loadingEp !== null && !isLoadingThis;

          return (
            <Link
              key={ep.number}
              id={`ep-card-${ep.number}`}
              href={`/watch/${animeId}/${ep.number}${isDub ? "?dub=1" : ""}`}
              onClick={() => setLoadingEp(ep.number)}
              className={`group relative flex flex-col items-center justify-center rounded-2xl border p-4 transition duration-200 overflow-hidden text-decoration-none ${
                isLoadingThis
                  ? "border-purple-400 bg-purple-900/60 shadow-2xl shadow-purple-600/60 ring-2 ring-purple-400 scale-105 pointer-events-none cursor-wait"
                  : isOtherLoading
                  ? "pointer-events-none opacity-50"
                  : isHighlighted
                  ? "border-purple-400 bg-purple-950/60 shadow-2xl shadow-purple-600/70 ring-2 ring-purple-400 scale-105 cursor-pointer"
                  : isCompleted
                  ? "border-emerald-500/40 bg-[#0f1d24] hover:border-emerald-400 hover:bg-[#132630] hover:-translate-y-0.5 cursor-pointer"
                  : hasProgress
                  ? "border-purple-500/40 bg-[#161a33] hover:border-purple-500/70 hover:bg-[#1d2345] hover:-translate-y-0.5 shadow-lg shadow-purple-950/30 cursor-pointer"
                  : "border-purple-500/10 bg-slate-900/60 hover:border-purple-500/40 hover:bg-slate-800/80 hover:-translate-y-0.5 cursor-pointer"
              }`}
            >
              {/* 회차 번호 / 제목 및 로딩 스피너 */}
              {isLoadingThis ? (
                <Loader2 className="h-6 w-6 animate-spin text-purple-300 mb-1" />
              ) : null}
              <span className="text-lg font-black text-white group-hover:text-purple-300 transition">
                {ep.title || `${ep.number}화`}
              </span>

              {/* 시청 진행도 / 완주 뱃지 */}
              <div className="mt-1.5 flex items-center gap-1">
                {isLoadingThis ? (
                  <span className="flex items-center gap-1 rounded-md bg-purple-600/40 px-2 py-0.5 text-[11px] font-bold text-purple-200 border border-purple-400/50 shadow-sm animate-pulse">
                    로딩 중...
                  </span>
                ) : isCompleted ? (
                  <span className="flex items-center gap-1 rounded-md bg-emerald-500/20 px-2 py-0.5 text-[11px] font-bold text-emerald-300 border border-emerald-500/40">
                    <CheckCircle2 className="h-3 w-3 text-emerald-400" /> 완주
                  </span>
                ) : pct > 0 ? (
                  <span className="flex items-center gap-1 rounded-md bg-purple-600/30 px-2 py-0.5 text-[11px] font-bold text-purple-200 border border-purple-400/40 shadow-sm">
                    {pct}% 시청
                  </span>
                ) : (
                  <span className="flex items-center gap-0.5 text-[11px] text-slate-400 group-hover:text-slate-200">
                    <Play className="h-2.5 w-2.5 fill-slate-400" />
                    <span>재생하기</span>
                  </span>
                )}
              </div>

              {/* 하단 시청 진도율 프로그레스 바 (4px 높이 및 그라데이션) */}
              {hasProgress && (
                <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-slate-950/90">
                  <div
                    className={`h-full transition-all duration-300 ${
                      isCompleted
                        ? "bg-gradient-to-r from-emerald-500 to-teal-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]"
                        : "bg-gradient-to-r from-purple-500 via-indigo-500 to-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.8)]"
                    }`}
                    style={{ width: `${isCompleted ? 100 : Math.max(5, pct)}%` }}
                  />
                </div>
              )}
            </Link>
          );
        })}
      </div>

      {displayEpisodes.length === 0 && (
        <div className="mt-8 rounded-2xl border border-purple-500/10 bg-slate-900/40 p-8 text-center text-slate-400">
          해당 조건의 회차가 등록되어 있지 않습니다.
        </div>
      )}
    </div>
  );
}

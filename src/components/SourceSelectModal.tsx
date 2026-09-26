"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Check, Globe, RefreshCw, Radio, Sparkles } from "lucide-react";

export type StreamingSource = "anissia" | "reanime" | "linkkf" | "ohli24";

interface SourceSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSource: StreamingSource;
  onSourceChange?: (newSource: StreamingSource) => void;
}

interface SourceHealth {
  baseUrl: string;
  isHealthy: boolean;
  latencyMs?: number;
  loading: boolean;
}

export default function SourceSelectModal({
  isOpen,
  onClose,
  currentSource,
  onSourceChange,
}: SourceSelectModalProps) {
  const [mounted, setMounted] = useState(false);
  const [selectedSource, setSelectedSource] = useState<StreamingSource>(currentSource);
  const [anissiaHealth, setAnissiaHealth] = useState<SourceHealth>({
    baseUrl: "https://api.anissia.net",
    isHealthy: true,
    loading: true,
  });
  const [reanimeHealth, setReanimeHealth] = useState<SourceHealth>({
    baseUrl: "https://reanime.to",
    isHealthy: true,
    loading: true,
  });
  const [linkkfHealth, setLinkkfHealth] = useState<SourceHealth>({
    baseUrl: "https://linkkf.tv",
    isHealthy: true,
    loading: true,
  });
  const [ohli24Health, setOhli24Health] = useState<SourceHealth>({
    baseUrl: "https://www.ohli24.net",
    isHealthy: true,
    loading: true,
  });

  useEffect(() => {
    if (isOpen) {
      setSelectedSource(currentSource);

      // Anissia Hub 헬스체크
      const anissiaStart = Date.now();
      fetch("https://api.anissia.net/anime/schedule/1", { signal: AbortSignal.timeout(3000) })
        .then((r) => {
          setAnissiaHealth({
            baseUrl: "https://api.anissia.net",
            isHealthy: r.ok,
            latencyMs: Date.now() - anissiaStart,
            loading: false,
          });
        })
        .catch(() => {
          setAnissiaHealth({
            baseUrl: "https://api.anissia.net",
            isHealthy: false,
            loading: false,
          });
        });

      // ReAnime 헬스체크
      fetch("/api/settings/base-url?provider=reanime")
        .then((r) => r.json())
        .then(async (data) => {
          if (data.success) {
            let isHealthy = Boolean(data.isHealthy);
            let latencyMs = data.latencyMs;

            if (!isHealthy) {
              try {
                const start = Date.now();
                const direct = await fetch(`${data.baseUrl || "https://reanime.to"}/api/v1/home`, {
                  headers: { Accept: "application/json" },
                });
                if (direct.ok) {
                  isHealthy = true;
                  latencyMs = Date.now() - start;
                }
              } catch {}
            }

            setReanimeHealth({
              baseUrl: data.baseUrl,
              isHealthy,
              latencyMs,
              loading: false,
            });
          } else {
            setReanimeHealth((prev) => ({ ...prev, isHealthy: false, loading: false }));
          }
        })
        .catch(() => {
          setReanimeHealth((prev) => ({ ...prev, isHealthy: false, loading: false }));
        });

      // Linkkf 헬스체크
      fetch("/api/settings/base-url?provider=linkkf")
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            setLinkkfHealth({
              baseUrl: data.baseUrl,
              isHealthy: data.isHealthy,
              latencyMs: data.latencyMs,
              loading: false,
            });
          } else {
            setLinkkfHealth((prev) => ({ ...prev, isHealthy: false, loading: false }));
          }
        })
        .catch(() => {
          setLinkkfHealth((prev) => ({ ...prev, isHealthy: false, loading: false }));
        });

      // Ohli24 헬스체크
      fetch("/api/settings/base-url?provider=ohli24")
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            setOhli24Health({
              baseUrl: data.baseUrl,
              isHealthy: data.isHealthy,
              latencyMs: data.latencyMs,
              loading: false,
            });
          } else {
            setOhli24Health((prev) => ({ ...prev, isHealthy: false, loading: false }));
          }
        })
        .catch(() => {
          setOhli24Health((prev) => ({ ...prev, isHealthy: false, loading: false }));
        });
    }
  }, [isOpen, currentSource]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // ESC 키로 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // 모달 열려 있을 때 body 스크롤 방지
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  if (!isOpen || !mounted) return null;

  const portalTarget =
    (typeof document !== "undefined" && (document.fullscreenElement as HTMLElement)) ||
    (typeof document !== "undefined" ? document.body : null);

  if (!portalTarget) return null;

  const handleApply = () => {
    // 1년 유효 쿠키 저장
    document.cookie = `anime_source=${selectedSource}; path=/; max-age=31536000; SameSite=Lax`;
    if (onSourceChange) {
      onSourceChange(selectedSource);
    }
    onClose();
    // 소스가 바뀔 때는 이전 소스의 탭/필터 파라미터 간섭을 방지하기 위해 홈 루트로 이동
    window.location.href = "/";
  };

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div
        className="relative z-10 flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border border-purple-500/30 bg-[#0d1322] shadow-2xl shadow-purple-950/60 animate-in fade-in zoom-in-95 duration-150 my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (고정) */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600/30 text-purple-400 border border-purple-500/30">
              <RefreshCw className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">스트리밍 사이트 선택</h2>
              <p className="text-xs text-slate-400">사용하실 소스 사이트를 선택해주세요.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Source Cards Body (스크롤 영역) */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 scrollbar-thin scrollbar-thumb-purple-500/30">
          {/* 1. Anissia Hub Card (최고 추천) */}
          <div
            onClick={() => setSelectedSource("anissia")}
            className={`cursor-pointer rounded-2xl border p-4 transition-all ${
              selectedSource === "anissia"
                ? "border-emerald-500 bg-emerald-950/40 shadow-lg shadow-emerald-900/30 ring-1 ring-emerald-500/50"
                : "border-white/10 bg-slate-900/60 hover:border-emerald-500/30 hover:bg-slate-900/90"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                    selectedSource === "anissia"
                      ? "border-emerald-500 bg-emerald-600 text-white"
                      : "border-slate-500 bg-slate-800"
                  }`}
                >
                  {selectedSource === "anissia" && <Check className="h-3 w-3 stroke-[3]" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-white">애니시아 허브 (스마트 자막)</span>
                    <span className="flex items-center gap-1 rounded bg-emerald-500/20 border border-emerald-500/40 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                      <Sparkles className="h-3 w-3 text-emerald-400" />
                      최고 추천
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    100% 한글 자막 보장 • 실시간 편성표 • 스마트 스트림 자동 연결
                  </div>
                </div>
              </div>

              {/* Status Badge */}
              <div className="flex items-center gap-1.5 text-[11px] shrink-0">
                <span
                  className={`h-2 w-2 rounded-full ${
                    anissiaHealth.loading
                      ? "bg-slate-400 animate-pulse"
                      : anissiaHealth.isHealthy
                      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                      : "bg-rose-500"
                  }`}
                />
                <span className={anissiaHealth.isHealthy ? "text-emerald-400 font-semibold" : "text-rose-400"}>
                  {anissiaHealth.loading ? "확인중..." : anissiaHealth.isHealthy ? "정상 연결" : "연결 불안정"}
                </span>
              </div>
            </div>
          </div>

          {/* 2. ReAnime Card */}
          <div
            onClick={() => setSelectedSource("reanime")}
            className={`cursor-pointer rounded-2xl border p-4 transition-all ${
              selectedSource === "reanime"
                ? "border-purple-500 bg-purple-950/40 shadow-lg shadow-purple-900/30 ring-1 ring-purple-500/50"
                : "border-white/10 bg-slate-900/60 hover:border-purple-500/30 hover:bg-slate-900/90"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                    selectedSource === "reanime"
                      ? "border-purple-500 bg-purple-600 text-white"
                      : "border-slate-500 bg-slate-800"
                  }`}
                >
                  {selectedSource === "reanime" && <Check className="h-3 w-3 stroke-[3]" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-white">ReAnime (1080p 고화질)</span>
                    <span className="flex items-center gap-1 rounded bg-purple-500/20 border border-purple-500/40 px-1.5 py-0.5 text-[10px] font-bold text-purple-300">
                      <Sparkles className="h-3 w-3 text-purple-400" />
                      추천
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    1080p 고화질 • 초고속 CDN • 한국어 자막 오버레이
                  </div>
                </div>
              </div>

              {/* Status Badge */}
              <div className="flex items-center gap-1.5 text-[11px] shrink-0">
                <span
                  className={`h-2 w-2 rounded-full ${
                    reanimeHealth.loading
                      ? "bg-slate-400 animate-pulse"
                      : reanimeHealth.isHealthy
                      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                      : "bg-rose-500"
                  }`}
                />
                <span className={reanimeHealth.isHealthy ? "text-emerald-400 font-semibold" : "text-rose-400"}>
                  {reanimeHealth.loading ? "확인중..." : reanimeHealth.isHealthy ? "정상 연결" : "연결 불안정"}
                </span>
              </div>
            </div>
          </div>

          {/* 2. Linkkf Card */}
          <div
            onClick={() => setSelectedSource("linkkf")}
            className={`cursor-pointer rounded-2xl border p-4 transition-all ${
              selectedSource === "linkkf"
                ? "border-purple-500 bg-purple-950/40 shadow-lg shadow-purple-900/20"
                : "border-white/10 bg-slate-900/60 hover:border-white/20 hover:bg-slate-900/90"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                    selectedSource === "linkkf"
                      ? "border-purple-500 bg-purple-600 text-white"
                      : "border-slate-500 bg-slate-800"
                  }`}
                >
                  {selectedSource === "linkkf" && <Check className="h-3 w-3 stroke-[3]" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-white">Linkkf</span>
                    <span className="rounded bg-slate-700/50 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
                      국내
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">실시간 방영작 및 일간/주간/월간 랭킹</div>
                </div>
              </div>

              {/* Status Badge */}
              <div className="flex items-center gap-1.5 text-[11px] shrink-0">
                <span
                  className={`h-2 w-2 rounded-full ${
                    linkkfHealth.loading
                      ? "bg-slate-400 animate-pulse"
                      : linkkfHealth.isHealthy
                      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                      : "bg-rose-500"
                  }`}
                />
                <span className={linkkfHealth.isHealthy ? "text-emerald-400" : "text-rose-400"}>
                  {linkkfHealth.loading ? "확인중..." : linkkfHealth.isHealthy ? "정상 연결" : "연결 불안정"}
                </span>
              </div>
            </div>
          </div>

          {/* 3. Ohli24 Card */}
          <div
            onClick={() => setSelectedSource("ohli24")}
            className={`cursor-pointer rounded-2xl border p-4 transition-all ${
              selectedSource === "ohli24"
                ? "border-purple-500 bg-purple-950/40 shadow-lg shadow-purple-900/20"
                : "border-white/10 bg-slate-900/60 hover:border-white/20 hover:bg-slate-900/90"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                    selectedSource === "ohli24"
                      ? "border-purple-500 bg-purple-600 text-white"
                      : "border-slate-500 bg-slate-800"
                  }`}
                >
                  {selectedSource === "ohli24" && <Check className="h-3 w-3 stroke-[3]" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-white">Ohli24 (애니24)</span>
                    <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">
                      국내
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">신작 방영 및 완결 애니메이션</div>
                </div>
              </div>

              {/* Status Badge */}
              <div className="flex items-center gap-1.5 text-[11px] shrink-0">
                <span
                  className={`h-2 w-2 rounded-full ${
                    ohli24Health.loading
                      ? "bg-slate-400 animate-pulse"
                      : ohli24Health.isHealthy
                      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"
                      : "bg-rose-500"
                  }`}
                />
                <span className={ohli24Health.isHealthy ? "text-emerald-400" : "text-rose-400"}>
                  {ohli24Health.loading ? "확인중..." : ohli24Health.isHealthy ? "정상 연결" : "연결 불안정"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions (고정) */}
        <div className="flex items-center justify-end gap-2.5 border-t border-white/10 px-6 py-4 shrink-0 bg-slate-900/40 rounded-b-3xl">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5 transition"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-purple-600/30 hover:opacity-90 transition"
          >
            적용하기
          </button>
        </div>
      </div>
    </div>,
    portalTarget
  );
}

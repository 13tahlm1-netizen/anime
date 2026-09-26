"use client";

import Link from "next/link";
import Image from "next/image";
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  Download,
  Film,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";

interface PreloadedSubtitle {
  name?: string;
  is_ass?: boolean;
  content?: string;
}

interface AnissiaStreamFallbackProps {
  animeId: string;
  animeTitle: string;
  animePoster?: string;
  episodeNumber: number;
  episodeTitle?: string;
  initialCreator?: string;
  initialSubUrl?: string;
  preloadedSub?: PreloadedSubtitle | null;
  maxAvailableEp?: number;
  unsupportedReason?: string;
  totalEpisodes?: number;
}

export default function AnissiaStreamFallback({
  animeId,
  animeTitle,
  animePoster,
  episodeNumber,
  episodeTitle = `${episodeNumber}화`,
  initialCreator,
  initialSubUrl,
  preloadedSub,
  maxAvailableEp,
  unsupportedReason,
}: AnissiaStreamFallbackProps) {
  const handleDownloadSub = () => {
    if (!preloadedSub?.content) return;
    const isAss = Boolean(preloadedSub.is_ass);
    const ext = isAss ? "ass" : "vtt";
    const mime = isAss ? "text/x-ssa;charset=utf-8" : "text/vtt;charset=utf-8";
    const filename = `${animeTitle.replace(/[^\w\s가-힣.-]/gi, "_")}_${episodeNumber}화_${preloadedSub.name || "자막"}.${ext}`;

    const blob = new Blob([preloadedSub.content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const defaultReason =
    unsupportedReason ||
    `해당 회차(${episodeNumber}화) 영상 소스가 해외 스트리밍 서버(ReAnime 등)에 아직 업로드되지 않았거나 지원되지 않는 작품입니다.`;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:py-12">
      {/* Anime Info Header */}
      <div className="flex flex-col items-center sm:flex-row sm:items-start gap-5 rounded-3xl border border-slate-800/80 bg-slate-900/60 p-6 backdrop-blur-xl shadow-2xl">
        {animePoster ? (
          <div className="relative h-40 w-28 shrink-0 overflow-hidden rounded-2xl border border-slate-700/60 shadow-lg">
            <Image
              src={animePoster}
              alt={animeTitle}
              fill
              className="object-cover"
              sizes="112px"
            />
          </div>
        ) : (
          <div className="flex h-40 w-28 shrink-0 items-center justify-center rounded-2xl bg-slate-800 text-slate-500">
            <Film className="h-10 w-10" />
          </div>
        )}

        <div className="flex-1 text-center sm:text-left">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
            <span className="rounded-lg bg-purple-600/30 px-2.5 py-1 text-xs font-bold text-purple-300 border border-purple-500/30">
              애니시아 연동
            </span>
            <span className="rounded-lg bg-indigo-600/30 px-2.5 py-1 text-xs font-semibold text-indigo-300 border border-indigo-500/30">
              {episodeTitle}
            </span>
            {maxAvailableEp && maxAvailableEp > 0 && (
              <span className="rounded-lg bg-emerald-600/30 px-2.5 py-1 text-xs font-semibold text-emerald-300 border border-emerald-500/30">
                해외 서버 최신: {maxAvailableEp}화
              </span>
            )}
          </div>

          <h1 className="mt-3 text-xl font-black text-white sm:text-2xl">
            {animeTitle}
          </h1>

          <p className="mt-2 text-xs text-slate-400">
            에피소드 번호: {episodeNumber}화
          </p>
        </div>
      </div>

      {/* Main Status / Explanation Card */}
      <div className="mt-6 rounded-3xl border border-amber-500/30 bg-gradient-to-b from-amber-500/10 via-slate-900/80 to-slate-950 p-6 sm:p-8 backdrop-blur-xl shadow-2xl">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
            <AlertCircle className="h-6 w-6" />
          </div>

          <div className="flex-1">
            <h3 className="text-lg font-bold text-white sm:text-xl">
              {maxAvailableEp && maxAvailableEp < episodeNumber
                ? `${episodeNumber}화 영상 소스 등록 대기 중`
                : "영상 스트림을 제공하지 않는 작품입니다"}
            </h3>

            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              {defaultReason}
            </p>

            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 text-xs text-slate-400 space-y-1.5">
              <p className="font-semibold text-slate-300">💡 왜 영상이 안 나오나요?</p>
              <ul className="list-disc pl-4 space-y-1 text-slate-400">
                <li>
                  <strong className="text-slate-300">자막과 영상 업로드 시점 차이:</strong> 국내 자막 제작자분이 본방 직후 빠르게 자막을 등록했더라도, 해외 1080p 스트리밍 서버에 원본 영상이 인코딩되어 반영되기까지 수 시간~반나절 정도 소요될 수 있습니다.
                </li>
                <li>
                  <strong className="text-slate-300">웹/유튜브 전용 단편:</strong> 2~3분 분량의 쇼츠 또는 미니 애니메이션은 해외 스트리밍 사이트에 영상이 등록되지 않을 수 있습니다.
                </li>
              </ul>
            </div>

            {/* Quick Action: Watch Latest Available Episode */}
            {maxAvailableEp && maxAvailableEp > 0 && maxAvailableEp !== episodeNumber && (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Link
                  href={`/watch/${animeId}/${maxAvailableEp}`}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-600/30 hover:brightness-110 transition active:scale-95"
                >
                  <Play className="h-4 w-4 fill-white" />
                  현재 시청 가능한 최신 {maxAvailableEp}화 바로보기
                </Link>
                {episodeNumber > 1 && (
                  <Link
                    href={`/watch/${animeId}/${episodeNumber - 1}`}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700 transition"
                  >
                    <RotateCcw className="h-4 w-4" />
                    이전 {episodeNumber - 1}화 보기
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Subtitle Info & Direct Blog / Download Card */}
      {(initialCreator || initialSubUrl || preloadedSub) && (() => {
        const isErusha = Boolean(
          (initialCreator && initialCreator.includes("에루샤")) ||
          (initialSubUrl && initialSubUrl.includes("erulabo.com"))
        );

        return (
          <div className={`mt-6 rounded-3xl border p-6 backdrop-blur-xl shadow-xl ${
            isErusha
              ? "border-amber-500/40 bg-gradient-to-r from-amber-500/10 via-slate-900/90 to-slate-950"
              : "border-purple-500/30 bg-[#0f172a]/80"
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles className={`h-4 w-4 ${isErusha ? "text-amber-400" : "text-purple-400"}`} />
                  <h4 className="text-base font-bold text-white">
                    자막 제작자 정보 연동
                  </h4>
                  {isErusha && (
                    <span className="rounded-md border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      보안 캡차 적용 (직접 다운로드 필요)
                    </span>
                  )}
                </div>
                {isErusha ? (
                  <p className="mt-1.5 text-xs text-slate-300 leading-relaxed">
                    <strong className="text-amber-300">[{initialCreator || "에루샤"}]</strong> 님의 배포 사이트(erulabo.com)는 Cloudflare 봇 방지 보안 캡차가 적용되어 있어 시스템 자동 추출이 지원되지 않습니다. 아래 버튼을 통해 제작자 블로그에서 직접 자막을 다운로드해 이용해주세요.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-300">
                    {initialCreator ? (
                      <>
                        <strong className="text-purple-300">[{initialCreator}]</strong> 님의 {episodeNumber}화 자막 정보가 연동되어 있습니다.
                      </>
                    ) : (
                      "해당 회차 자막 정보가 연동되어 있습니다."
                    )}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                {initialSubUrl && (
                  <a
                    href={initialSubUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-md transition ${
                      isErusha
                        ? "bg-amber-600 hover:bg-amber-500 shadow-amber-600/30 font-bold"
                        : "bg-purple-600 hover:bg-purple-500 shadow-purple-600/25"
                    }`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    제작자 블로그 방문
                  </a>
                )}

                {preloadedSub?.content && (
                  <button
                    onClick={handleDownloadSub}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-600/20 px-4 py-2 text-xs font-semibold text-indigo-300 hover:bg-indigo-600/30 transition"
                  >
                    <Download className="h-3.5 w-3.5" />
                    자막 파일({preloadedSub.is_ass ? "ASS" : "VTT"}) 다운로드
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Navigation Buttons */}
      <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <Link
          href={`/anime/${animeId}`}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700 transition"
        >
          <ArrowLeft className="h-4 w-4" /> 전체 회차 목록 보기
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-700/80 px-5 py-2.5 text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          홈으로 가기
        </Link>
      </div>
    </main>
  );
}

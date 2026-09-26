"use client";

import { useEffect, useState } from "react";
import Player from "@/components/Player";
import { stripReanimeId } from "@/lib/providers";
import { EpisodeItem } from "@/lib/providers/types";
import Link from "next/link";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";

interface ReanimeWatchFallbackProps {
  id: string;
  ep: number;
  isDub?: boolean;
}

export default function ReanimeWatchFallback({
  id,
  ep,
  isDub = false,
}: ReanimeWatchFallbackProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playerProps, setPlayerProps] = useState<any>(null);

  const slug = stripReanimeId(id);

  const loadStream = async () => {
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
      const [rDetail, rEps] = await Promise.all([
        fetch(`${baseUrl}/api/v1/anime/${slug}`),
        fetch(`${baseUrl}/api/v1/anime/${slug}/episodes`),
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

      const subEpisodes: EpisodeItem[] = rawEpisodes.map((e: any) => {
        const epNum = Number(e.episode_number ?? e.number ?? 1);
        return {
          number: epNum,
          title: e.title ? `${epNum}화 - ${e.title}` : `${epNum}화`,
          watch_url: `${baseUrl}/watch/${slug}?ep=${epNum}&anilist=${anilistId}`,
        };
      });

      // 2. Flix API 호출 (스트림 소스 가져오기)
      let streamEmbed = "";
      let m3u8Url = "";
      let isIframe = true;

      try {
        let flixJson: any = null;

        // 1순위: 자체 백엔드 프록시 (/api/anime/flix) - 브라우저 CORS 제약 우회
        try {
          const proxyRes = await fetch(`/api/anime/flix?anilistId=${anilistId}&ep=${ep}`);
          if (proxyRes.ok) {
            flixJson = await proxyRes.json();
          }
        } catch (proxyErr) {
          console.warn("[ReAnime] /api/anime/flix proxy error, trying direct fetch:", proxyErr);
        }

        // 2순위: 프록시 응답이 없거나 실패한 경우 브라우저 직접 fetch 시도
        if (!flixJson?.servers?.length) {
          try {
            const flixRes = await fetch(`${baseUrl}/api/flix/${anilistId}/${ep}`);
            if (flixRes.ok) {
              flixJson = await flixRes.json();
            }
          } catch (directErr) {
            console.warn("[ReAnime] direct flix fetch failed:", directErr);
          }
        }

        // 3순위: 브라우저 Jina Reader 우회 시도 (CORS 허용)
        if (!flixJson?.servers?.length) {
          try {
            const jinaRes = await fetch(`https://r.jina.ai/${baseUrl}/api/flix/${anilistId}/${ep}`, {
              headers: { Accept: "application/json" },
            });
            if (jinaRes.ok) {
              const jinaData = await jinaRes.json();
              const content = jinaData?.data?.content;
              if (content) {
                try {
                  flixJson = JSON.parse(content);
                } catch {
                  const m = content.match(/\{[\s\S]*\}/);
                  if (m) flixJson = JSON.parse(m[0]);
                }
              }
            }
          } catch (jinaErr) {
            console.warn("[ReAnime] client Jina fallback fetch failed:", jinaErr);
          }
        }

        const servers = Array.isArray(flixJson?.servers) ? flixJson.servers : [];
        // sub 타입 또는 첫번째 서버 우선 선택
        const matchedServer = servers.find((s: any) => (isDub ? s.dataType === "dub" : s.dataType === "sub")) || servers[0];
        if (matchedServer?.dataLink) {
          const link = matchedServer.dataLink;
          if (link.includes(".m3u8")) {
            m3u8Url = link;
            isIframe = false;
          } else {
            streamEmbed = link;
            isIframe = true;
          }
        }
      } catch (err) {
        console.warn("[ReAnime] flix stream fetch failed:", err);
      }

      if (!streamEmbed && !m3u8Url) {
        throw new Error("영상 스트림(FlixCloud) 주소를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      }

      // 회차 번호 계산
      let linkPreEpNum: number | null = null;
      let linkNextEpNum: number | null = null;
      let epTitle = `${ep}화`;

      for (let idx = 0; idx < subEpisodes.length; idx++) {
        const e = subEpisodes[idx];
        if (e.number === ep) {
          epTitle = e.title;
          if (idx > 0) linkPreEpNum = subEpisodes[idx - 1].number;
          if (idx + 1 < subEpisodes.length) linkNextEpNum = subEpisodes[idx + 1].number;
          break;
        }
      }

      setPlayerProps({
        animeId: id,
        animeTitle: title,
        animePoster: poster,
        episodeNumber: ep,
        initialEpTitle: epTitle,
        m3u8Url: m3u8Url ? `/api/anime/stream/m3u8?url=${encodeURIComponent(m3u8Url)}&ref=${encodeURIComponent(baseUrl)}` : "",
        defaultVttUrl: "",
        linkPreEp: linkPreEpNum,
        linkNextEp: linkNextEpNum,
        isDub,
        subEpisodes,
        dubEpisodes: [],
        streamType: isIframe ? "iframe" : "m3u8",
        embedUrl: streamEmbed,
      });
    } catch (err: any) {
      console.error("[ReanimeWatchFallback error]:", err);
      setError(err?.message || "영상 스트림을 불러오는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStream();
  }, [id, ep, isDub]);

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-20 text-center">
        <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-purple-500/20 bg-slate-900/60 p-12 backdrop-blur-md">
          <Loader2 className="h-10 w-10 animate-spin text-purple-400" />
          <h2 className="text-lg font-bold text-white">ReAnime 고화질 스트림 연결 중...</h2>
          <p className="text-xs text-slate-400">영상 소스 서버를 탐색하고 있습니다. 잠시만 기다려주세요.</p>
        </div>
      </main>
    );
  }

  if (error || !playerProps) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-16 text-center">
        <div className="rounded-3xl border border-red-500/20 bg-slate-900/60 p-8">
          <h2 className="text-xl font-bold text-red-400">스트림 주소를 불러오지 못했습니다.</h2>
          <p className="mt-2 text-sm text-slate-400">
            {error || "해당 회차 영상 소스가 아직 업로드되지 않았거나 연결이 원활하지 않습니다."}
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link
              href={`/anime/${id}`}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition"
            >
              <ArrowLeft className="h-4 w-4" /> 작품 회차 목록으로 돌아가기
            </Link>
            <button
              onClick={loadStream}
              className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-500 transition"
            >
              <RefreshCw className="h-4 w-4" /> 다시 시도
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Player {...playerProps} />
    </main>
  );
}

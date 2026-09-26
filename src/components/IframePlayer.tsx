"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  List,
  Maximize2,
  Minimize2,
  RotateCcw,
  Clock,
  Target,
  Type,
  Subtitles,
  Sparkles,
  Search,
  Check,
  Loader2,
  FolderOpen,
  Film,
} from "lucide-react";
import { EpisodeItem } from "./Player";
import SubtitleSelectModal, { CreatorInfo, SubtitleOption } from "./SubtitleSelectModal";
import { ServerSource } from "@/lib/providers";

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
  isTop?: boolean;
}

interface IframePlayerProps {
  animeId: string;
  animeTitle: string;
  animePoster?: string;
  episodeNumber: number;
  initialEpTitle?: string;
  m3u8Url?: string;
  defaultVttUrl?: string;
  linkPreEp?: number | null;
  linkNextEp?: number | null;
  isDub?: boolean;
  subEpisodes?: EpisodeItem[];
  dubEpisodes?: EpisodeItem[];
  streamType?: "m3u8" | "iframe";
  embedUrl?: string;
  serverSources?: ServerSource[];
  initialSubtitle?: any;
  initialCreator?: string;
  initialSubUrl?: string;
}

function formatTime(sec: number): string {
  if (isNaN(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${String(m).padStart(2, "0")}:${s.padStart(4, "0")}`;
}

export default function IframePlayer({
  animeId,
  animeTitle,
  animePoster,
  episodeNumber,
  initialEpTitle,
  linkPreEp,
  linkNextEp,
  subEpisodes = [],
  embedUrl = "",
  serverSources = [],
  initialSubtitle,
  initialCreator = "",
  initialSubUrl = "",
}: IframePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hudTextRef = useRef<HTMLDivElement>(null);
  const topHudTextRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const octopusRef = useRef<any>(null);
  const currentBlobUrlRef = useRef<string | null>(null);

  // States
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [syncOffset, setSyncOffset] = useState(0.0);
  const [isSubEnabled, setIsSubEnabled] = useState(true);
  const [subSize, setSubSize] = useState<"small" | "normal" | "large">("normal");
  const [isSavedSync, setIsSavedSync] = useState(false);
  const [isOctopusScriptLoaded, setIsOctopusScriptLoaded] = useState(() => {
    return typeof window !== "undefined" && Boolean(window.SubtitlesOctopus);
  });
  const [isOctopusActive, setIsOctopusActive] = useState(false);
  const [navigatingTarget, setNavigatingTarget] = useState<string | null>(null);
  const [showFsControls, setShowFsControls] = useState(false);
  const fsControlsTimerRef = useRef<NodeJS.Timeout | null>(null);
  const syncOffsetRef = useRef(syncOffset);
  syncOffsetRef.current = syncOffset;
  const isSubEnabledRef = useRef(isSubEnabled);
  isSubEnabledRef.current = isSubEnabled;
  const cuesRef = useRef<SubtitleCue[]>([]);
  const isOctopusActiveRef = useRef(false);
  isOctopusActiveRef.current = isOctopusActive;

  const triggerFsControls = useCallback(() => {
    setShowFsControls(true);
    if (fsControlsTimerRef.current) clearTimeout(fsControlsTimerRef.current);
    fsControlsTimerRef.current = setTimeout(() => {
      setShowFsControls(false);
    }, 3500);
  }, []);

  const getFullscreenElement = useCallback(() => {
    if (typeof document === "undefined") return null;
    return (
      document.fullscreenElement ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (document as any).webkitFullscreenElement ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (document as any).mozFullScreenElement ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (document as any).msFullscreenElement ||
      null
    );
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const isFs = Boolean(getFullscreenElement()) || isFullscreen;
    if (!isFs) {
      triggerFsControls();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const el = containerRef.current as any;
      if (!el) return;
      try {
        if (el.requestFullscreen) {
          await el.requestFullscreen();
        } else if (el.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen();
        } else if (el.mozRequestFullScreen) {
          await el.mozRequestFullScreen();
        } else if (el.msRequestFullscreen) {
          await el.msRequestFullscreen();
        } else {
          // iOS Safari fallback: CSS pseudo-fullscreen
          setIsFullscreen(true);
          document.body.style.overflow = "hidden";
        }
      } catch {
        // Fallback to CSS pseudo-fullscreen
        setIsFullscreen(true);
        document.body.style.overflow = "hidden";
      }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const doc = document as any;
      try {
        if (doc.exitFullscreen) {
          await doc.exitFullscreen();
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen();
        } else if (doc.mozCancelFullScreen) {
          await doc.mozCancelFullScreen();
        } else if (doc.msExitFullscreen) {
          await doc.msExitFullscreen();
        }
      } catch {}
      setIsFullscreen(false);
      document.body.style.overflow = "";
    }
  }, [getFullscreenElement, isFullscreen, triggerFsControls]);

  // Subtitles & Creators (서버에서 사전 로드된 자막이 있으면 0초 딜레이로 즉시 바인딩)
  const [subtitles, setSubtitles] = useState<SubtitleOption[]>(() => {
    if (initialSubtitle && initialSubtitle.content) {
      return [
        {
          name: initialSubtitle.name || initialCreator || "선택된 자막",
          format: initialSubtitle.is_ass ? "ASS" : "VTT",
          is_ass: Boolean(initialSubtitle.is_ass),
          content: initialSubtitle.content,
          url: initialSubUrl || "",
        },
      ];
    }
    return [];
  });
  const [currentSubIndex, setCurrentSubIndex] = useState(0);
  const [creators, setCreators] = useState<CreatorInfo[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [firstDialogue, setFirstDialogue] = useState<SubtitleCue | null>(null);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  const syncDebounceTimer = useRef<NodeJS.Timeout | null>(null);
  const lastHistorySaveTime = useRef(0);
  const lastCurrentTimeRef = useRef(0);
  const lastDurationRef = useRef(0);

  // Show temporary toast notice
  const showNotice = useCallback((msg: string, duration = 3000) => {
    setNoticeMessage(msg);
    setTimeout(() => {
      setNoticeMessage((prev) => (prev === msg ? null : prev));
    }, duration);
  }, []);

  const syncHistory = useCallback(
    (isEnded = false) => {
      const curTime = lastCurrentTimeRef.current;
      const dur = lastDurationRef.current;
      if (curTime <= 2 && !isEnded) return;

      const isCompleted = isEnded || (dur > 0 && curTime / dur > 0.85);

      fetch("/api/anime/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          animeId,
          animeTitle,
          animePoster: animePoster || "",
          episodeNumber,
          episodeTitle: initialEpTitle || `${episodeNumber}화`,
          watchUrl: `/watch/${animeId}/${episodeNumber}`,
          currentTime: Math.floor(curTime),
          duration: Math.floor(dur),
          isCompleted,
          anime_id: animeId,
          anime_title: animeTitle,
          anime_poster: animePoster || "",
          episode_number: episodeNumber,
          episode_title: initialEpTitle || `${episodeNumber}화`,
          watch_url: `/watch/${animeId}/${episodeNumber}`,
          watch_time: Math.floor(curTime),
          is_completed: isCompleted,
        }),
        keepalive: true,
      }).catch(() => {});
    },
    [animeId, animeTitle, animePoster, episodeNumber, initialEpTitle]
  );

  // Helper: Strip HTML tags, ASS tags, and HTML entities
  const cleanSubtitleText = (raw: string): string => {
    if (!raw) return "";
    return raw
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "") // <i>, </i>, <font...>, </font>, <b>, <u> 등 모든 HTML 태그 완벽 제거
      .replace(/\{[^}]*\}/g, "") // ASS 스타일 태그 {\an8} 등 제거
      .replace(/\\N/gi, "\n")
      .replace(/\\n/gi, "\n")
      .replace(/\\h/gi, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join("\n")
      .trim();
  };

  // 1. ASS Dialogue Parser
  const parseAssToCues = useCallback((assText: string): SubtitleCue[] => {
    if (!assText) return [];
    const list: SubtitleCue[] = [];
    const pattern =
      /^Dialogue:\s*[^,]+,(\d+:\d{2}:\d{2}(?:\.\d+)?),(\d+:\d{2}:\d{2}(?:\.\d+)?),([^,]*),([^,]*),(?:[^,]*,){4}(.*)$/gim;

    const toSec = (tStr: string) => {
      const p = tStr.trim().split(":");
      if (p.length === 3) {
        return parseFloat(p[0]) * 3600 + parseFloat(p[1]) * 60 + parseFloat(p[2]);
      } else if (p.length === 2) {
        return parseFloat(p[0]) * 60 + parseFloat(p[1]);
      }
      return parseFloat(tStr) || 0;
    };

    let match;
    while ((match = pattern.exec(assText)) !== null) {
      const startSec = toSec(match[1]);
      let endSec = toSec(match[2]);
      const rawText = match[5];
      const cleanText = cleanSubtitleText(rawText);

      const isTop = /\{\\an[789]\}/i.test(rawText);

      // 자막이 10초 이상 계속 켜져있는 비정상 싱크 cap
      if (endSec - startSec > 10) {
        endSec = startSec + Math.max(3, Math.min(cleanText.length * 0.25, 8));
      }

      if (cleanText && endSec > startSec) {
        list.push({ start: startSec, end: endSec, text: cleanText, isTop });
      }
    }
    return list;
  }, []);

  // 2. VTT & SAMI Parser
  const parseVttToCues = useCallback((vttText: string): SubtitleCue[] => {
    if (!vttText) return [];

    const lower = vttText.toLowerCase();

    // 2-1. SAMI (.smi) 파일이 전달된 경우 (로컬 파일 등)
    if (lower.includes("<sync") || lower.includes("<sami")) {
      const syncRegex = /<SYNC\s+Start=(\d+)[^>]*>(?:<P[^>]*>)?([\s\S]*?)(?=<SYNC|\Z)/gi;
      let m: RegExpExecArray | null;
      const list: SubtitleCue[] = [];
      let currentCue: { start: number; text: string } | null = null;

      while ((m = syncRegex.exec(vttText)) !== null) {
        const startSec = parseInt(m[1], 10) / 1000;
        if (isNaN(startSec)) continue;
        const text = cleanSubtitleText(m[2]);

        // 이전 열려있는 대사가 있다면 닫아준다
        if (currentCue) {
          const diff = startSec - currentCue.start;
          if (diff > 0) {
            const maxDur = Math.max(3, Math.min(currentCue.text.length * 0.25, 7.5));
            const actualEnd = diff > maxDur ? currentCue.start + maxDur : startSec;
            list.push({ start: currentCue.start, end: actualEnd, text: currentCue.text });
          }
          currentCue = null;
        }

        // 현재 싱크에 텍스트가 있다면 새 대사 등록
        if (text.length > 0) {
          currentCue = { start: startSec, text };
        }
      }

      if (currentCue) {
        const maxDur = Math.max(3, Math.min(currentCue.text.length * 0.25, 6));
        list.push({ start: currentCue.start, end: currentCue.start + maxDur, text: currentCue.text });
      }
      return list;
    }

    // 2-2. WebVTT & SRT 파싱
    const list: SubtitleCue[] = [];
    const lines = vttText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    let currentStart: number | null = null;
    let currentEnd: number | null = null;
    let currentTexts: string[] = [];

    const toSec = (tStr: string) => {
      if (!tStr) return 0;
      const cleanStr = tStr.replace(",", ".").trim();
      const p = cleanStr.split(":");
      if (p.length === 3) {
        return parseFloat(p[0]) * 3600 + parseFloat(p[1]) * 60 + parseFloat(p[2]);
      } else if (p.length === 2) {
        return parseFloat(p[0]) * 60 + parseFloat(p[1]);
      }
      return parseFloat(cleanStr) || 0;
    };

    const timeArrowPattern =
      /((?:\d{1,2}:)?\d{2}:\d{2}[\.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[\.,]\d{1,3})/;

    const flushCue = () => {
      if (currentStart !== null && currentEnd !== null && currentTexts.length > 0) {
        const raw = currentTexts.join("\n");
        const clean = cleanSubtitleText(raw);
        let end = currentEnd;
        // 안전장치: 자막이 10초 이상 계속 켜져있는 비정상 싱크 cap
        if (end - currentStart > 10) {
          end = currentStart + Math.max(3, Math.min(clean.length * 0.25, 8));
        }
        if (clean && end > currentStart) {
          list.push({ start: currentStart, end, text: clean });
        }
      }
      currentTexts = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        flushCue();
        currentStart = null;
        currentEnd = null;
        continue;
      }
      const timeMatch = timeArrowPattern.exec(line);
      if (timeMatch) {
        flushCue();
        currentStart = toSec(timeMatch[1]);
        currentEnd = toSec(timeMatch[2]);
      } else if (currentStart !== null && !line.startsWith("WEBVTT") && !/^\d+$/.test(line)) {
        currentTexts.push(line);
      }
    }

    flushCue();
    return list;
  }, []);

  // 3. Load saved sync setting from DB
  useEffect(() => {
    async function loadSavedSync() {
      try {
        const res = await fetch(
          `/api/anime/reanime-sync?animeId=${encodeURIComponent(animeId)}&ep=${episodeNumber}`
        );
        const data = await res.json();
        if (data.success && data.setting) {
          const savedOffset = parseFloat(data.setting.sync_offset || "0");
          setSyncOffset(savedOffset);
          setIsSavedSync(true);
        }
      } catch (err) {
        console.error("Failed to load saved sync offset:", err);
      }
    }
    loadSavedSync();
  }, [animeId, episodeNumber]);

  // 4. Save sync setting to DB (debounced)
  const saveSyncToDb = useCallback(
    (offset: number) => {
      setIsSavedSync(false);
      if (syncDebounceTimer.current) {
        clearTimeout(syncDebounceTimer.current);
      }
      syncDebounceTimer.current = setTimeout(async () => {
        try {
          const currentSub = subtitles[currentSubIndex];
          await fetch("/api/anime/reanime-sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              animeId,
              ep: episodeNumber,
              syncOffset: offset,
              subtitleName: currentSub?.name || "",
              subtitleUrl: currentSub?.url || "",
            }),
          });
          setIsSavedSync(true);
        } catch (err) {
          console.error("Failed to save sync offset to DB:", err);
        }
      }, 800);
    },
    [animeId, episodeNumber, subtitles, currentSubIndex]
  );

  // 5. Fetch Korean subtitles for this anime
  const [resolvedTitle, setResolvedTitle] = useState<string>("");

  useEffect(() => {
    let isCancelled = false;
    async function fetchSubs() {
      setLoadingSubs(true);
      try {
        const queryParams = new URLSearchParams({
          title: animeTitle,
          ep: String(episodeNumber),
          animeId,
        });
        if (initialSubUrl) queryParams.set("website", initialSubUrl);
        if (initialCreator) queryParams.set("creatorName", initialCreator);

        const res = await fetch(`/api/anime/subtitles?${queryParams.toString()}`);
        const data = await res.json();
        if (isCancelled) return;

        if (data.success) {
          if (data.resolved_title) {
            setResolvedTitle(data.resolved_title);
          }
          if (Array.isArray(data.creators)) {
            setCreators(data.creators);
          }
          if (Array.isArray(data.subtitles) && data.subtitles.length > 0) {
            const list: SubtitleOption[] = data.subtitles.map((s: any) => ({
              name: s.name,
              format: s.is_ass ? "ASS" : "VTT",
              is_ass: Boolean(s.is_ass),
              content: s.content || "",
              url: s.url || "",
            }));
            setSubtitles(list);
            setCurrentSubIndex(0);
          }
        }
      } catch (err) {
        console.error("Error fetching subtitles:", err);
      } finally {
        if (!isCancelled) setLoadingSubs(false);
      }
    }
    fetchSubs();
    return () => {
      isCancelled = true;
    };
  }, [animeTitle, episodeNumber, animeId, initialSubUrl, initialCreator, showNotice]);

  // 6. Load SubtitlesOctopus library script
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.SubtitlesOctopus) {
      setIsOctopusScriptLoaded(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "/libass/subtitles-octopus.js";
    script.async = true;
    script.onload = () => {
      setIsOctopusScriptLoaded(true);
    };
    script.onerror = () => {
      console.warn("Failed to load /libass/subtitles-octopus.js, HTML HUD fallback will be used.");
      setIsOctopusScriptLoaded(false);
    };
    document.body.appendChild(script);
  }, []);

  // 7. When currentSub changes or script loads, parse cues or setup SubtitlesOctopus
  useEffect(() => {
    const sub = subtitles[currentSubIndex];
    if (!sub || !sub.content) return;

    if (sub.is_ass) {
      const parsed = parseAssToCues(sub.content);
      setCues(parsed);
      cuesRef.current = parsed;
      if (parsed.length > 0) setFirstDialogue(parsed[0]);
      showNotice(`${sub.name} (ASS 자막 ${parsed.length}개 대사 로드 완료)`);

      // Init SubtitlesOctopus on canvas if script is available
      if (typeof window !== "undefined" && window.SubtitlesOctopus && canvasRef.current) {
        try {
          isOctopusActiveRef.current = false;
          setIsOctopusActive(false);

          if (octopusRef.current) {
            try {
              octopusRef.current.dispose();
            } catch {}
            octopusRef.current = null;
          }
          if (currentBlobUrlRef.current) {
            try {
              URL.revokeObjectURL(currentBlobUrlRef.current);
            } catch {}
            currentBlobUrlRef.current = null;
          }

          const w = containerRef.current?.clientWidth || window.innerWidth || 1920;
          const h = containerRef.current?.clientHeight || window.innerHeight || 1080;
          if (canvasRef.current) {
            canvasRef.current.width = w;
            canvasRef.current.height = h;
          }

          const blob = new Blob([sub.content], { type: "text/plain;charset=utf-8" });
          const blobUrl = URL.createObjectURL(blob);
          currentBlobUrlRef.current = blobUrl;

          octopusRef.current = new window.SubtitlesOctopus({
            canvas: canvasRef.current,
            subUrl: blobUrl,
            subContent: sub.content,
            fonts: [],
            fallbackFont: "/libass/default.woff2",
            workerUrl: "/libass/subtitles-octopus-worker.js",
            legacyWorkerUrl: "/libass/subtitles-octopus-worker.js",
            timeOffset: syncOffsetRef.current,
            targetFps: 60,
            onReady: () => {
              isOctopusActiveRef.current = true;
              setIsOctopusActive(true);
              try {
                const cw = containerRef.current?.clientWidth || window.innerWidth || 1920;
                const ch = containerRef.current?.clientHeight || window.innerHeight || 1080;
                octopusRef.current?.resize(cw, ch);
                octopusRef.current?.setIsPaused(false, lastCurrentTimeRef.current + syncOffsetRef.current);
              } catch {}
            },
            onError: (e: any) => {
              console.warn("SubtitlesOctopus canvas fallback to HUD:", e);
              isOctopusActiveRef.current = false;
              setIsOctopusActive(false);
              try {
                octopusRef.current?.dispose();
              } catch {}
              octopusRef.current = null;
            },
          });
        } catch (e) {
          console.warn("SubtitlesOctopus canvas init skipped, using HTML HUD:", e);
          isOctopusActiveRef.current = false;
          setIsOctopusActive(false);
          octopusRef.current = null;
        }
      }
    } else {
      isOctopusActiveRef.current = false;
      setIsOctopusActive(false);
      const parsed = parseVttToCues(sub.content);
      setCues(parsed);
      cuesRef.current = parsed;
      if (parsed.length > 0) setFirstDialogue(parsed[0]);
      showNotice(`${sub.name} (자막 ${parsed.length}개 대사 로드 완료)`);
      if (octopusRef.current) {
        try {
          octopusRef.current.dispose();
        } catch {}
        octopusRef.current = null;
      }
      if (currentBlobUrlRef.current) {
        try {
          URL.revokeObjectURL(currentBlobUrlRef.current);
        } catch {}
        currentBlobUrlRef.current = null;
      }
    }

    return () => {
      if (currentBlobUrlRef.current) {
        try {
          URL.revokeObjectURL(currentBlobUrlRef.current);
        } catch {}
        currentBlobUrlRef.current = null;
      }
      if (octopusRef.current) {
        try {
          octopusRef.current.dispose();
        } catch {}
        octopusRef.current = null;
      }
      isOctopusActiveRef.current = false;
      setIsOctopusActive(false);
    };
  }, [subtitles, currentSubIndex, parseAssToCues, parseVttToCues, isOctopusScriptLoaded, showNotice]);

  // 8. FlixCloud postMessage polling (100ms) & message listeners
  useEffect(() => {
    const timer = setInterval(() => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({ command: "getTime" }, "*");
      }
    }, 100);

    const handleMessage = (event: MessageEvent) => {
      if (!event.data) return;

      // Handle Fullscreen queries from iframe
      if (event.data.zenCommand === "getFullscreenState") {
        event.source?.postMessage(
          { zenFullscreenState: Boolean(getFullscreenElement()) || isFullscreen },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          "*" as any
        );
      }

      // Handle Fullscreen toggle command from iframe
      if (event.data.zenCommand === "toggleFullscreen") {
        toggleFullscreen();
      }

      // Handle currentTime updates from FlixCloud
      if (typeof event.data.currentTime === "number") {
        const time = event.data.currentTime;
        setCurrentVideoTime(time);
        lastCurrentTimeRef.current = time;

        if (typeof event.data.duration === "number") {
          setVideoDuration(event.data.duration);
          lastDurationRef.current = event.data.duration;
        }

        // Drive SubtitlesOctopus if ASS (safely isolated from HUD rendering)
        if (octopusRef.current && typeof octopusRef.current.setCurrentTime === "function") {
          try {
            if (octopusRef.current.worker) {
              const effectiveTime = time + syncOffsetRef.current;
              // 워커의 requestAnimationFrame(가라오케/애니메이션 루프)을 계속 돌려주기 위해 setIsPaused(false) 전송
              if (typeof octopusRef.current.setIsPaused === "function") {
                octopusRef.current.setIsPaused(false, effectiveTime);
              }
              octopusRef.current.setCurrentTime(effectiveTime);
            } else {
              isOctopusActiveRef.current = false;
              setIsOctopusActive(false);
              octopusRef.current = null;
            }
          } catch (e) {
            console.warn("SubtitlesOctopus setCurrentTime exception, fallback to HUD:", e);
            isOctopusActiveRef.current = false;
            setIsOctopusActive(false);
            try {
              octopusRef.current?.dispose();
            } catch {}
            octopusRef.current = null;
          }
        }

        // Drive HTML HUD text (하단 대사 & 상단 설명 자막 분리 렌더링)
        const currentSub = subtitles[currentSubIndex];
        const isCurrentAss = Boolean(currentSub?.is_ass);
        const shouldHideHud =
          !isSubEnabledRef.current ||
          cuesRef.current.length === 0 ||
          (isCurrentAss && isOctopusActiveRef.current);

        if (shouldHideHud) {
          if (hudTextRef.current) {
            hudTextRef.current.style.display = "none";
            hudTextRef.current.innerText = "";
          }
          if (topHudTextRef.current) {
            topHudTextRef.current.style.display = "none";
            topHudTextRef.current.innerText = "";
          }
        } else {
          // VTT 자막이거나, ASS 자막이지만 Octopus가 준비/로딩 중일 때 즉시 0ms 딜레이로 HTML HUD로 선명하게 표시!
          const effectiveTime = time + syncOffsetRef.current;
          const matchedCues = cuesRef.current.filter((c) => effectiveTime >= c.start && effectiveTime <= c.end);
          const bottomCues = matchedCues.filter((c) => !c.isTop);
          const topCues = matchedCues.filter((c) => c.isTop);

          if (hudTextRef.current) {
            if (bottomCues.length > 0) {
              hudTextRef.current.innerText = bottomCues.map((c) => c.text).join("\n");
              hudTextRef.current.style.display = "block";
            } else {
              hudTextRef.current.innerText = "";
              hudTextRef.current.style.display = "none";
            }
          }

          if (topHudTextRef.current) {
            if (topCues.length > 0) {
              topHudTextRef.current.innerText = topCues.map((c) => c.text).join("\n");
              topHudTextRef.current.style.display = "block";
            } else {
              topHudTextRef.current.innerText = "";
              topHudTextRef.current.style.display = "none";
            }
          }
        }

        // Save history every 10 seconds
        const now = Date.now();
        if (now - lastHistorySaveTime.current > 10000 && time > 2) {
          lastHistorySaveTime.current = now;
          syncHistory(false);
        }
      }
    };

    window.addEventListener("message", handleMessage);

    const syncOctopusCanvasSize = () => {
      const isFs = Boolean(getFullscreenElement()) || isFullscreen;
      setIsFullscreen(isFs);
      if (!isFs) {
        document.body.style.overflow = "";
      }
      try {
        iframeRef.current?.contentWindow?.postMessage(
          { zenFullscreenState: isFs, event: "fullscreen", isFullscreen: isFs },
          "*"
        );
      } catch {}

      if (octopusRef.current && typeof octopusRef.current.resize === "function") {
        try {
          const w = isFs ? window.innerWidth : containerRef.current?.clientWidth || window.innerWidth || 1920;
          const h = isFs ? window.innerHeight : containerRef.current?.clientHeight || window.innerHeight || 1080;
          if (canvasRef.current) {
            canvasRef.current.width = w;
            canvasRef.current.height = h;
          }
          octopusRef.current?.resize(w, h);
        } catch {}
      }
    };

    const handleFullscreenChange = () => {
      syncOctopusCanvasSize();
      setTimeout(syncOctopusCanvasSize, 100);
      setTimeout(syncOctopusCanvasSize, 300);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (isFullscreen || Boolean(getFullscreenElement()))) {
        toggleFullscreen();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);
    window.addEventListener("resize", syncOctopusCanvasSize);

    const handleUnload = () => {
      syncHistory(false);
    };
    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);

    return () => {
      syncHistory(false);
      clearInterval(timer);
      document.body.style.overflow = "";
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange);
      window.removeEventListener("resize", syncOctopusCanvasSize);
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
      if (fsControlsTimerRef.current) {
        clearTimeout(fsControlsTimerRef.current);
      }
    };
  }, [
    syncHistory,
    getFullscreenElement,
    isFullscreen,
    toggleFullscreen,
    subtitles,
    currentSubIndex,
  ]);

  // 9. 이전 시청 기록 조회 및 이어보기 안내 / 복원 시도
  useEffect(() => {
    let isCancelled = false;
    async function checkSavedHistory() {
      try {
        const res = await fetch(`/api/anime/history?anime_id=${encodeURIComponent(animeId)}`);
        const data = await res.json();
        if (isCancelled || !data.success || !Array.isArray(data.items)) return;

        const epItem = data.items.find((item: any) => Number(item.episode_number) === Number(episodeNumber));
        if (epItem) {
          const savedTime = parseFloat(epItem.watch_time || epItem.current_time || "0");
          if (savedTime > 10 && !epItem.is_completed) {
            showNotice(`이어보기: ${formatTime(savedTime)}부터 시청 기록이 있습니다.`);
            if (iframeRef.current?.contentWindow) {
              iframeRef.current.contentWindow.postMessage({ command: "seek", time: savedTime }, "*");
              iframeRef.current.contentWindow.postMessage({ command: "setCurrentTime", time: savedTime }, "*");
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch anime history for resume:", err);
      }
    }
    checkSavedHistory();
    return () => {
      isCancelled = true;
    };
  }, [animeId, episodeNumber, showNotice]);

  // Adjust Sync Offset
  const adjustSync = (delta: number) => {
    const nextVal = Math.round((syncOffset + delta) * 10) / 10;
    setSyncOffset(nextVal);
    saveSyncToDb(nextVal);
  };

  const resetSync = () => {
    setSyncOffset(0.0);
    saveSyncToDb(0.0);
    showNotice("싱크가 0.0초로 초기화되었습니다.");
  };

  // Instant Sync matching first dialogue
  const handleAutoSyncFirstDialogue = () => {
    if (!firstDialogue) {
      showNotice("자막의 첫 대사 정보를 불러오지 못했습니다.");
      return;
    }
    // Dialogue time in sub vs current playback time in video
    // When dialogue is spoken, currentVideoTime + offset = firstDialogue.start
    // => offset = firstDialogue.start - currentVideoTime
    const calculatedOffset = Math.round((firstDialogue.start - currentVideoTime) * 10) / 10;
    setSyncOffset(calculatedOffset);
    saveSyncToDb(calculatedOffset);
    showNotice(
      `첫 대사에 맞춰 싱크가 ${calculatedOffset > 0 ? `+${calculatedOffset}` : calculatedOffset}초로 자동 조정되었습니다! 🎯`
    );
  };

  const cycleSubSize = () => {
    if (subSize === "small") setSubSize("normal");
    else if (subSize === "normal") setSubSize("large");
    else setSubSize("small");
  };

  const handleSelectSubtitle = (selectedSub: SubtitleOption) => {
    setSubtitles((prev) => {
      const idx = prev.findIndex((s) => s.name === selectedSub.name);
      if (idx >= 0) {
        setCurrentSubIndex(idx);
        return prev;
      }
      const updated = [selectedSub, ...prev];
      setCurrentSubIndex(0);
      return updated;
    });
    saveSyncToDb(syncOffset);
    showNotice(`자막 [${selectedSub.name}] 적용 완료! ✨`);
  };

  const subSizeClasses = {
    small: "text-[clamp(16px,2.4vw,24px)] leading-snug",
    normal: "text-[clamp(20px,3.2vw,34px)] leading-tight",
    large: "text-[clamp(24px,4.0vw,42px)] leading-tight",
  };

  return (
    <div className="flex flex-col space-y-4">
      {/* Top Header / Breadcrumb & Episode Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-purple-500/20 bg-slate-900/60 p-3 sm:p-4 backdrop-blur-md">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <Link
            href={`/anime/${animeId}`}
            onClick={() => {
              setNavigatingTarget("anime");
              syncHistory(false);
            }}
            className={`shrink-0 flex items-center gap-1.5 rounded-xl px-2.5 sm:px-3 py-1.5 text-xs font-semibold transition ${
              navigatingTarget === "anime"
                ? "bg-purple-600 text-white pointer-events-none cursor-wait"
                : "bg-purple-600/20 text-purple-300 hover:bg-purple-600 hover:text-white"
            } ${navigatingTarget && navigatingTarget !== "anime" ? "pointer-events-none opacity-60" : ""}`}
          >
            {navigatingTarget === "anime" ? (
              <Loader2 className="h-4 w-4 animate-spin text-white" />
            ) : (
              <ArrowLeft className="h-4 w-4" />
            )}
            {navigatingTarget === "anime" ? "이동 중..." : "작품으로"}
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm sm:text-base font-bold text-white truncate">
              {resolvedTitle || animeTitle}
            </h1>
            <p className="text-[11px] sm:text-xs text-purple-400 truncate">
              {initialEpTitle || `${episodeNumber}화`} • {resolvedTitle ? animeTitle : "ReAnime 1080p"}
            </p>
          </div>
        </div>

        {/* Episode Switcher Dropdown & Nav Buttons */}
        <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto shrink-0 border-t sm:border-t-0 border-white/5 pt-2 sm:pt-0">
          {linkPreEp && (
            <Link
              href={`/watch/${animeId}/${linkPreEp}`}
              onClick={() => {
                setNavigatingTarget("prev");
                syncHistory(false);
              }}
              className={`flex items-center justify-center gap-1 rounded-xl border px-2.5 sm:px-3 py-1.5 text-xs font-semibold transition shrink-0 ${
                navigatingTarget === "prev"
                  ? "border-purple-500 bg-purple-900/40 text-purple-200 pointer-events-none cursor-wait"
                  : "border-white/10 bg-slate-800/80 text-slate-300 hover:border-purple-500 hover:text-white"
              } ${navigatingTarget && navigatingTarget !== "prev" ? "pointer-events-none opacity-60" : ""}`}
            >
              {navigatingTarget === "prev" ? (
                <Loader2 className="h-4 w-4 animate-spin text-purple-300" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
              {navigatingTarget === "prev" ? "이동..." : "이전화"}
            </Link>
          )}

          {subEpisodes.length > 0 && (
            <div className="relative flex-1 sm:flex-initial min-w-[110px] max-w-[200px] sm:max-w-none">
              <select
                disabled={Boolean(navigatingTarget)}
                value={episodeNumber}
                onChange={(e) => {
                  const targetEp = e.target.value;
                  if (targetEp) {
                    setNavigatingTarget("select");
                    syncHistory(false);
                    window.location.href = `/watch/${animeId}/${targetEp}`;
                  }
                }}
                className={`w-full appearance-none rounded-xl border border-purple-500/30 bg-slate-800/90 py-1.5 pl-3 pr-8 text-xs font-bold text-purple-200 outline-none transition focus:border-purple-400 cursor-pointer ${
                  navigatingTarget ? "opacity-70 cursor-wait" : ""
                }`}
              >
                {subEpisodes.map((ep) => (
                  <option key={ep.number} value={ep.number} className="bg-slate-900 text-white">
                    {ep.title || `${ep.number}화`}
                  </option>
                ))}
              </select>
              {navigatingTarget === "select" ? (
                <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-purple-300" />
              ) : (
                <List className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-purple-400" />
              )}
            </div>
          )}

          {linkNextEp && (
            <Link
              href={`/watch/${animeId}/${linkNextEp}`}
              onClick={() => {
                setNavigatingTarget("next");
                syncHistory(true);
              }}
              className={`flex items-center justify-center gap-1 rounded-xl px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-white transition shrink-0 ${
                navigatingTarget === "next"
                  ? "bg-purple-700 pointer-events-none cursor-wait"
                  : "bg-purple-600 hover:bg-purple-500"
              } ${navigatingTarget && navigatingTarget !== "next" ? "pointer-events-none opacity-60" : ""}`}
            >
              {navigatingTarget === "next" ? (
                <Loader2 className="h-4 w-4 animate-spin text-white" />
              ) : null}
              <span>{navigatingTarget === "next" ? "이동..." : "다음화"}</span>
              {navigatingTarget !== "next" && <ChevronRight className="h-4 w-4" />}
            </Link>
          )}
        </div>
      </div>

      {/* Main Video Box with Subtitle HUD Overlay */}
      <div
        ref={containerRef}
        onMouseMove={isFullscreen ? triggerFsControls : undefined}
        onTouchStart={isFullscreen ? triggerFsControls : undefined}
        className={`relative aspect-video w-full overflow-hidden rounded-2xl border border-purple-500/30 bg-black ${
          isFullscreen ? "fixed inset-0 z-50 h-[100dvh] w-screen rounded-none border-none" : ""
        }`}
      >
        {/* Layer 1: Sandboxed FlixCloud Iframe */}
        {embedUrl && !embedUrl.includes("reanime.to/watch") ? (
          <iframe
            ref={iframeRef}
            src={embedUrl}
            title="Anime Player"
            className="absolute inset-0 h-full w-full border-0 z-0"
            allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
            referrerPolicy="no-referrer-when-downgrade"
          />
        ) : (
          <div className="absolute inset-0 z-0 flex flex-col items-center justify-center bg-black/90 p-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-purple-400 mb-3" />
            <p className="text-sm font-semibold text-slate-300">
              영상 스트림 플레이어를 불러오는 중입니다...
            </p>
          </div>
        )}

        {/* Layer 2a: SubtitlesOctopus ASS Canvas (WASM libass) */}
        <canvas
          ref={canvasRef}
          className={`absolute inset-0 h-full w-full pointer-events-none z-10 ${
            isSubEnabled && isOctopusActive ? "block" : "hidden"
          }`}
        />

        {/* Layer 2b-Top: Top Subtitle HUD Overlay (상단 설명/가사 자막) */}
        <div className="absolute inset-0 pointer-events-none z-20 flex flex-col justify-start items-center pt-[5%] overflow-hidden">
          <div
            ref={topHudTextRef}
            className={`font-black text-amber-300 text-center max-w-[88%] px-4 py-1.5 rounded-xl transition-all duration-75 select-none whitespace-pre-line ${subSizeClasses[subSize]}`}
            style={{
              textShadow:
                "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, -3px 0 0 #000, 3px 0 0 #000, 0 -3px 0 #000, 0 3px 0 #000, 0 4px 14px rgba(0, 0, 0, 0.95)",
              display: "none",
            }}
          />
        </div>

        {/* Layer 2b: Text / VTT Subtitle HUD Overlay (하단 대사) */}
        <div className="absolute inset-0 pointer-events-none z-20 flex flex-col justify-end items-center pb-[7.5%] overflow-hidden">
          <div
            ref={hudTextRef}
            className={`font-black text-white text-center max-w-[88%] px-4 py-1.5 rounded-xl transition-all duration-75 select-none whitespace-pre-line ${subSizeClasses[subSize]}`}
            style={{
              textShadow:
                "-2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, -3px 0 0 #000, 3px 0 0 #000, 0 -3px 0 #000, 0 3px 0 #000, 0 4px 14px rgba(0, 0, 0, 0.95)",
              display: "none",
            }}
          />
        </div>

        {/* Toast Notification Banner inside player */}
        {noticeMessage && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-xl border border-purple-500/40 bg-slate-900/90 px-4 py-2 text-xs font-bold text-purple-200 backdrop-blur-md animate-fade-in pointer-events-none">
            <Sparkles className="h-4 w-4 text-purple-400" />
            {noticeMessage}
          </div>
        )}

        {/* Layer 2c: Fullscreen Floating Overlay Controls (전체화면 종료 버튼만 노출) */}
        {isFullscreen && (
          <div
            className={`absolute inset-0 z-30 pointer-events-none transition-opacity duration-300 p-4 sm:p-6 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] ${
              showFsControls ? "opacity-100" : "opacity-0"
            }`}
          >
            {/* Top Right: Exit Fullscreen Button */}
            <div className="flex items-center justify-end pointer-events-auto">
              <button
                onClick={toggleFullscreen}
                className="flex items-center gap-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-purple-500/40 px-3.5 py-2 text-xs font-bold text-white backdrop-blur-md transition active:scale-95 cursor-pointer"
                title="전체화면 종료 (ESC)"
              >
                <Minimize2 className="h-4 w-4 text-purple-400" />
                전체화면 종료
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Layer 3: Subtitle Control Toolbar (플레이어 하단) */}
      <div className="rounded-2xl border border-purple-500/20 bg-slate-900/70 p-3 sm:p-4 backdrop-blur-md space-y-3">
        {/* Row 1: Subtitle Source & First Dialogue Guide */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 border-b border-white/5 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-xs font-bold text-emerald-400">
              <Subtitles className="h-3.5 w-3.5" />
              {subtitles[currentSubIndex]?.name || "자막 연동 중..."}
            </span>

            {/* 스트리밍 소스 뱃지 */}
            <span className="flex items-center gap-1.5 rounded-lg bg-purple-500/15 border border-purple-500/30 px-2.5 py-1 text-xs font-bold text-purple-300">
              <Film className="h-3.5 w-3.5 text-purple-400" />
              {serverSources[0]?.label || "1080p 고화질 스트림"}
            </span>

            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-600/20 px-2.5 py-1 text-xs font-bold text-purple-300 transition hover:bg-purple-600 hover:text-white active:scale-95 cursor-pointer"
              title="다른 자막 제작자 선택, 수동 검색, 내 파일 직접 열기"
            >
              <Search className="h-3.5 w-3.5" />
              자막 변경 / 검색
            </button>

            {/* Video Time Monitor */}
            <span className="flex items-center gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 font-mono text-xs font-semibold text-sky-400">
              <Clock className="h-3 w-3" />
              {formatTime(currentVideoTime)} / {formatTime(videoDuration)}
            </span>

            {loadingSubs && (
              <span className="flex items-center gap-1 text-xs text-purple-400 animate-pulse">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> 자막 검색 중...
              </span>
            )}
          </div>

          {/* First Dialogue Guide & Instant Sync Button */}
          {firstDialogue && (
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="flex items-center gap-1.5 rounded-lg bg-slate-800/80 px-3 py-1 text-xs text-slate-300 border border-purple-500/20"
                title={`자막 첫 대사: "${firstDialogue.text}"`}
              >
                <span className="font-bold text-purple-400">📌 첫 대사:</span>
                <span className="max-w-[200px] truncate text-slate-200">
                  &quot;{firstDialogue.text}&quot;
                </span>
                <span className="font-mono text-sky-400">
                  ({formatTime(firstDialogue.start)})
                </span>
              </div>

              <button
                onClick={handleAutoSyncFirstDialogue}
                className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-3 py-1 text-xs font-bold text-white transition hover:brightness-110 active:scale-95 cursor-pointer"
              >
                <Target className="h-3.5 w-3.5 text-yellow-300" />
                지금 대사에 맞추기
              </button>
            </div>
          )}
        </div>

        {/* Row 2: Fine-Tuning Sync Offset & Tooling */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Sync Offset Adjuster */}
          <div className="flex items-center gap-1.5 text-xs overflow-x-auto no-scrollbar py-0.5 max-w-full">
            <span className="font-bold text-slate-400 mr-1 shrink-0">싱크 미세조절:</span>
            <button
              onClick={() => adjustSync(-5.0)}
              className="shrink-0 rounded-lg border border-white/10 bg-slate-800 px-2 py-1 font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white active:scale-95 cursor-pointer"
            >
              -5s
            </button>
            <button
              onClick={() => adjustSync(-1.0)}
              className="shrink-0 rounded-lg border border-white/10 bg-slate-800 px-2 py-1 font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white active:scale-95 cursor-pointer"
            >
              -1s
            </button>
            <button
              onClick={() => adjustSync(-0.1)}
              className="shrink-0 rounded-lg border border-white/10 bg-slate-800 px-2 py-1 font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white active:scale-95 cursor-pointer"
            >
              -0.1s
            </button>

            <span className="shrink-0 min-w-[56px] text-center font-mono text-sm font-extrabold text-purple-300">
              {syncOffset > 0 ? `+${syncOffset.toFixed(1)}s` : `${syncOffset.toFixed(1)}s`}
            </span>

            <button
              onClick={() => adjustSync(0.1)}
              className="shrink-0 rounded-lg border border-white/10 bg-slate-800 px-2 py-1 font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white active:scale-95 cursor-pointer"
            >
              +0.1s
            </button>
            <button
              onClick={() => adjustSync(1.0)}
              className="shrink-0 rounded-lg border border-white/10 bg-slate-800 px-2 py-1 font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white active:scale-95 cursor-pointer"
            >
              +1s
            </button>
            <button
              onClick={() => adjustSync(5.0)}
              className="shrink-0 rounded-lg border border-white/10 bg-slate-800 px-2 py-1 font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white active:scale-95 cursor-pointer"
            >
              +5s
            </button>

            <button
              onClick={resetSync}
              className="shrink-0 flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800 px-2 py-1 font-semibold text-slate-400 transition hover:bg-slate-700 hover:text-slate-200 cursor-pointer"
              title="싱크 0초로 초기화"
            >
              <RotateCcw className="h-3 w-3" />
              초기화
            </button>

            {isSavedSync && (
              <span className="shrink-0 flex items-center gap-1 text-[11px] text-emerald-400 ml-1">
                <Check className="h-3 w-3" /> 저장됨
              </span>
            )}
          </div>

          {/* Subtitle Toggle, Size & Fullscreen */}
          <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
            <button
              onClick={() => setIsSubEnabled(!isSubEnabled)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition cursor-pointer ${
                isSubEnabled
                  ? "bg-purple-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              자막 {isSubEnabled ? "ON" : "OFF"}
            </button>

            <button
              onClick={cycleSubSize}
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white cursor-pointer"
              title="자막 크기 변경"
            >
              <Type className="h-3.5 w-3.5 text-purple-400" />
              {subSize === "small" ? "작게" : subSize === "normal" ? "보통" : "크게"}
            </button>

            <button
              onClick={toggleFullscreen}
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-purple-500 hover:text-white cursor-pointer"
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="h-3.5 w-3.5" /> 축소
                </>
              ) : (
                <>
                  <Maximize2 className="h-3.5 w-3.5" /> 전체화면
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Subtitle Selection & Search Modal */}
      <SubtitleSelectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        animeId={animeId}
        animeTitle={resolvedTitle || animeTitle}
        episodeNumber={episodeNumber}
        creators={creators}
        currentSubName={subtitles[currentSubIndex]?.name}
        onSelectSubtitle={handleSelectSubtitle}
      />
    </div>
  );
}

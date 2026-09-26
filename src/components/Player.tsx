"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  List,
  MessageSquare,
  Sparkles,
  Mic,
  Film,
  Search,
  Loader2,
  Wand2,
  CheckCircle2,
  RotateCw,
  Users,
  FolderOpen,
  ExternalLink,
  Check,
  UserPen,
  Download,
  Settings,
  AlertCircle,
} from "lucide-react";
import Link from "next/link";
import PlayerSettingsModal, {
  PlayerSettings,
  loadPlayerSettings,
  savePlayerSettings,
  applyPlayerSettingsStyles,
  fetchUserSettingsFromDb,
  saveUserSettingsToDb,
  DEFAULT_PLAYER_SETTINGS,
} from "./PlayerSettingsModal";
import IframePlayer from "./IframePlayer";
import { isReanimeId, ServerSource } from "@/lib/providers";

export interface EpisodeItem {
  number: number;
  title: string;
  watch_url: string;
}

export interface CreatorInfo {
  name: string;
  episode: string;
  update_date: string;
  website: string;
  is_current_ep: boolean;
}

const SPEED_CYCLE_RATES = [1.0, 1.3, 1.5, 2.0];

function updateSpeed2xButton(rate: number, doc?: Document) {
  if (typeof rate === "number" && !isNaN(rate) && rate > 0) {
    try {
      localStorage.setItem("anime_playback_rate", String(rate));
    } catch {}
  }
  // Document PiP 활성 시 버튼은 PIP 윈도우의 문서에 있으므로,
  // 플레이어 엘리먼트의 ownerDocument 기준으로 레이블을 찾아야 한다
  const targetDoc = doc || (typeof document !== "undefined" ? document : undefined);
  if (!targetDoc) return;
  const label = (targetDoc.querySelector(".speed-rate-label") ||
    targetDoc.querySelector(".speed-2x-label")) as HTMLElement | null;
  if (!label) return;

  const isNormal = Math.abs(rate - 1.0) < 0.05;
  const rateText = isNormal ? "1x" : `${rate}x`;

  if (!isNormal) {
    label.style.background = "#ffffff";
    label.style.borderColor = "#ffffff";
    label.style.boxShadow = "0 0 10px rgba(255, 255, 255, 0.7)";
    label.style.color = "#090d16";
    label.innerText = rateText;
  } else {
    label.style.background = "rgba(255, 255, 255, 0.12)";
    label.style.borderColor = "rgba(255, 255, 255, 0.25)";
    label.style.boxShadow = "none";
    label.style.color = "#ffffff";
    label.innerText = "1x";
  }
}

interface SubtitleItem {
  name: string;
  format: "ASS" | "VTT";
  is_ass: boolean;
  content?: string;
  url?: string;
}

interface SkipInterval {
  type: "op" | "ed" | "mixed-op" | "mixed-ed";
  label: "오프닝" | "엔딩";
  start: number;
  end: number;
}

export interface PlayerProps {
  animeId: string;
  animeTitle: string;
  animePoster?: string;
  episodeNumber: number;
  initialEpTitle?: string;
  m3u8Url: string;
  defaultVttUrl?: string;
  linkPre?: string;
  linkNext?: string;
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

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Artplayer: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Hls: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SubtitlesOctopus: any;
  }
}

export default function Player(props: PlayerProps) {
  if (props.streamType === "iframe" || isReanimeId(props.animeId)) {
    return <IframePlayer {...props} />;
  }

  const {
    animeId,
    animeTitle,
    animePoster,
    episodeNumber,
    initialEpTitle,
    m3u8Url,
    defaultVttUrl,
    linkPreEp,
    linkNextEp,
    isDub,
    subEpisodes,
    dubEpisodes,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const artRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const octopusRef = useRef<any>(null);

  // Hybrid PiP Refs
  const currentAssContentRef = useRef<string | null>(null);
  const currentSubRef = useRef<SubtitleItem | null>(null);
  const pendingSubtitleRef = useRef<SubtitleItem | null>(null);
  const applySubtitleRef = useRef<((sub: SubtitleItem, offset?: number) => void) | null>(null);
  const refreshSubtitleSettingsRef = useRef<((currentSubs: SubtitleItem[], activeIdx: number) => void) | null>(null);
  const currentSyncOffsetRef = useRef<number>(0.0);
  const docPipWindowRef = useRef<Window | null>(null);
  const docPipPlaceholderRef = useRef<HTMLDivElement | null>(null);
  const nativePipTextTrackRef = useRef<TextTrack | null>(null);
  const pipTrackElementRef = useRef<HTMLTrackElement | null>(null);
  const currentBlobUrlRef = useRef<string | null>(null);

  // 즉시 플레이어 음원/재생 중지 및 자원 해제 (페이지 이동, 언마운트, 회차 이동 시 음원 누출 방지)
  const stopPlayerImmediately = useCallback(() => {
    try {
      // 1) PiP 종료 (Document PiP 및 Native PiP)
      if (docPipWindowRef.current && !docPipWindowRef.current.closed) {
        try {
          const pipVids = docPipWindowRef.current.document.querySelectorAll("video");
          pipVids.forEach((v) => {
            try {
              v.pause();
              v.muted = true;
              v.volume = 0;
              v.removeAttribute("src");
              v.load();
            } catch {}
          });
          docPipWindowRef.current.close();
        } catch {}
        docPipWindowRef.current = null;
      }
      if (typeof document !== "undefined" && document.pictureInPictureElement) {
        try {
          document.exitPictureInPicture().catch(() => {});
        } catch {}
      }

      // 2) ArtPlayer 인스턴스 정지 및 HLS 해제
      const art = artRef.current;
      if (art) {
        if (art.hls) {
          try {
            art.hls.stopLoad?.();
            art.hls.detachMedia?.();
            art.hls.destroy?.();
          } catch {}
          art.hls = null;
        }
        if (art.video) {
          try {
            art.video.pause();
            art.video.muted = true;
            art.video.volume = 0;
            art.video.removeAttribute("src");
            art.video.load();
          } catch {}
        }
      }

      // 3) 혹시 DOM 컨테이너에 남아있을 수 있는 모든 video 태그 정지
      if (containerRef.current) {
        try {
          const vids = containerRef.current.querySelectorAll("video");
          vids.forEach((v) => {
            try {
              v.pause();
              v.muted = true;
              v.volume = 0;
              v.removeAttribute("src");
              v.load();
            } catch {}
          });
        } catch {}
      }
    } catch (e) {
      console.warn("[stopPlayerImmediately error]:", e);
    }
  }, []);

  // Episode Navigator States
  const currentEpisodes = (isDub ? dubEpisodes : subEpisodes) || [];

  // Episode & Stream States (무중단 회차 전환 지원)
  const [currentEp, setCurrentEp] = useState<number>(episodeNumber);
  const [currentEpTitle, setCurrentEpTitle] = useState<string>(() => {
    if (initialEpTitle) return initialEpTitle;
    const found = currentEpisodes.find((e) => e.number === episodeNumber);
    return found?.title || `${episodeNumber}화`;
  });
  const [currentM3u8Url, setCurrentM3u8Url] = useState<string>(m3u8Url);
  const [currentVttUrl, setCurrentVttUrl] = useState<string>(defaultVttUrl || "");
  const [currentPreEp, setCurrentPreEp] = useState<number | null>(linkPreEp ?? null);
  const [currentNextEp, setCurrentNextEp] = useState<number | null>(linkNextEp ?? null);
  const [isSwitchingEp, setIsSwitchingEp] = useState<number | null>(null);
  const [navigatingTarget, setNavigatingTarget] = useState<string | null>(null);

  const currentEpRef = useRef(currentEp);
  currentEpRef.current = currentEp;
  const currentM3u8UrlRef = useRef(currentM3u8Url);
  currentM3u8UrlRef.current = currentM3u8Url;
  const currentPreEpRef = useRef(currentPreEp);
  currentPreEpRef.current = currentPreEp;
  const currentNextEpRef = useRef(currentNextEp);
  currentNextEpRef.current = currentNextEp;
  const isSwitchingEpRef = useRef(false);
  const syncHistoryRef = useRef<((isCompleted?: boolean) => void) | null>(null);
  const switchEpisodeRef = useRef<((targetEp: number) => Promise<void>) | null>(null);
  const lastSyncTimeRef = useRef<number>(0);

  // External navigation (props change) sync
  const isFirstMountRef = useRef(true);
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      return;
    }
    setCurrentEp(episodeNumber);
    if (initialEpTitle) {
      setCurrentEpTitle(initialEpTitle);
    } else {
      const found = currentEpisodes.find((e) => e.number === episodeNumber);
      setCurrentEpTitle(found?.title || `${episodeNumber}화`);
    }
    setCurrentM3u8Url(m3u8Url);
    setCurrentVttUrl(defaultVttUrl || "");
    setCurrentPreEp(linkPreEp ?? null);
    setCurrentNextEp(linkNextEp ?? null);

    // 이미 플레이어가 초기화되어 있고 회차가 달라졌다면 switchEpisode 호출 (전환 중이 아닐 때만)
    if (artRef.current && !isSwitchingEpRef.current && episodeNumber !== currentEpRef.current && switchEpisodeRef.current) {
      switchEpisodeRef.current(episodeNumber);
    }
  }, [episodeNumber, initialEpTitle, m3u8Url, defaultVttUrl, linkPreEp, linkNextEp]);

  const CHUNK_SIZE = 50;
  const chunkCount = Math.ceil(currentEpisodes.length / CHUNK_SIZE);

  const getInitialChunkIndex = () => {
    if (currentEpisodes.length <= CHUNK_SIZE) return 0;
    const foundIdx = currentEpisodes.findIndex((e) => e.number === episodeNumber);
    if (foundIdx !== -1) {
      return Math.floor(foundIdx / CHUNK_SIZE);
    }
    return 0;
  };

  const [selectedChunk, setSelectedChunk] = useState<number>(getInitialChunkIndex);
  const [jumpInput, setJumpInput] = useState<string>("");
  const [jumpError, setJumpError] = useState<string>("");
  const activePillRef = useRef<HTMLButtonElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Sync selected chunk when currentEp or list changes
  useEffect(() => {
    if (currentEpisodes.length > CHUNK_SIZE) {
      const foundIdx = currentEpisodes.findIndex((e) => e.number === currentEp);
      if (foundIdx !== -1) {
        setSelectedChunk(Math.floor(foundIdx / CHUNK_SIZE));
      }
    }
  }, [currentEp, currentEpisodes.length]);

  // Auto scroll active episode into center view (전체화면 풀림 방지)
  useEffect(() => {
    const timer = setTimeout(() => {
      // 🌟 전체화면 중에는 외부 DOM 스크롤 시 브라우저가 전체화면을 강제 종료하므로 실행하지 않음
      if (document.fullscreenElement || artRef.current?.fullscreen) return;
      if (scrollContainerRef.current && activePillRef.current) {
        const container = scrollContainerRef.current;
        const pill = activePillRef.current;
        const offsetLeft = pill.offsetLeft - container.offsetWidth / 2 + pill.offsetWidth / 2;
        container.scrollTo({
          left: Math.max(0, offsetLeft),
          behavior: "smooth",
        });
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [selectedChunk, currentEp]);

  // 전체화면 해제 시 현재 활성 회차 알약 스크롤 위치 복원
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && !artRef.current?.fullscreen) {
        if (scrollContainerRef.current && activePillRef.current) {
          const container = scrollContainerRef.current;
          const pill = activePillRef.current;
          const offsetLeft = pill.offsetLeft - container.offsetWidth / 2 + pill.offsetWidth / 2;
          container.scrollTo({
            left: Math.max(0, offsetLeft),
            behavior: "smooth",
          });
        }
      }
    };
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      document.removeEventListener("webkitfullscreenchange", onFsChange);
    };
  }, []);

  // 무중단 다음화 / 특정 회차 전환 함수 (전체화면 유지)
  const switchEpisode = useCallback(
    async (targetEp: number) => {
      if (isSwitchingEpRef.current || !artRef.current) return;
      isSwitchingEpRef.current = true;
      setIsSwitchingEp(targetEp);

      const art = artRef.current;
      art.notice.show = `${targetEp}화 로딩 중...`;

      try {
        // 1. 현재 에피소드 시청 완료 기록 및 로컬 캐시 정리
        const prevSaveKey = `anime_progress_${animeId}_ep${currentEpRef.current}`;
        localStorage.removeItem(prevSaveKey);
        if (syncHistoryRef.current) {
          syncHistoryRef.current(true);
        }

        // 2. 이전 자막 정리 (새 회차 자막 로드 전 잔상 방지)
        if (octopusRef.current) {
          try {
            octopusRef.current.dispose();
          } catch {}
          octopusRef.current = null;
        }
        if (containerRef.current) {
          containerRef.current
            .querySelectorAll(".libassjs-canvas-parent, canvas.libassjs-canvas")
            .forEach((el) => el.remove());
        }
        if (art.template?.$player) {
          art.template.$player
            .querySelectorAll(".libassjs-canvas-parent, canvas.libassjs-canvas")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .forEach((el: any) => el.remove());
        }
        // Native PiP 자막 트랙 큐 정리 (새 회차 자막 로드 전 잔상 방지)
        if (nativePipTextTrackRef.current && nativePipTextTrackRef.current.cues) {
          Array.from(nativePipTextTrackRef.current.cues).forEach((c) => {
            try {
              nativePipTextTrackRef.current?.removeCue(c);
            } catch {}
          });
        }
        if (art.template?.$subtitle) {
          art.template.$subtitle.style.display = "none";
        }

        // 3. 새 회차 스트림 정보 API 호출
        const res = await fetch(
          `/api/anime/episode_info?id=${encodeURIComponent(animeId)}&ep=${targetEp}${isDub ? "&is_dub=1" : ""}`
        );
        const data = await res.json();

        if (!data.success || !data.proxied_m3u8) {
          throw new Error(data.message || "새 회차 스트림 정보를 불러오지 못했습니다.");
        }

        const newM3u8 = data.proxied_m3u8;
        const newVtt = data.proxied_vtt || "";
        let newNextEp = data.link_next_ep_num ?? null;
        let newPreEp = data.link_pre_ep_num ?? null;
        const epTitle = data.episode_title || `${targetEp}화`;

        // 클라이언트 목록 기반 이전/다음 회차 번호 보정
        const foundIdx = currentEpisodes.findIndex((e) => e.number === targetEp);
        if (foundIdx !== -1) {
          if (newPreEp === null && foundIdx > 0) newPreEp = currentEpisodes[foundIdx - 1].number;
          if (newNextEp === null && foundIdx + 1 < currentEpisodes.length) newNextEp = currentEpisodes[foundIdx + 1].number;
        }

        // 4. 페이지 이동 없이 브라우저 URL 갱신 (Next.js 가로채기 방지 -> 전체화면 유지)
        const nextUrl = `/watch/${animeId}/${targetEp}${isDub ? "?dub=1" : ""}`;
        try {
          // Next.js App Router의 라우트 변경(RSC 리마운트 및 전체화면 풀림) 인터셉트 방지: __NA: true
          const nextState = { ...(window.history.state || {}), __NA: true };
          window.history.replaceState(nextState, "", nextUrl);
        } catch {
          try {
            window.history.replaceState(null, "", nextUrl);
          } catch {}
        }
        document.title = `${animeTitle} ${epTitle} - Netizen Anime`;

        // 5. 상태 및 ref 즉각 동기화 (비동기 렌더 지연 없이 이벤트 핸들러가 즉시 새 회차 참조)
        currentEpRef.current = targetEp;
        currentM3u8UrlRef.current = newM3u8;
        currentPreEpRef.current = newPreEp;
        currentNextEpRef.current = newNextEp;
        lastSyncTimeRef.current = 0; // 새 회차 첫 진행도 즉시 DB 동기화 준비

        setCurrentEp(targetEp);
        setCurrentEpTitle(epTitle);
        setCurrentM3u8Url(newM3u8);
        setCurrentVttUrl(newVtt);
        setCurrentPreEp(newPreEp);
        setCurrentNextEp(newNextEp);

        // 6. 플레이어 스트림 전환 및 즉시 재생 (전체화면 / PIP 상태 보존)
        const isDocPip = Boolean(docPipWindowRef.current && !docPipWindowRef.current.closed);
        const isNativePip = Boolean(
          (document.pictureInPictureElement && document.pictureInPictureElement === art?.video) ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (art?.video && (art.video as any).webkitPresentationMode === "picture-in-picture")
        );
        const isAnyPip = isDocPip || isNativePip;

        // PIP 모드 활성 중에는 전체화면 복원을 시도하지 않음 (전체화면일 때는 전체화면 완벽 보존)
        const wasFullscreen = !isAnyPip && Boolean(art.fullscreen || document.fullscreenElement);
        const wasFullscreenWeb = !isAnyPip && Boolean(art.fullscreenWeb);
        try {
          await Promise.race([
            art.switchUrl(newM3u8),
            new Promise((resolve) => setTimeout(resolve, 4000)),
          ]);
        } catch (switchErr) {
          console.warn("[art.switchUrl non-fatal error]:", switchErr);
        }

        try {
          await art.play();
        } catch {
          // 브라우저 자동재생 정책 대비
        }

        if (wasFullscreen && !art.fullscreen && !document.fullscreenElement) {
          try {
            art.fullscreen = true;
          } catch {}
        }
        if (wasFullscreenWeb && !art.fullscreenWeb) {
          try {
            art.fullscreenWeb = true;
          } catch {}
        }

        // Document PiP 활성 중이면 PIP 윈도우 스타일 동기화
        if (isDocPip && docPipWindowRef.current && !docPipWindowRef.current.closed) {
          try {
            const pipWin = docPipWindowRef.current;
            const pipDoc = pipWin.document;
            const DYNAMIC_STYLE_IDS = ["dynamic-sub-style", "player-custom-settings-style"];
            for (const id of DYNAMIC_STYLE_IDS) {
              const src = document.getElementById(id);
              if (!src) continue;
              let dst = pipDoc.getElementById(id);
              if (!dst) {
                dst = pipDoc.createElement("style");
                dst.id = id;
                pipDoc.head.appendChild(dst);
              }
              dst.textContent = src.textContent;
            }
          } catch {}
        }

        // 7. 이어보기 시점 확인
        const newSaveKey = `anime_progress_${animeId}_ep${targetEp}`;
        const savedSec = parseFloat(localStorage.getItem(newSaveKey) || "0");
        if (savedSec > 10) {
          art.currentTime = savedSec;
          art.notice.show = `이어보기: ${Math.floor(savedSec / 60)}분 ${Math.floor(savedSec % 60)}초부터 재생`;
        } else {
          art.notice.show = `▶ ${epTitle} 재생 시작`;
        }
      } catch (err) {
        console.error("[Seamless switch error]:", err);
        art.notice.show = `${targetEp}화 스트림을 불러오지 못했습니다. 다시 시도해 주세요.`;
      } finally {
        isSwitchingEpRef.current = false;
        setIsSwitchingEp(null);
      }
    },
    [animeId, animeTitle, isDub, currentEpisodes]
  );
  switchEpisodeRef.current = switchEpisode;

  const handleJump = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const targetNum = parseInt(jumpInput.trim(), 10);
    if (isNaN(targetNum) || targetNum <= 0) {
      setJumpError("회차 번호를 입력해주세요.");
      setTimeout(() => setJumpError(""), 3000);
      return;
    }

    const matched = currentEpisodes.find((ep) => ep.number === targetNum);
    if (!matched) {
      setJumpError(`${targetNum}화를 찾을 수 없습니다.`);
      setTimeout(() => setJumpError(""), 3000);
      return;
    }

    setJumpError("");
    switchEpisode(targetNum);
  };

  const displayedEpisodes =
    chunkCount > 1
      ? currentEpisodes.slice(selectedChunk * CHUNK_SIZE, (selectedChunk + 1) * CHUNK_SIZE)
      : currentEpisodes;

  const [subs, setSubs] = useState<SubtitleItem[]>([]);
  const [selectedSubIndex, setSelectedSubIndex] = useState<number>(0);
  const [isLoadingSubs, setIsLoadingSubs] = useState<boolean>(true);
  const [creators, setCreators] = useState<CreatorInfo[]>([]);
  const [loadingCreatorName, setLoadingCreatorName] = useState<string | null>(null);
  const [currentSyncOffset, setCurrentSyncOffset] = useState<number>(0.0);
  const [currentSubSize, setCurrentSubSize] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("anime_sub_size");
      if (saved) {
        const val = parseInt(saved, 10);
        if (val === 28) return 22;
        return val || 22;
      }
    }
    return 22;
  });
  const localFileInputRef = useRef<HTMLInputElement>(null);

  // Skip States & Preferences
  const [skipIntervals, setSkipIntervals] = useState<SkipInterval[]>([]);
  const [playerSettings, setPlayerSettings] = useState<PlayerSettings>(loadPlayerSettings);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [autoSkipEnabled, setAutoSkipEnabled] = useState<boolean>(() => loadPlayerSettings().autoSkip);
  const [autoNextEnabled, setAutoNextEnabled] = useState<boolean>(() => loadPlayerSettings().autoNext);
  const [audioAnalysisStatus, setAudioAnalysisStatus] = useState<
    "idle" | "running" | "success" | "none"
  >("idle");
  const [audioAnalysisText, setAudioAnalysisText] = useState<string>("오디오 AI 분석");
  const [skipSource, setSkipSource] = useState<string>("");
  const [floatingSkip, setFloatingSkip] = useState<{
    show: boolean;
    label: string;
    targetTime: number;
    isManual?: boolean;
  }>({ show: false, label: "", targetTime: 0 });

  // Episode history map for in-player episode pills
  const [epHistoryMap, setEpHistoryMap] = useState<
    Record<number, { watch_time: number; duration: number; is_completed: boolean }>
  >({});

  // Apply initial player settings styles and maintain ref
  const playerSettingsRef = useRef<PlayerSettings>(playerSettings);
  useEffect(() => {
    playerSettingsRef.current = playerSettings;
    applyPlayerSettingsStyles(playerSettings);

    // 더블탭 레이블 및 모바일 중앙 컨트롤 스킵 초수 실시간 동기화
    try {
      const doc = (artRef.current?.template?.$player as HTMLElement | undefined)?.ownerDocument || document;
      const dur = playerSettings.doubleTouchDuration || 10;
      const leftLabel = doc.getElementById("dt-label-left");
      const rightLabel = doc.getElementById("dt-label-right");
      const secBack = doc.getElementById("mobile-seek-sec-back");
      const secFwd = doc.getElementById("mobile-seek-sec-fwd");
      if (leftLabel) leftLabel.textContent = `-${dur}초`;
      if (rightLabel) rightLabel.textContent = `+${dur}초`;
      if (secBack) secBack.textContent = `${dur}`;
      if (secFwd) secFwd.textContent = `${dur}`;
    } catch {}

    if (artRef.current) {
      artRef.current.hotkey = playerSettings.hotkey;
      if (artRef.current.option) {
        artRef.current.option.gesture = playerSettings.mobileGesture;
      }
    }
  }, [playerSettings]);

  // 계정 DB에서 플레이어 환경설정 불러와 동기화
  useEffect(() => {
    let isCancelled = false;
    fetchUserSettingsFromDb().then((result) => {
      if (isCancelled) return;
      if (result.authenticated && result.settings) {
        const merged: PlayerSettings = {
          ...DEFAULT_PLAYER_SETTINGS,
          ...result.settings,
        };
        setPlayerSettings(merged);
        setAutoSkipEnabled(merged.autoSkip);
        setAutoNextEnabled(merged.autoNext);
        applyPlayerSettingsStyles(merged);
        if (artRef.current) {
          artRef.current.hotkey = merged.hotkey;
        }
        try {
          localStorage.setItem("anime_player_settings", JSON.stringify(merged));
          localStorage.setItem("anime_auto_skip", merged.autoSkip ? "1" : "0");
          localStorage.setItem("anime_auto_next", merged.autoNext ? "1" : "0");
        } catch {}
      } else if (result.authenticated && !result.settings) {
        // 계정은 있으나 DB에 설정이 없는 경우, 현재 설정(PIP ON 포함)을 DB에 저장
        saveUserSettingsToDb(loadPlayerSettings()).catch(() => {});
      }
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  // Fetch history map for episode pills
  useEffect(() => {
    let isCancelled = false;
    fetch(`/api/anime/history?anime_id=${animeId}`)
      .then((r) => r.json())
      .then((d) => {
        if (isCancelled || !d.success || !Array.isArray(d.items)) return;
        const map: Record<number, { watch_time: number; duration: number; is_completed: boolean }> = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        d.items.forEach((item: any) => {
          const num = Number(item.episode_number);
          if (num > 0) {
            map[num] = {
              watch_time: parseFloat(item.watch_time || item.current_time || "0"),
              duration: parseFloat(item.duration || "0"),
              is_completed: Boolean(item.is_completed),
            };
          }
        });

        // LocalStorage fallback merge
        for (let i = 1; i <= 2000; i++) {
          const localSec = localStorage.getItem(`anime_progress_${animeId}_ep${i}`);
          if (localSec && !map[i]) {
            const sec = parseFloat(localSec);
            if (sec > 5) {
              map[i] = { watch_time: sec, duration: 0, is_completed: false };
            }
          }
        }

        setEpHistoryMap(map);
      })
      .catch(() => {});

    return () => {
      isCancelled = true;
    };
  }, [animeId]);

  const handleUpdateSettings = (newSettings: PlayerSettings) => {
    setPlayerSettings(newSettings);
    setAutoSkipEnabled(newSettings.autoSkip);
    setAutoNextEnabled(newSettings.autoNext);
    if (artRef.current) {
      artRef.current.hotkey = newSettings.hotkey;
    }
  };

  const toggleAutoSkip = () => {
    const nextVal = !playerSettings.autoSkip;
    const nextSettings = { ...playerSettings, autoSkip: nextVal };
    setPlayerSettings(nextSettings);
    savePlayerSettings(nextSettings);
    setAutoSkipEnabled(nextVal);
    if (artRef.current) {
      artRef.current.notice.show = `OP/ED 자동 스킵: ${nextVal ? "활성화(ON)" : "비활성화(OFF)"}`;
    }
  };

  const toggleAutoNext = () => {
    const nextVal = !playerSettings.autoNext;
    const nextSettings = { ...playerSettings, autoNext: nextVal };
    setPlayerSettings(nextSettings);
    savePlayerSettings(nextSettings);
    setAutoNextEnabled(nextVal);
    if (artRef.current) {
      artRef.current.notice.show = `다음 화 자동재생: ${nextVal ? "활성화(ON)" : "비활성화(OFF)"}`;
    }
  };

  // Script Loader Helper
  const loadScript = (src: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  };

  // ==========================================
  // 🌟 하이브리드 PIP (Document PiP + 브라우저 네이티브 TextTrack 연동)
  // ==========================================

  // 절대 URL 변환 헬퍼 (iOS 네이티브 및 ArtPlayer 공용)
  const toAbsoluteUrl = useCallback((url: string) => {
    if (!url) return "";
    if (
      url.startsWith("http://") ||
      url.startsWith("https://") ||
      url.startsWith("blob:") ||
      url.startsWith("data:")
    ) {
      return url;
    }
    if (typeof window !== "undefined") {
      return window.location.origin + (url.startsWith("/") ? "" : "/") + url;
    }
    return url;
  }, []);

  // 1. ASS 자막 Dialogue 라인 파싱
  const parseAssDialogues = useCallback((assText: string) => {
    if (!assText) return [];
    const cues: Array<{ start: number; end: number; text: string }> = [];
    const pattern =
      /^Dialogue:\s*[^,]+,(\d+:\d{2}:\d{2}(?:\.\d+)?),(\d+:\d{2}:\d{2}(?:\.\d+)?),([^,]*),([^,]*),(?:[^,]*,){4}(.*)$/gim;

    const toSeconds = (tStr: string) => {
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
      const startSec = toSeconds(match[1]);
      const endSec = toSeconds(match[2]);
      const rawText = match[5];
      const cleanText = rawText
        .replace(/\{[^}]*\}/g, "")
        .replace(/\\N/gi, "\n")
        .replace(/\\n/gi, "\n")
        .trim();
      if (cleanText && endSec > startSec) {
        cues.push({ start: startSec, end: endSec, text: cleanText });
      }
    }
    return cues;
  }, []);

  // 2. WebVTT 텍스트 파싱 (라인 기반 신뢰성 100% 파서)
  const parseVttToCues = useCallback((vttText: string) => {
    if (!vttText) return [];
    const cues: Array<{ start: number; end: number; text: string }> = [];
    const lines = vttText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    let currentStart: number | null = null;
    let currentEnd: number | null = null;
    let currentTexts: string[] = [];

    const toSeconds = (tStr: string) => {
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

    const timeArrowPattern = /((?:\d{1,2}:)?\d{2}:\d{2}[\.,]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[\.,]\d{1,3})/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const timeMatch = timeArrowPattern.exec(line);
      if (timeMatch) {
        if (currentStart !== null && currentEnd !== null && currentTexts.length > 0) {
          const text = currentTexts.join("\n").trim();
          if (text && currentEnd > currentStart) {
            cues.push({ start: currentStart, end: currentEnd, text });
          }
        }
        currentStart = toSeconds(timeMatch[1]);
        currentEnd = toSeconds(timeMatch[2]);
        currentTexts = [];
      } else if (currentStart !== null && currentEnd !== null) {
        if (line === "") {
          if (currentTexts.length > 0) {
            const text = currentTexts.join("\n").trim();
            if (text && currentEnd > currentStart) {
              cues.push({ start: currentStart, end: currentEnd, text });
            }
            currentStart = null;
            currentEnd = null;
            currentTexts = [];
          }
        } else if (/^\d+$/.test(line) && currentTexts.length === 0) {
          continue;
        } else {
          const clean = line
            .replace(/\{[^}]*\}/g, "")
            .replace(/<(?!\/?(font|b|i|u|span)\b)[^>]*>/gi, "")
            .trim();
          if (clean) currentTexts.push(clean);
        }
      }
    }
    if (currentStart !== null && currentEnd !== null && currentTexts.length > 0) {
      const text = currentTexts.join("\n").trim();
      if (text && currentEnd > currentStart) {
        cues.push({ start: currentStart, end: currentEnd, text });
      }
    }
    return cues;
  }, []);

  // 3. WebVTT 포맷 문자열 빌더
  const buildVttFromCues = useCallback((cues: Array<{ start: number; end: number; text: string }>, offset = 0) => {
    let vtt = "WEBVTT\n\n";
    const formatVttTime = (sec: number) => {
      const s = Math.max(0, sec);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const rem = s % 60;
      let wholeSec = Math.floor(rem);
      let ms = Math.floor(Math.round((rem - wholeSec) * 1000));
      if (ms >= 1000) {
        wholeSec += 1;
        ms -= 1000;
      }
      const safeMs = Math.min(ms, 999);
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(wholeSec).padStart(2, "0")}.${String(safeMs).padStart(3, "0")}`;
    };

    cues.forEach((c, idx) => {
      const start = c.start + offset;
      const end = c.end + offset;
      if (end > start && start >= 0) {
        vtt += `${idx + 1}\n${formatVttTime(start)} --> ${formatVttTime(end)}\n${c.text}\n\n`;
      }
    });
    return vtt;
  }, []);

  // 4. 네이티브 PiP 활성 여부 확인
  const isNativePipActive = useCallback(() => {
    const art = artRef.current;
    return Boolean(
      (document.pictureInPictureElement && document.pictureInPictureElement === art?.video) ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (art?.video && (art.video as any).webkitPresentationMode === "picture-in-picture")
    );
  }, []);

  // 5. 자막 객체로부터 실제 서버 HTTP WebVTT URL 생성 (Safari AVPlayer 연동용)
  const getHttpVttUrlForSubtitle = useCallback(
    (subData: SubtitleItem | null, offset = 0) => {
      if (!subData || (!subData.url && !subData.content) || subData.name === "자막 끄기") {
        return "";
      }
      const offsetVal = parseFloat(String(offset)) || 0;
      const rawUrl = subData.url;

      if (rawUrl && !rawUrl.startsWith("blob:") && !rawUrl.startsWith("data:")) {
        if (rawUrl.startsWith("/api/anime/stream/vtt")) {
          const sep = rawUrl.includes("?") ? "&" : "?";
          return `${rawUrl}${sep}offset=${offsetVal}&_t=${Date.now()}`;
        }
        if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
          return `/api/anime/stream/vtt?url=${encodeURIComponent(rawUrl)}&offset=${offsetVal}&_t=${Date.now()}`;
        }
        const sep = rawUrl.includes("?") ? "&" : "?";
        return `${rawUrl}${sep}offset=${offsetVal}&_t=${Date.now()}`;
      }

      // ASS 또는 인메모리 자막인 경우: 실시간 WebVTT 변환 엔드포인트 HTTP URL 반환
      // currentEpRef.current를 사용하여 useCallback deps에서 currentEp를 제거
      // → syncCuesToPipTrack → applySubtitle → ArtPlayer init effect 연쇄 재생성 방지 (전체화면 유지)
      const ep = currentEpRef.current;
      if (animeTitle && ep) {
        return `/api/anime/subtitles/vtt?title=${encodeURIComponent(animeTitle)}&ep=${ep}&name=${encodeURIComponent(subData.name)}&offset=${offsetVal}&_t=${Date.now()}`;
      }

      return "";
    },
    [animeTitle]
  );

  // 6. 브라우저/비디오에 자동 등록된 네이티브 자막 트랙 전체 숨김
  const hideAllNativeVideoTracks = useCallback(() => {
    const art = artRef.current;
    if (!art || !art.video) return;
    const tracks = art.video.textTracks;
    if (!tracks) return;
    for (let i = 0; i < tracks.length; i++) {
      try {
        const t = tracks[i];
        // 🌟 Artplayer 자체 트랙(label === "Artplayer")은 절대 끄지 않음!
        if (t.label === "Artplayer") continue;
        if (t.mode === "showing") {
          t.mode = "hidden";
        }
      } catch {}
    }
  }, []);

  // 7. iOS Safari 및 표준 비디오 DOM <track> 엘리먼트 업데이트
  const updateNativeTrackElement = useCallback(
    (vttUrl: string, targetMode: TextTrackMode = "hidden") => {
      const art = artRef.current;
      if (!art || !art.video) return;

      let trackEl = art.video.querySelector("track.pip-subtitles-track") as HTMLTrackElement | null;

      if (!vttUrl) {
        if (trackEl) {
          try {
            if (trackEl.track) trackEl.track.mode = "hidden";
            trackEl.remove();
          } catch {}
        }
        pipTrackElementRef.current = null;
        if (currentBlobUrlRef.current) {
          try {
            URL.revokeObjectURL(currentBlobUrlRef.current);
          } catch {}
          currentBlobUrlRef.current = null;
        }
        return;
      }

      if (currentBlobUrlRef.current && currentBlobUrlRef.current !== vttUrl) {
        try {
          URL.revokeObjectURL(currentBlobUrlRef.current);
        } catch {}
        currentBlobUrlRef.current = null;
      }

      if (vttUrl.startsWith("blob:")) {
        currentBlobUrlRef.current = vttUrl;
      }

      const absUrl = toAbsoluteUrl(vttUrl);

      // 2) 트랙 엘리먼트가 없으면 생성, 이미 있으면 재사용
      if (!trackEl) {
        trackEl = document.createElement("track");
        trackEl.className = "pip-subtitles-track";
        trackEl.kind = "subtitles";
        trackEl.label = "한국어";
        trackEl.srclang = "ko";
        trackEl.setAttribute("default", "");
        trackEl.default = true;
        trackEl.src = absUrl;

        trackEl.addEventListener("load", function () {
          try {
            if (trackEl && trackEl.track) {
              trackEl.track.mode = targetMode;
            }
          } catch {}
        });

        trackEl.addEventListener("error", function (e) {
          console.warn("⚠️ [NativeTrack] WebVTT 로드 에러:", e, vttUrl);
        });

        art.video.appendChild(trackEl);
        pipTrackElementRef.current = trackEl;
      } else {
        if (trackEl.src !== absUrl) {
          trackEl.src = absUrl;
        }
        try {
          if (trackEl.track) {
            trackEl.track.mode = targetMode;
          }
        } catch {}
      }

      try {
        if (trackEl.track) {
          trackEl.track.mode = targetMode;
        }
      } catch {}
    },
    [toAbsoluteUrl]
  );

  // 8. 네이티브 Video PiP용 TextTrack 획득/생성 (비-애플 기기 인메모리 백업)
  const getOrCreatePipTextTrack = useCallback(() => {
    const art = artRef.current;
    if (!art || !art.video) return null;
    if (!nativePipTextTrackRef.current) {
      for (let i = 0; i < art.video.textTracks.length; i++) {
        const t = art.video.textTracks[i];
        if (t.label === "pip-subtitles") {
          nativePipTextTrackRef.current = t;
          break;
        }
      }
      if (!nativePipTextTrackRef.current) {
        try {
          nativePipTextTrackRef.current = art.video.addTextTrack("subtitles", "pip-subtitles", "ko");
        } catch (e) {
          console.warn("addTextTrack failed:", e);
        }
      }
    }
    return nativePipTextTrackRef.current;
  }, []);

  // 9. 네이티브 TextTrack 및 DOM <track>에 현재 자막 동기화
  const syncCuesToPipTrack = useCallback(
    async (force = false) => {
      const sub = currentSubRef.current;
      if (!sub || sub.name === "자막 끄기" || (!sub.url && !sub.content)) {
        if (nativePipTextTrackRef.current) nativePipTextTrackRef.current.mode = "hidden";
        updateNativeTrackElement("");
        hideAllNativeVideoTracks();
        return;
      }

      const isPipActive = force || isNativePipActive();
      if (!isPipActive) {
        // 🌟 평상시(일반 재생 중): DOM 내 <track> 완전 제거 및 모든 네이티브 트랙 숨김 유지
        // iOS Safari가 자체 시스템 검은 박스 캡션을 띄우는 중복 문제를 원천 차단
        updateNativeTrackElement("");
        hideAllNativeVideoTracks();
        if (nativePipTextTrackRef.current) nativePipTextTrackRef.current.mode = "hidden";
        return;
      }

      const offset = currentSyncOffsetRef.current || 0;
      const isAppleDevice =
        typeof navigator !== "undefined" &&
        (/iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

      const httpVttUrl = getHttpVttUrlForSubtitle(sub, offset);

      // 자막 큐 파싱 (ASS 또는 VTT)
      let parsedCues: Array<{ start: number; end: number; text: string }> = [];
      if (sub.is_ass) {
        let assText = currentAssContentRef.current || sub.content;
        if (!assText && sub.url) {
          try {
            const res = await fetch(toAbsoluteUrl(sub.url));
            if (res.ok) {
              assText = await res.text();
              currentAssContentRef.current = assText;
            }
          } catch (e) {
            console.warn("ASS fetch failed for PIP:", e);
          }
        }
        if (assText) {
          parsedCues = parseAssDialogues(assText);
        }
      } else {
        const art = artRef.current;
        if (art && art.subtitle && art.subtitle.cues && art.subtitle.cues.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parsedCues = art.subtitle.cues.map((c: any) => ({
            start: c.startTime,
            end: c.endTime,
            text: c.text,
          }));
        } else if (sub.content) {
          parsedCues = parseVttToCues(sub.content);
        } else if (sub.url) {
          try {
            const res = await fetch(toAbsoluteUrl(sub.url));
            if (res.ok) {
              const vttText = await res.text();
              parsedCues = parseVttToCues(vttText);
            }
          } catch (e) {
            console.warn("VTT fetch failed for PIP:", e);
          }
        }
      }

      if (isAppleDevice) {
        // 🌟 1) iOS/macOS Safari: AVPlayer 시스템 파이프라인 연동용 HTTP WebVTT 또는 Blob <track> 바인딩
        if (nativePipTextTrackRef.current) {
          nativePipTextTrackRef.current.mode = "hidden";
        }

        let targetTrackUrl = httpVttUrl;
        if (!targetTrackUrl && parsedCues.length > 0) {
          const vttText = buildVttFromCues(parsedCues, offset);
          const blob = new Blob([vttText], { type: "text/vtt;charset=utf-8" });
          targetTrackUrl = URL.createObjectURL(blob);
        }

        if (targetTrackUrl) {
          updateNativeTrackElement(targetTrackUrl, "showing");
        } else {
          updateNativeTrackElement("");
        }
      } else {
        // 🌟 2) 비-애플 기기 (Windows/Android/Linux 등):
        updateNativeTrackElement("");

        const track = getOrCreatePipTextTrack();
        if (track) {
          if (track.cues) {
            const existingCues = Array.from(track.cues);
            existingCues.forEach((c) => {
              try {
                track.removeCue(c);
              } catch {}
            });
          }

          if (parsedCues.length > 0 && typeof window.VTTCue !== "undefined") {
            parsedCues.forEach((c) => {
              const start = Math.max(0, c.start + offset);
              const end = Math.max(start + 0.1, c.end + offset);
              try {
                const cue = new VTTCue(start, end, c.text);
                cue.line = -2;
                cue.align = "center";
                track.addCue(cue);
              } catch {}
            });
            track.mode = "showing";
          } else {
            track.mode = "showing";
          }
        }
      }
    },
    [
      isNativePipActive,
      updateNativeTrackElement,
      hideAllNativeVideoTracks,
      getHttpVttUrlForSubtitle,
      toAbsoluteUrl,
      parseAssDialogues,
      parseVttToCues,
      buildVttFromCues,
      getOrCreatePipTextTrack,
    ]
  );

  // 10. Document PiP 활성 여부
  const isDocumentPipActive = useCallback(() => {
    return Boolean(docPipWindowRef.current && !docPipWindowRef.current.closed);
  }, []);

  // 11. Document PiP 복원
  const restoreFromDocumentPip = useCallback(() => {
    if (!docPipWindowRef.current) return;
    const art = artRef.current;
    const playerEl = art?.template?.$player as HTMLElement | undefined;
    const placeholder = docPipPlaceholderRef.current;
    if (playerEl && placeholder && placeholder.parentNode) {
      placeholder.parentNode.replaceChild(playerEl, placeholder);
    }
    docPipPlaceholderRef.current = null;
    docPipWindowRef.current = null;

    setTimeout(() => {
      if (artRef.current) {
        try {
          artRef.current.resize();
        } catch {}
      }
      const canvas = playerEl?.querySelector("canvas.libassjs-canvas") as HTMLElement | null;
      if (canvas) canvas.style.display = "block";
      const parent = playerEl?.querySelector(".libassjs-canvas-parent") as HTMLElement | null;
      if (parent) parent.style.display = "block";
      if (octopusRef.current && typeof octopusRef.current.resize === "function") {
        try {
          octopusRef.current.resize();
        } catch {}
      }
    }, 50);
  }, []);

  // 12. Document PiP 수동 종료
  const exitDocumentPip = useCallback(() => {
    if (docPipWindowRef.current && !docPipWindowRef.current.closed) {
      docPipWindowRef.current.close();
    }
    restoreFromDocumentPip();
  }, [restoreFromDocumentPip]);

  // 12.5. Document PiP 문서로 사용자 설정 CSS 동기화
  // PIP 윈도우는 별도의 문서이므로 진입 시 1회 클론된 스타일이 그대로 고정된다.
  // 자막 크기/플레이어 설정 변경 시 메인 문서의 현재 CSS 상태를 PIP 문서로 전달해 일관성을 유지한다.
  const syncPipStyles = useCallback(() => {
    const pipWin = docPipWindowRef.current;
    if (!pipWin || pipWin.closed) return;
    try {
      const pipDoc = pipWin.document;
      // 1) 루트 CSS 변수 (자막 크기)
      const rootStyle = getComputedStyle(document.documentElement);
      const userSubSize = rootStyle.getPropertyValue("--user-sub-size");
      const userSubScale = rootStyle.getPropertyValue("--user-sub-scale");
      if (userSubSize) pipDoc.documentElement.style.setProperty("--user-sub-size", userSubSize);
      if (userSubScale) pipDoc.documentElement.style.setProperty("--user-sub-scale", userSubScale);
      // 2) 동적 스타일 엘리먼트 (자막 크기 규칙, 플레이어 버튼 표시/숨김 설정)
      const DYNAMIC_STYLE_IDS = ["dynamic-sub-style", "player-custom-settings-style"];
      for (const id of DYNAMIC_STYLE_IDS) {
        const src = document.getElementById(id);
        if (!src) continue;
        let dst = pipDoc.getElementById(id);
        if (!dst) {
          dst = pipDoc.createElement("style");
          dst.id = id;
          pipDoc.head.appendChild(dst);
        }
        dst.textContent = src.textContent;
      }
    } catch {}
  }, []);

  // 플레이어 설정 스타일 변경 알림 수신 (PlayerSettingsModal의 applyPlayerSettingsStyles가 발신)
  useEffect(() => {
    const onStylesUpdated = () => syncPipStyles();
    window.addEventListener("anime-player-styles-updated", onStylesUpdated);
    return () => window.removeEventListener("anime-player-styles-updated", onStylesUpdated);
  }, [syncPipStyles]);

  // 13. Document PiP 진입
  const enterDocumentPip = useCallback(async () => {
    if (isDocumentPipActive()) return;
    const art = artRef.current;
    const playerEl = art?.template?.$player as HTMLElement | undefined;
    if (!playerEl) return;

    const rect = playerEl.getBoundingClientRect();
    const width = Math.min(Math.max(Math.round(rect.width || 854), 480), 1280);
    const height = Math.round(width * (9 / 16));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docPip = (window as any).documentPictureInPicture;
    if (!docPip) return;

    const pipWindow = await docPip.requestWindow({
      width: width,
      height: height,
    });

    docPipWindowRef.current = pipWindow;

    // 메인 문서 스타일 복사
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((el) => {
      try {
        pipWindow.document.head.appendChild(el.cloneNode(true));
      } catch {}
    });

    // 사용자 자막 크기 변수 동기화
    try {
      const rootStyle = getComputedStyle(document.documentElement);
      const userSubSize = rootStyle.getPropertyValue("--user-sub-size");
      const userSubScale = rootStyle.getPropertyValue("--user-sub-scale");
      if (userSubSize) pipWindow.document.documentElement.style.setProperty("--user-sub-size", userSubSize);
      if (userSubScale) pipWindow.document.documentElement.style.setProperty("--user-sub-scale", userSubScale);
    } catch {}

    const pipResetStyle = pipWindow.document.createElement("style");
    pipResetStyle.textContent = `
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        background-color: #000 !important;
        overflow: hidden !important;
      }
      .art-video-player {
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        border-radius: 0 !important;
      }
    `;
    pipWindow.document.head.appendChild(pipResetStyle);

    const placeholder = document.createElement("div");
    placeholder.id = "artplayer-pip-placeholder";
    placeholder.style.cssText =
      "width:100%;height:100%;min-height:320px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#090d16;color:#c084fc;font-size:15px;font-weight:700;gap:14px;border:1px dashed rgba(168,85,247,0.4);border-radius:0;";
    placeholder.innerHTML = `
      <div style="width:48px;height:48px;border-radius:50%;background:rgba(168,85,247,0.15);display:flex;align-items:center;justify-content:center;">
        <svg viewBox="0 0 1024 1024" width="26" height="26" fill="#c084fc"><path d="M844.8 219.648h-665.6c-6.144 0-10.24 4.608-10.24 10.752v563.2c0 5.632 4.096 10.24 10.24 10.24h256v92.16h-256a102.4 102.4 0 0 1-102.4-102.4v-563.2c0-56.832 45.568-102.4 102.4-102.4h665.6a102.4 102.4 0 0 1 102.4 102.4v204.8h-92.16v-204.8c0-6.144-4.608-10.752-10.24-10.752zM614.4 588.8c-28.672 0-51.2 22.528-51.2 51.2v204.8c0 28.16 22.528 51.2 51.2 51.2h281.6c28.16 0 51.2-23.04 51.2-51.2v-204.8c0-28.672-23.04-51.2-51.2-51.2H614.4z"></path></svg>
      </div>
      <span>화면 속 화면 (PIP) 모드로 재생 중입니다</span>
      <button type="button" class="btn-pip-restore" style="padding:5px 14px;border-radius:20px;font-size:12px;font-weight:600;color:#fff;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.3);cursor:pointer;">PIP 닫기</button>
    `;
    const restoreBtn = placeholder.querySelector(".btn-pip-restore");
    if (restoreBtn) {
      restoreBtn.addEventListener("click", () => exitDocumentPip());
    }

    docPipPlaceholderRef.current = placeholder;
    if (playerEl.parentNode) {
      playerEl.parentNode.insertBefore(placeholder, playerEl);
    }
    pipWindow.document.body.appendChild(playerEl);

    const ensureAssCanvasLayout = () => {
      const art = artRef.current;
      const player = art?.template?.$player as HTMLElement | undefined;
      const canvas = player
        ? (player.querySelector("canvas.libassjs-canvas") as HTMLElement | null)
        : (document.querySelector("canvas.libassjs-canvas") as HTMLElement | null);
      if (canvas) canvas.style.display = "block";
      const parent = player
        ? (player.querySelector(".libassjs-canvas-parent") as HTMLElement | null)
        : (document.querySelector(".libassjs-canvas-parent") as HTMLElement | null);
      if (parent) parent.style.display = "block";

      if (octopusRef.current && typeof octopusRef.current.resize === "function") {
        try {
          octopusRef.current.resize();
        } catch {}
      }
    };

    const onResize = () => {
      if (artRef.current) {
        try {
          artRef.current.resize();
        } catch {}
      }
      ensureAssCanvasLayout();
    };

    pipWindow.addEventListener("resize", onResize);
    setTimeout(onResize, 50);
    setTimeout(ensureAssCanvasLayout, 150);

    pipWindow.addEventListener("pagehide", () => {
      restoreFromDocumentPip();
    });

    if (art && art.notice) art.notice.show = "✨ PIP 모드 활성화됨";
  }, [isDocumentPipActive, exitDocumentPip, restoreFromDocumentPip]);

  // 14. 하이브리드 PIP 토글러 (jcore와 100% 동일한 1순위 Document PiP + 2순위 Video PiP 구조)
  const toggleHybridPip = useCallback(async () => {
    const art = artRef.current;
    if (!art || !art.video) return;

    // 1. 이미 Document PiP 활성 상태인 경우 -> 닫기
    if (isDocumentPipActive()) {
      exitDocumentPip();
      return;
    }

    // 2. 이미 네이티브 Video PiP 활성 상태인 경우 -> 종료
    if (
      document.pictureInPictureElement ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (art.video && (art.video as any).webkitPresentationMode === "picture-in-picture")
    ) {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } else if ((art.video as any).webkitSetPresentationMode && typeof (art.video as any).webkitSetPresentationMode === "function") {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (art.video as any).webkitSetPresentationMode("inline");
        }
      } catch (err) {
        console.warn("exitPictureInPicture failed:", err);
      }
      return;
    }

    // 🌟 1순위: Document Picture-in-Picture 지원 시 (Chrome 116+, Edge 최신) -> 자막/캔버스/스킵버튼 통째로 PIP 진입
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ("documentPictureInPicture" in window && typeof (window as any).documentPictureInPicture?.requestWindow === "function") {
      try {
        await enterDocumentPip();
        return;
      } catch (docPipErr) {
        console.warn("Document PiP failed, fallback to Video PiP:", docPipErr);
      }
    }

    // 🌟 2순위: 표준 Video Picture-in-Picture Fallback (iOS Safari, Mac Safari 등) -> 네이티브 TextTrack으로 자막 출력
    if (art.video.readyState === 0) {
      if (art.notice) art.notice.show = "영상이 로딩 중입니다. 잠시 후 다시 시도해주세요.";
      return;
    }

    if (art.video.disablePictureInPicture) {
      art.video.disablePictureInPicture = false;
    }

    try {
      // PiP 진입 직전 실시간 자막 트랙 바인딩
      syncCuesToPipTrack(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((art.video as any).webkitSetPresentationMode && typeof (art.video as any).webkitSetPresentationMode === "function") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (art.video as any).webkitSetPresentationMode("picture-in-picture");
        return;
      } else if (art.video.requestPictureInPicture) {
        await art.video.requestPictureInPicture();
        return;
      }
    } catch (videoPipErr: any) {
      console.error("Video PiP failed:", videoPipErr);
      updateNativeTrackElement("");
      hideAllNativeVideoTracks();
      if (art.notice) art.notice.show = "PIP 모드를 실행할 수 없습니다.";
    }
  }, [isDocumentPipActive, exitDocumentPip, enterDocumentPip, syncCuesToPipTrack, updateNativeTrackElement, hideAllNativeVideoTracks]);

  // 15. Subtitle switcher
  const applySubtitle = useCallback(
    (sub: SubtitleItem, offset = 0.0) => {
      currentSubRef.current = sub;
      pendingSubtitleRef.current = sub;
      if (!artRef.current) return;
      const art = artRef.current;

      // 1. Clean up existing ASS SubtitlesOctopus instance and canvas elements
      if (octopusRef.current) {
        try {
          octopusRef.current.dispose();
        } catch {}
        octopusRef.current = null;
      }
      if (containerRef.current) {
        containerRef.current
          .querySelectorAll(".libassjs-canvas-parent, canvas.libassjs-canvas")
          .forEach((el) => el.remove());
      }
      if (art.template?.$player) {
        art.template.$player
          .querySelectorAll(".libassjs-canvas-parent, canvas.libassjs-canvas")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .forEach((el: any) => el.remove());
      }

      if (sub.is_ass) {
        art.subtitle.show = false;
        // VTT 자막 영역의 인라인 display가 남아 ASS와 중복 표시되는 문제 방지
        if (art.template?.$subtitle) {
          art.template.$subtitle.style.display = "none";
        }
        let subBlobUrl = sub.url || "";
        if (!subBlobUrl && sub.content) {
          const blob = new Blob([sub.content], { type: "text/plain;charset=utf-8" });
          subBlobUrl = URL.createObjectURL(blob);
        }

        if (!sub.content && sub.url) {
          fetch(toAbsoluteUrl(sub.url))
            .then((r) => r.text())
            .then((txt) => {
              currentAssContentRef.current = txt;
              syncCuesToPipTrack(isNativePipActive());
            })
            .catch(() => {});
        } else {
          currentAssContentRef.current = sub.content || null;
          syncCuesToPipTrack(isNativePipActive());
        }

        if (window.SubtitlesOctopus) {
          try {
            octopusRef.current = new window.SubtitlesOctopus({
              video: art.video,
              subUrl: subBlobUrl,
              subContent: sub.content || undefined,
              fonts: ["/libass/default.woff2"],
              fallbackFont: "/libass/default.woff2",
              workerUrl: "/libass/subtitles-octopus-worker.js",
              legacyWorkerUrl: "/libass/subtitles-octopus-worker.js",
              timeOffset: offset,
              onReady: () => {
                art.notice.show = `${sub.name} (ASS 특수효과) 자막 로드 완료`;
                const playerEl = (art.template?.$player as HTMLElement | undefined) || containerRef.current;
                if (playerEl) {
                  const canvas = playerEl.querySelector("canvas.libassjs-canvas") as HTMLElement | null;
                  if (canvas) canvas.style.display = "block";
                  const parent = playerEl.querySelector(".libassjs-canvas-parent") as HTMLElement | null;
                  if (parent) parent.style.display = "block";
                }
                if (octopusRef.current && typeof octopusRef.current.resize === "function") {
                  try {
                    octopusRef.current.resize();
                  } catch {}
                }
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onError: (err: any) => {
                console.error("[SubtitlesOctopus error]:", err);
                art.notice.show = `${sub.name} ASS 자막 초기화 에러`;
              },
            });
          } catch (e) {
            console.error("[SubtitlesOctopus init error]:", e);
          }
        }
      } else {
        art.subtitle.show = true;
        if (art.template?.$player) {
          art.template.$player.classList.add("art-subtitle-show");
        }
        if (art.template?.$subtitle) {
          art.template.$subtitle.style.display = "flex";
        }

        let vttUrl = sub.url || "";
        if (!vttUrl && sub.content) {
          const blob = new Blob([sub.content], { type: "text/vtt;charset=utf-8" });
          vttUrl = URL.createObjectURL(blob);
        }
        if (vttUrl) {
          const absVttUrl = toAbsoluteUrl(vttUrl);
          art.subtitle
            .switch(absVttUrl, { name: sub.name, type: "vtt", escape: false })
            .then(() => {
              art.subtitle.show = true;
              if (art.template?.$player) {
                art.template.$player.classList.add("art-subtitle-show");
              }
              if (art.template?.$subtitle) {
                art.template.$subtitle.style.display = "flex";
              }
              syncCuesToPipTrack(isNativePipActive());
            })
            .catch((err: any) => {
              console.warn("Subtitle switch error:", err);
              art.subtitle.show = true;
              if (art.template?.$player) {
                art.template.$player.classList.add("art-subtitle-show");
              }
              if (art.template?.$subtitle) {
                art.template.$subtitle.style.display = "flex";
              }
            });
          art.subtitle.offset = offset;
          art.notice.show = `${sub.name} 자막 로드 완료`;
        }
      }
    },
    [syncCuesToPipTrack, isNativePipActive, toAbsoluteUrl]
  );

  useEffect(() => {
    applySubtitleRef.current = applySubtitle;
  }, [applySubtitle]);

  // Subtitle font size controller
  const setSubtitleFontSize = useCallback((size: number) => {
    const numSize = parseInt(String(size), 10) || 22;
    const scale = (numSize / 22).toFixed(3);
    setCurrentSubSize(numSize);
    try {
      localStorage.setItem("anime_sub_size", String(numSize));
    } catch {}

    document.documentElement.style.setProperty("--user-sub-size", `${numSize}px`);
    document.documentElement.style.setProperty("--user-sub-scale", scale);

    let styleEl = document.getElementById("dynamic-sub-style");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "dynamic-sub-style";
      document.head.appendChild(styleEl);
    }
    styleEl.innerHTML = `
      :root {
        --user-sub-size: ${numSize}px !important;
        --user-sub-scale: ${scale} !important;
      }
      .art-video-player .art-subtitle,
      .art-video-player .art-subtitle .art-subtitle-line,
      .art-video-player .art-subtitle p,
      .art-video-player .art-subtitle div,
      .art-video-player .art-subtitle span {
        font-size: ${numSize}px !important;
        --art-subtitle-font-size: ${numSize}px !important;
      }
    `;

    if (artRef.current && artRef.current.subtitle) {
      try {
        artRef.current.subtitle.style("fontSize", `${numSize}px`);
      } catch {}
    }
    if (artRef.current) {
      artRef.current.notice.show = `자막 크기: ${numSize}px`;
    }
    // Document PiP 활성 시 PIP 문서에도 즉시 반영
    syncPipStyles();
  }, [syncPipStyles]);

  // Subtitle sync offset controller
  const setSubtitleSyncOffset = useCallback(
    (val: number) => {
      const offset = parseFloat(String(val));
      currentSyncOffsetRef.current = offset;
      setCurrentSyncOffset(offset);
      if (octopusRef.current && typeof octopusRef.current.setTimeOffset === "function") {
        try {
          octopusRef.current.setTimeOffset(offset);
        } catch {}
      }
      if (artRef.current && artRef.current.subtitle) {
        artRef.current.subtitle.offset = offset;
      }
      if (artRef.current) {
        artRef.current.notice.show = `자막 싱크: ${offset > 0 ? "+" : ""}${offset.toFixed(1)} 초`;
      }
      syncCuesToPipTrack(isNativePipActive());
    },
    [syncCuesToPipTrack, isNativePipActive]
  );

  // Refresh ArtPlayer's setting menu for Subtitle Selector
  const refreshSubtitleSettings = useCallback(
    (currentSubs: SubtitleItem[], activeIdx: number) => {
      if (!artRef.current || !artRef.current.setting) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const subSelectorOptions: any[] = [];
      const seenKeys = new Set<string>();

      currentSubs.forEach((sub, idx) => {
        if (!sub || (!sub.url && !sub.content)) return;
        const key = sub.url || sub.name;
        if (seenKeys.has(key)) return;
        seenKeys.add(key);

        const isSelected = idx === activeIdx;
        const icon = sub.is_ass ? "🟣 " : "⚪ ";
        subSelectorOptions.push({
          html: `${icon}${sub.name}`,
          subData: sub,
          default: isSelected,
        });
      });

      if (defaultVttUrl && !seenKeys.has(defaultVttUrl)) {
        const isDefaultSelected =
          activeIdx >= 0 && currentSubs[activeIdx]?.url === defaultVttUrl;
        subSelectorOptions.push({
          html: "⚪ 기본 내장",
          subData: { name: "기본 내장", format: "VTT", is_ass: false, url: defaultVttUrl },
          default: isDefaultSelected,
        });
      }

      subSelectorOptions.push({
        html: "🚫 자막 끄기",
        subData: { name: "자막 끄기", format: "VTT", is_ass: false, url: "" },
        default: activeIdx === -1,
      });

      const activeSub = activeIdx >= 0 ? currentSubs[activeIdx] : null;
      const tooltipText = activeSub ? activeSub.name : "자막 없음";

      try {
        artRef.current.setting.update({
          name: "subtitleSelector",
          width: 240,
          html: "자막 선택",
          tooltip: tooltipText,
          selector: subSelectorOptions,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onSelect: function (item: any) {
            if (item.subData.name === "자막 끄기" || (!item.subData.url && !item.subData.content)) {
              setSelectedSubIndex(-1);
              currentSubRef.current = null;
              currentAssContentRef.current = null;
              updateNativeTrackElement("");
              hideAllNativeVideoTracks();
              if (nativePipTextTrackRef.current) {
                nativePipTextTrackRef.current.mode = "hidden";
              }
              if (octopusRef.current) {
                try {
                  octopusRef.current.dispose();
                } catch {}
                octopusRef.current = null;
              }
              if (containerRef.current) {
                containerRef.current
                  .querySelectorAll(".libassjs-canvas-parent, canvas.libassjs-canvas")
                  .forEach((el) => el.remove());
              }
              if (artRef.current) {
                artRef.current.subtitle.show = false;
                // VTT 자막 영역의 인라인 display가 남아 자막이 꺼지지 않는 문제 방지
                if (artRef.current.template?.$subtitle) {
                  artRef.current.template.$subtitle.style.display = "none";
                }
                artRef.current.notice.show = "자막 꺼짐";
              }
            } else {
              const foundIndex = currentSubs.findIndex((s) => s.name === item.subData.name);
              setSelectedSubIndex(foundIndex !== -1 ? foundIndex : 0);
              applySubtitle(item.subData, currentSyncOffset);
            }
            return item.html;
          },
        });
      } catch (e) {
        console.warn("Failed to update subtitleSelector setting:", e);
      }
    },
    [defaultVttUrl, applySubtitle, updateNativeTrackElement, hideAllNativeVideoTracks]
  );

  useEffect(() => {
    refreshSubtitleSettingsRef.current = refreshSubtitleSettings;
  }, [refreshSubtitleSettings]);

  // Local subtitle file opener (.ass, .ssa, .smi, .srt, .vtt)
  const handleLocalSubFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      let rawText = "";
      try {
        rawText = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      } catch {
        rawText = new TextDecoder("euc-kr").decode(buffer);
      }

      const filename = file.name;
      const lowerName = filename.toLowerCase();
      const isAss = lowerName.endsWith(".ass") || lowerName.endsWith(".ssa");

      let convertedContent = rawText;
      const format: "ASS" | "VTT" = isAss ? "ASS" : "VTT";

      if (isAss) {
        convertedContent = rawText;
      } else if (lowerName.endsWith(".smi") || rawText.toLowerCase().includes("<sync")) {
        const matches: Array<{ startMs: number; text: string }> = [];
        const syncRegex = /<SYNC\s+Start=(\d+)>(?:<P[^>]*>)?([\s\S]*?)(?=<SYNC|\Z)/gi;
        let m: RegExpExecArray | null;

        while ((m = syncRegex.exec(rawText)) !== null) {
          const startMs = parseInt(m[1], 10);
          let clean = m[2].replace(/<br\s*\/?>/gi, "\n");
          clean = clean.replace(/<(?!(\/)?(?:font|i|b|u)\b)[^>]+>/gi, "").trim();
          clean = clean.replace(/&nbsp;/gi, " ").trim();
          if (clean && clean.toLowerCase() !== "&nbsp;") {
            matches.push({ startMs, text: clean });
          }
        }

        if (matches.length > 0) {
          const msToVtt = (ms: number): string => {
            const totalSec = Math.floor(ms / 1000);
            const remMs = ms % 1000;
            const s = totalSec % 60;
            const totalMin = Math.floor(totalSec / 60);
            const min = totalMin % 60;
            const h = Math.floor(totalMin / 60);
            return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(remMs).padStart(3, "0")}`;
          };

          const lines = ["WEBVTT", ""];
          for (let i = 0; i < matches.length; i++) {
            const item = matches[i];
            const endMs = i + 1 < matches.length ? matches[i + 1].startMs : item.startMs + 3000;
            lines.push(`${msToVtt(item.startMs)} --> ${msToVtt(endMs)}`);
            lines.push(item.text);
            lines.push("");
          }
          convertedContent = lines.join("\n");
        }
      } else if (lowerName.endsWith(".srt") || rawText.includes("-->")) {
        convertedContent = "WEBVTT\n\n" + rawText.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
      }

      const localSub: SubtitleItem = {
        name: `로컬: ${filename}`,
        format,
        is_ass: isAss,
        content: convertedContent,
      };

      setSubs((prev) => {
        const nextSubs = [localSub, ...prev.filter((s) => s.name !== localSub.name)];
        setSelectedSubIndex(0);
        applySubtitle(localSub, currentSyncOffset);
        setTimeout(() => refreshSubtitleSettings(nextSubs, 0), 100);
        return nextSubs;
      });

      if (artRef.current) {
        artRef.current.notice.show = `📂 로컬 자막 로드 완료: ${filename}`;
      }
    } catch (err) {
      console.error("[Local subtitle load error]:", err);
      if (artRef.current) {
        artRef.current.notice.show = "로컬 자막을 읽는 데 실패했습니다.";
      }
    } finally {
      if (e.target) e.target.value = "";
    }
  };

  // On-demand creator subtitle loader
  const handleLoadCreatorSub = async (creator: CreatorInfo) => {
    if (!creator.website || loadingCreatorName) return;

    const isErusha = creator.name.includes("에루샤") || (creator.website && creator.website.includes("erulabo.com"));
    if (isErusha) {
      if (artRef.current) {
        artRef.current.notice.show = "에루샤 님의 배포처는 Cloudflare 보안 캡차가 적용되어 있어 블로그에서 직접 다운로드해야 합니다.";
      }
      window.open(creator.website, "_blank");
      return;
    }

    setLoadingCreatorName(creator.name);
    if (artRef.current) {
      artRef.current.notice.show = `${creator.name} 자막 다운로드 중...`;
    }

    try {
      const res = await fetch("/api/anime/subtitles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorName: creator.name,
          website: creator.website,
          title: animeTitle,
          episodeNumber: currentEpRef.current,
        }),
      });
      const data = await res.json();
      if (data.success && data.subtitle) {
        const newSub: SubtitleItem = {
          name: `${data.subtitle.name} (${data.subtitle.format})`,
          format: data.subtitle.format,
          is_ass: data.subtitle.is_ass,
          content: data.subtitle.content,
        };

        const isAss = !!data.subtitle.is_ass;
        const currentSub = selectedSubIndex >= 0 ? subs[selectedSubIndex] : null;
        const isSameSub = currentSub && (
          currentSub.name.includes(creator.name) ||
          (creator.name.includes("카이란") && currentSub.name.includes("카이란")) ||
          currentSub.name === newSub.name
        );

        if (isAss) {
          // 🌟 ASS 자막인 경우: 즉시 화면 자막을 이 ASS 자막으로 교체 적용!
          setSubs((prev) => {
            const nextSubs = [newSub, ...prev.filter((s) => s.name !== newSub.name)];
            setSelectedSubIndex(0);
            applySubtitle(newSub, currentSyncOffset);
            setTimeout(() => refreshSubtitleSettings(nextSubs, 0), 100);
            return nextSubs;
          });

          if (artRef.current) {
            artRef.current.notice.show = `✅ ${creator.name} ASS 자막 등록 및 적용 완료!`;
          }
        } else {
          // 🌟 ASS가 아닌 일반 자막인 경우:
          if (isSameSub) {
            // 현재 자막과 동일한 경우: 교체하지 않고 목록에 보장 및 알림
            setSubs((prev) => {
              const existingIdx = prev.findIndex((s) => s.name === newSub.name);
              const nextSubs = existingIdx === -1 ? [...prev, newSub] : prev;
              setTimeout(() => refreshSubtitleSettings(nextSubs, selectedSubIndex), 100);
              return nextSubs;
            });
            if (artRef.current) {
              artRef.current.notice.show = "현재 적용 중인 자막과 동일한 자막입니다.";
            }
          } else {
            // 다른 일반 자막인 경우: 목록에 추가하되 현재 자막 유지 (자막 적용 버튼으로 선택 가능)
            setSubs((prev) => {
              const nextSubs = [newSub, ...prev.filter((s) => s.name !== newSub.name)];
              const currentName = currentSub ? currentSub.name : "";
              const newCurrentIdx = nextSubs.findIndex((s) => s.name === currentName);
              const keepIdx = newCurrentIdx !== -1 ? newCurrentIdx : Math.max(0, selectedSubIndex);
              setSelectedSubIndex(keepIdx);
              setTimeout(() => refreshSubtitleSettings(nextSubs, keepIdx), 100);
              return nextSubs;
            });
            if (artRef.current) {
              artRef.current.notice.show = `새 자막 등록: ${creator.name}`;
            }
          }
        }
      } else {
        if (artRef.current) {
          artRef.current.notice.show = data.message || "자막을 추출하지 못했습니다.";
        }
      }
    } catch (e) {
      console.error("[Load Creator Sub error]:", e);
      if (artRef.current) {
        artRef.current.notice.show = "자막 추출 중 오류가 발생했습니다.";
      }
    } finally {
      setLoadingCreatorName(null);
    }
  };

  const autoNextRef = useRef(autoNextEnabled);
  useEffect(() => {
    autoNextRef.current = autoNextEnabled;
  }, [autoNextEnabled]);

  // Helper to format seconds as mm:ss
  const formatTimeStr = (sec: number) => {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const remS = s % 60;
    return `${m}:${remS < 10 ? "0" : ""}${remS}`;
  };

  // Helper to extract OP/ED label summary (e.g., OP/ED, OP, ED)
  const getSkipLabelDesc = (intervals: SkipInterval[]) => {
    const hasOp = intervals.some((i) => i.type === "op" || (i.label && i.label.includes("오프닝")));
    const hasEd = intervals.some((i) => i.type === "ed" || (i.label && i.label.includes("엔딩")));
    if (hasOp && hasEd) return "OP/ED";
    if (hasOp) return "OP";
    if (hasEd) return "ED";
    return "";
  };

  const skipIntervalsRef = useRef<SkipInterval[]>(skipIntervals);
  useEffect(() => {
    skipIntervalsRef.current = skipIntervals;
  }, [skipIntervals]);

  // Apply timeline highlight markers / range bars to Artplayer progress bar
  const applyTimelineHighlight = useCallback((intervals: SkipInterval[]) => {
    skipIntervalsRef.current = intervals;
    if (!artRef.current) return;
    const art = artRef.current;

    const render = () => {
      if (!art || art.isDestroy) return false;
      const progressEl = art.template?.$progress;
      if (!progressEl) return false;
      const highlightContainer = progressEl.querySelector(".art-progress-highlight") as HTMLElement | null;
      if (!highlightContainer) return false;

      const currentIntervals = skipIntervalsRef.current;
      if (!currentIntervals || currentIntervals.length === 0) {
        highlightContainer.innerHTML = "";
        return true;
      }

      const duration = art.duration || art.template?.$video?.duration || 0;
      if (!duration || isNaN(duration) || duration <= 0) {
        return false;
      }

      highlightContainer.innerHTML = "";

      currentIntervals.forEach((item) => {
        const start = Math.max(0, item.start);
        const end = Math.min(duration, item.end);
        if (end <= start) return;

        const leftPercent = Math.max(0, Math.min(100, (start / duration) * 100));
        const widthPercent = Math.max(0.4, Math.min(100 - leftPercent, ((end - start) / duration) * 100));

        const span = document.createElement("span");
        const isEd = item.type === "ed" || (item.label && item.label.includes("엔딩"));
        span.className = `art-highlight-range ${isEd ? "art-highlight-ed" : "art-highlight-op"}`;
        span.dataset.text = `${item.label} (${formatTimeStr(start)} ~ ${formatTimeStr(end)})`;
        span.dataset.time = String(start);

        span.style.setProperty("left", `${leftPercent}%`, "important");
        span.style.setProperty("width", `${widthPercent}%`, "important");
        span.style.setProperty("position", "absolute", "important");
        span.style.setProperty("top", "0", "important");
        span.style.setProperty("bottom", "0", "important");
        span.style.setProperty("height", "100%", "important");
        span.style.setProperty("transform", "none", "important");
        span.style.setProperty("pointer-events", "auto", "important");
        span.style.setProperty("cursor", "pointer", "important");
        span.style.setProperty("display", "block", "important");

        highlightContainer.appendChild(span);
      });

      console.log(`[SkipHighlight] Successfully rendered ${currentIntervals.length} ranges (duration: ${duration.toFixed(1)}s)`);
      return true;
    };

    art.__renderHighlights = render;
    render();

    // Duration 및 Loadedmetadata 갱신 시 안전 재렌더링
    const scheduleRetry = () => {
      setTimeout(render, 50);
      setTimeout(render, 300);
      setTimeout(render, 1000);
    };

    art.on("video:loadedmetadata", scheduleRetry);
    art.on("video:durationchange", scheduleRetry);
    art.on("video:canplay", scheduleRetry);
    art.on("video:play", scheduleRetry);

    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (render() || attempts >= 25 || !artRef.current) {
        clearInterval(timer);
      }
    }, 300);
  }, []);

  // Initialize Player
  useEffect(() => {
    let isMounted = true;
    let cleanupDoubleTap: (() => void) | null = null;
    let cleanupUnload: (() => void) | null = null;

    async function init() {
      try {
        await Promise.all([
          loadScript("/js/hls.min.js"),
          loadScript("/js/artplayer.js"),
          loadScript("/libass/subtitles-octopus.js"),
        ]);

        if (!isMounted || !containerRef.current) return;

        if (artRef.current) {
          stopPlayerImmediately();
          try {
            artRef.current.destroy(true);
          } catch {}
          artRef.current = null;
        }

        const Artplayer = window.Artplayer;
        const Hls = window.Hls;

        const art = new Artplayer({
          container: containerRef.current,
          url: currentM3u8UrlRef.current || m3u8Url,
          type: "m3u8",
          customType: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            m3u8: function (video: HTMLVideoElement, url: string, artInstance: any) {
              if (Hls && Hls.isSupported()) {
                if (artInstance.hls) {
                  // 이미 Hls 인스턴스가 존재하면 destroy/detach하지 않고 소스만 교체
                  // (미디어 분리로 인한 비디오 초기화 및 전체화면 풀림 방지)
                  try {
                    artInstance.hls.stopLoad();
                    artInstance.hls.loadSource(url);
                    artInstance.hls.startLoad();
                    return;
                  } catch (e) {
                    console.warn("[HLS loadSource error, recreating]:", e);
                    try {
                      artInstance.hls.destroy();
                    } catch {}
                    artInstance.hls = null;
                  }
                }
                const hls = new Hls({
                  enableWorker: true,
                  lowLatencyMode: true,
                });

                // HLS 에러 복구: fatal 에러 시 무한 정지 대신 제한 재시도 + 사용자 알림
                let networkRetry = 0;
                let mediaRetry = 0;
                hls.on(Hls.Events.ERROR, (_evt: unknown, data: any) => {
                  if (!data || !data.fatal) return;
                  if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    if (networkRetry < 2) {
                      networkRetry += 1;
                      artInstance.notice.show = "네트워크가 불안정합니다. 다시 시도합니다...";
                      hls.startLoad();
                    } else {
                      artInstance.notice.show = "영상 스트림을 불러오지 못했습니다. 네트워크를 확인 후 새로고침해 주세요.";
                    }
                  } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    if (mediaRetry < 2) {
                      mediaRetry += 1;
                      artInstance.notice.show = "재생 오류가 발생했습니다. 복구 중입니다...";
                      hls.recoverMediaError();
                    } else {
                      artInstance.notice.show = "재생 오류가 발생했습니다. 페이지를 새로고침해 주세요.";
                    }
                  } else {
                    artInstance.notice.show = "영상 스트림을 불러오지 못했습니다.";
                  }
                });
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                  networkRetry = 0;
                  mediaRetry = 0;
                });

                hls.loadSource(url);
                hls.attachMedia(video);
                artInstance.hls = hls;
              } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
                video.src = url;
              } else {
                artInstance.notice.show = "HLS 재생이 지원되지 않는 브라우저입니다.";
              }
            },
          },
          theme: "#a855f7",
          autoplay: true,
          autoSize: false,
          playbackRate: true,
          aspectRatio: true,
          setting: true,
          hotkey: playerSettings.hotkey,
          gesture: true,
          pip: false,
          fullscreen: playerSettings.fullscreenBtn,
          fullscreenWeb: playerSettings.fullscreenWebBtn,
          subtitleOffset: true,
          miniProgressBar: playerSettings.miniProgressBar,
          autoPlayback: false,
          playsInline: true,
          lang: "ko",
          i18n: {
            ko: {
              Play: "재생",
              Pause: "일시정지",
              Mute: "음소거",
              Volume: "음량",
              "Playback Rate": "재생 속도",
              "Aspect Ratio": "화면 비율",
              Subtitle: "자막",
              "Subtitle Offset": "자막 싱크",
              Setting: "설정",
              Pip: "PIP 모드",
              Fullscreen: "전체화면",
              "Web Fullscreen": "웹 전체화면",
              "Mini Player": "미니 플레이어",
              Screenshot: "화면 캡처",
              Normal: "기본(1.0x)",
              Default: "기본",
              Auto: "자동",
              Close: "닫기",
              "About ArtPlayer": "ArtPlayer 정보",
              "Video Info": "영상 정보",
            },
          },
          subtitle: {
            url: defaultVttUrl || "",
            type: "vtt",
            escape: false,
            style: {
              color: "#ffffff",
              fontSize: `${currentSubSize}px`,
              fontWeight: "700",
              background: "transparent",
              backgroundColor: "transparent",
              textShadow:
                "2px 2px 0px #000, -2px -2px 0px #000, 2px 2px 0px #000, -2px 2px 0px #000, 0px 2px 0px #000, 0px -2px 0px #000, 2px 0px 0px #000, -2px 0px 0px #000, 0 0 10px rgba(0, 0, 0, 0.95)",
            },
          },
          controls: [
            {
              name: "skip85s",
              position: "left",
              index: 35,
              html: '<button type="button" class="art-icon skip-85s-btn art-control-skip85s" title="오프닝 +85초 즉시 건너뛰기" style="display:inline-flex;align-items:center;justify-content:center;height:100%;padding:0 8px;margin-left:6px;font-size:11px;font-weight:700;color:#fff;background:none;border:none;cursor:pointer;border-radius:4px;transition:all 0.2s;"><span class="skip-85s-label" style="background:rgba(255,255,255,0.12);color:#ffffff;padding:2px 8px;border-radius:6px;border:1px solid rgba(255,255,255,0.25);font-size:11px;font-weight:800;line-height:1.2;transition:all 0.2s;">85s</span></button>',
              tooltip: "+85초 건너뛰기",
              click: function () {
                if (art && art.video) {
                  art.seek = Math.min(art.duration || 9999, art.currentTime + 85);
                  art.notice.show = "⏩ +85초 건너뛰기 완료";
                }
              },
            },
            {
              name: "speed2x",
              position: "right",
              index: 25,
              html: '<button type="button" class="art-icon speed-2x-btn art-control-speed2x" title="배속 순환 (1x ➔ 1.3x ➔ 1.5x ➔ 2x)" style="display:inline-flex;align-items:center;justify-content:center;height:100%;padding:0 6px;font-size:12px;font-weight:700;color:#fff;background:none;border:none;cursor:pointer;border-radius:4px;transition:all 0.2s;"><span class="speed-2x-label speed-rate-label" style="background:rgba(255,255,255,0.12);color:#ffffff;padding:2px 7px;border-radius:4px;border:1px solid rgba(255,255,255,0.25);font-size:12px;font-weight:700;line-height:1.2;transition:all 0.2s;">1x</span></button>',
              tooltip: "배속 조절 (1x ➔ 1.3x ➔ 1.5x ➔ 2x)",
              click: function () {
                const currentRate = (art && art.playbackRate) ? art.playbackRate : 1.0;
                let nextIdx = 0;
                const foundIdx = SPEED_CYCLE_RATES.findIndex((r) => Math.abs(r - currentRate) < 0.05);
                if (foundIdx !== -1) {
                  nextIdx = (foundIdx + 1) % SPEED_CYCLE_RATES.length;
                } else {
                  nextIdx = 1;
                }
                const newRate = SPEED_CYCLE_RATES[nextIdx];
                if (art) {
                  art.playbackRate = newRate;
                  art.notice.show = `재생 속도: ${newRate}x`;
                }
                // PIP 문서에서 동작하도록 플레이어 소유 문서를 전달
                updateSpeed2xButton(newRate, (art?.template?.$player as HTMLElement | undefined)?.ownerDocument);
              },
            },
            {
              name: "hybridPip",
              position: "right",
              index: 38,
              html: '<button type="button" class="art-icon hybrid-pip-btn art-control-hybrid-pip" title="화면 속 화면 (PIP)" style="display:inline-flex;align-items:center;justify-content:center;height:100%;padding:0 6px;color:#fff;background:none;border:none;cursor:pointer;border-radius:4px;transition:all 0.2s;"><svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" style="vertical-align:middle;"><path d="M844.8 219.648h-665.6c-6.144 0-10.24 4.608-10.24 10.752v563.2c0 5.632 4.096 10.24 10.24 10.24h256v92.16h-256a102.4 102.4 0 0 1-102.4-102.4v-563.2c0-56.832 45.568-102.4 102.4-102.4h665.6a102.4 102.4 0 0 1 102.4 102.4v204.8h-92.16v-204.8c0-6.144-4.608-10.752-10.24-10.752zM614.4 588.8c-28.672 0-51.2 22.528-51.2 51.2v204.8c0 28.16 22.528 51.2 51.2 51.2h281.6c28.16 0 51.2-23.04 51.2-51.2v-204.8c0-28.672-23.04-51.2-51.2-51.2H614.4z"></path></svg></button>',
              tooltip: "화면 속 화면 (PIP)",
              click: function () {
                toggleHybridPip();
              },
            },
          ],
          settings: [
            {
              name: "subtitleSelector",
              width: 240,
              html: "자막 선택",
              tooltip: defaultVttUrl ? "기본 내장" : "자막 없음",
              selector: [
                ...(defaultVttUrl
                  ? [
                      {
                        html: "⚪ 기본 내장",
                        subData: { name: "기본 내장", format: "VTT", is_ass: false, url: defaultVttUrl },
                        default: true,
                      },
                    ]
                  : []),
                {
                  html: "🚫 자막 끄기",
                  subData: { name: "자막 끄기", format: "VTT", is_ass: false, url: "" },
                  default: !defaultVttUrl,
                },
              ],
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onSelect: function (item: any) {
                if (item.subData.name === "자막 끄기" || (!item.subData.url && !item.subData.content)) {
                  setSelectedSubIndex(-1);
                  currentSubRef.current = null;
                  currentAssContentRef.current = null;
                  updateNativeTrackElement("");
                  hideAllNativeVideoTracks();
                  if (nativePipTextTrackRef.current) {
                    nativePipTextTrackRef.current.mode = "hidden";
                    if (nativePipTextTrackRef.current.cues) {
                      Array.from(nativePipTextTrackRef.current.cues).forEach((c) => {
                        try {
                          nativePipTextTrackRef.current?.removeCue(c);
                        } catch {}
                      });
                    }
                  }
                  if (octopusRef.current) {
                    try {
                      octopusRef.current.dispose();
                    } catch {}
                    octopusRef.current = null;
                  }
                  if (containerRef.current) {
                    containerRef.current
                      .querySelectorAll(".libassjs-canvas-parent, canvas.libassjs-canvas")
                      .forEach((el) => el.remove());
                  }
                  if (artRef.current) {
                    artRef.current.subtitle.show = false;
                    // VTT 자막 영역의 인라인 display가 남아 자막이 꺼지지 않는 문제 방지
                    if (artRef.current.template?.$subtitle) {
                      artRef.current.template.$subtitle.style.display = "none";
                    }
                    artRef.current.notice.show = "자막 꺼짐";
                  }
                } else {
                  applySubtitle(item.subData, currentSyncOffset);
                }
                return item.html;
              },
            },
            {
              name: "subtitleSync",
              width: 220,
              html: "자막 싱크",
              tooltip: "0.0 초",
              selector: [
                { html: "-1.0 초", value: -1.0 },
                { html: "-0.5 초", value: -0.5 },
                { html: "-0.2 초", value: -0.2 },
                { html: "0.0 초 (기본)", value: 0.0, default: true },
                { html: "+0.2 초", value: 0.2 },
                { html: "+0.5 초", value: 0.5 },
                { html: "+1.0 초", value: 1.0 },
              ],
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onSelect: function (item: any) {
                setSubtitleSyncOffset(item.value);
                return item.html;
              },
            },
            {
              name: "subtitleSize",
              width: 230,
              html: "자막 크기",
              tooltip: `${currentSubSize}px`,
              selector: [
                { html: "아주 작게 (16px)", value: 16, default: currentSubSize === 16 },
                { html: "작게 (19px)", value: 19, default: currentSubSize === 19 },
                { html: "보통 (22px - 추천)", value: 22, default: currentSubSize === 22 },
                { html: "약간 크게 (25px)", value: 25, default: currentSubSize === 25 },
                { html: "크게 (28px)", value: 28, default: currentSubSize === 28 },
                { html: "아주 크게 (34px)", value: 34, default: currentSubSize === 34 },
                { html: "특대 (40px)", value: 40, default: currentSubSize === 40 },
              ],
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onSelect: function (item: any) {
                setSubtitleFontSize(item.value);
                return item.html;
              },
            },
          ],
          highlight: [],
          layers: [
            {
              name: "doubleTapOverlay",
              html: `
                <div class="art-double-tap-overlay">
                  <div class="art-double-tap-ripple art-double-tap-left" id="dt-ripple-left">
                    <div class="art-double-tap-content">
                      <div class="art-double-tap-arrows">
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M11 19V5l-8.5 7 8.5 7zm.5-7l8.5 7V5l-8.5 7z"/></svg>
                      </div>
                      <div class="art-double-tap-label" id="dt-label-left">-${playerSettings.doubleTouchDuration || 10}초</div>
                    </div>
                  </div>
                  <div class="art-double-tap-ripple art-double-tap-right" id="dt-ripple-right">
                    <div class="art-double-tap-content">
                      <div class="art-double-tap-arrows">
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M4 19l8.5-7L4 5v14zm9-14v14l8.5-7L13 5z"/></svg>
                      </div>
                      <div class="art-double-tap-label" id="dt-label-right">+${playerSettings.doubleTouchDuration || 10}초</div>
                    </div>
                  </div>
                </div>
              `,
              style: {
                position: "absolute",
                top: "0",
                left: "0",
                width: "100%",
                height: "100%",
                pointerEvents: "none",
                zIndex: "35",
              },
            },
            {
              name: "mobileCenterControls",
              html: `
                <div class="art-mobile-center-controls">
                  <button type="button" class="art-mobile-center-btn art-mobile-seek-backward" id="mobile-seek-backward" aria-label="뒤로 탐색">
                    <div class="art-mobile-seek-inner">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M11 19V5l-8.5 7 8.5 7zm.5-7l8.5 7V5l-8.5 7z"/>
                      </svg>
                      <span class="art-mobile-seek-sec" id="mobile-seek-sec-back">${playerSettings.doubleTouchDuration || 10}</span>
                    </div>
                  </button>
                  <button type="button" class="art-mobile-center-btn art-mobile-center-play" id="mobile-center-play" aria-label="재생 또는 일시정지">
                    <svg class="art-mobile-play-icon" id="mobile-icon-play" width="38" height="38" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                    <svg class="art-mobile-pause-icon" id="mobile-icon-pause" width="38" height="38" viewBox="0 0 24 24" fill="currentColor" style="display:none;">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                  </button>
                  <button type="button" class="art-mobile-center-btn art-mobile-seek-forward" id="mobile-seek-forward" aria-label="앞으로 탐색">
                    <div class="art-mobile-seek-inner">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M4 19l8.5-7L4 5v14zm9-14v14l8.5-7L13 5z"/>
                      </svg>
                      <span class="art-mobile-seek-sec" id="mobile-seek-sec-fwd">${playerSettings.doubleTouchDuration || 10}</span>
                    </div>
                  </button>
                </div>
              `,
              style: {
                position: "absolute",
                top: "0",
                left: "0",
                width: "100%",
                height: "100%",
                pointerEvents: "none",
                zIndex: "36",
              },
            },
          ],
        });

        artRef.current = art;

        if (!isMounted) {
          try {
            if (art.hls) {
              art.hls.stopLoad?.();
              art.hls.detachMedia?.();
              art.hls.destroy?.();
            }
            if (art.video) {
              art.video.pause();
              art.video.removeAttribute("src");
              art.video.load();
            }
            art.destroy(true);
          } catch {}
          artRef.current = null;
          return;
        }

        // 🌟 미니 진행바(컨트롤 자동 숨김 = art-mini-progress-bar) 터치 오조작 차단:
        // 컨트롤이 내려간 상태에서는 미니 진행바에 닿는 touchstart/touchmove를 포캐스 단계에서 stopPropagation하여
        // ArtPlayer 내부 시크 핸들러 자체를 실행 불능으로 만든다(제스처 탐색 금지, 이동 불가).
        // 컨트롤바가 완전히 올라온 상태(클래스 제거)에서만 기존과 동일하게 화면 탐색이 허용된다.
        if (art && art.template && art.template.$bottom && art.template.$player) {
            const $miniBottomEl = art.template.$bottom;
            const blockMiniProgressBarTouch = function (evt: TouchEvent) {
                if (art.template.$player.classList.contains("art-mini-progress-bar")) {
                    evt.stopPropagation();
                }
            };
            art.events.proxy($miniBottomEl, "touchstart", blockMiniProgressBarTouch, { capture: true });
            art.events.proxy($miniBottomEl, "touchmove", blockMiniProgressBarTouch, { capture: true });
        }

        // 🌟 모바일 화면 꾹 누르고 스와이프 탐색 (mobileGesture) 온/오프 제어:
        // mobileGesture가 false일 때, 영상 화면 영역에서의 touchmove를 캡처 단계에서 stopPropagation하여
        // Artplayer 내부의 제스처 시크 핸들러(좌우 스와이프 탐색)로 이벤트가 전파되는 것을 원천 차단한다.
        // 하단 진행바 및 컨트롤 UI는 제외하여 일반적인 버튼 조작 및 진행바 탐색은 정상 유지된다.
        if (art && art.template && art.template.$player) {
          const blockScreenGestureTouchMove = function (evt: TouchEvent) {
            if (playerSettingsRef.current.mobileGesture) return;
            const target = evt.target as HTMLElement | null;
            if (
              target &&
              target.closest(
                ".art-bottom, .art-controls, .art-progress, .art-settings, .art-contextmenus, button, input, a, .player-settings-modal-root"
              )
            ) {
              return;
            }
            evt.stopPropagation();
          };
          art.events.proxy(art.template.$player, "touchmove", blockScreenGestureTouchMove, { capture: true });
        }

        // 데스크톱 더블클릭 및 모바일 클릭/더블클릭 오작동 방지 플래그
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((window as any).Artplayer) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).Artplayer.DBCLICK_FULLSCREEN = false;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).Artplayer.MOBILE_DBCLICK_PLAY = false;
        }

        // ==========================================
        // 🌟 더블탭 리플 및 공통 누적 탐색 로직 (모바일 화면 & 중앙 컨트롤 공용)
        // ==========================================
        let lastSeekTime = 0;
        let lastSeekSide: "left" | "right" | null = null;
        let cumulativeSec = 0;
        let resetSeekTimer: ReturnType<typeof setTimeout> | null = null;
        let rippleHideTimer: ReturnType<typeof setTimeout> | null = null;
        let wasPlayingBeforeTap = false;
        let lastTouchTimestamp = 0;

        const showDoubleTapFeedback = (side: "left" | "right", seconds: number) => {
          // Document PiP 활성 시 리플/레이블은 PIP 문서에 있으므로 ownerDocument 기준 조회
          const doc = (artRef.current?.template?.$player as HTMLElement | undefined)?.ownerDocument || document;
          const leftRipple = doc.getElementById("dt-ripple-left");
          const rightRipple = doc.getElementById("dt-ripple-right");
          const leftLabel = doc.getElementById("dt-label-left");
          const rightLabel = doc.getElementById("dt-label-right");

          if (side === "left" && leftRipple && leftLabel) {
            leftLabel.textContent = `-${seconds}초`;
            leftRipple.classList.remove("active");
            void leftRipple.offsetWidth;
            leftRipple.classList.add("active");
          } else if (side === "right" && rightRipple && rightLabel) {
            rightLabel.textContent = `+${seconds}초`;
            rightRipple.classList.remove("active");
            void rightRipple.offsetWidth;
            rightRipple.classList.add("active");
          }

          if (artRef.current) {
            artRef.current.notice.show = side === "left" ? `⏪ ${seconds}초 뒤로` : `⏩ ${seconds}초 앞으로`;
          }

          if (rippleHideTimer) clearTimeout(rippleHideTimer);
          rippleHideTimer = setTimeout(() => {
            if (leftRipple) leftRipple.classList.remove("active");
            if (rightRipple) rightRipple.classList.remove("active");
          }, 600);
        };

        // 🌟 통합 누적 탐색 함수 (모바일 화면 더블터치 & 상태바 중앙 앞뒤 탐색 버튼에서 함께 사용)
        const executeSeekWithAccumulation = (side: "left" | "right") => {
          if (!playerSettingsRef.current.doubleTouchSeek) return;
          const step = playerSettingsRef.current.doubleTouchDuration || 10;
          const now = Date.now();

          if (side === lastSeekSide && now - lastSeekTime < 650) {
            cumulativeSec += step;
          } else {
            cumulativeSec = step;
            lastSeekSide = side;
          }
          lastSeekTime = now;

          if (side === "left") {
            art.seek = Math.max(0, art.currentTime - step);
          } else {
            art.seek = Math.min(art.duration || 99999, art.currentTime + step);
          }

          // 첫 번째 탭/클릭으로 일시정지되었던 경우 재생 상태 복원
          if (wasPlayingBeforeTap && art.video && art.video.paused) {
            art.play().catch(() => {});
          }

          showDoubleTapFeedback(side, cumulativeSec);

          // 중앙 버튼 누를 때 컨트롤바 자동 숨김 타이머 연장(연타 중 컨트롤바가 꺼지지 않도록)
          if (art && art.controls) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (art.controls as any).timer = Date.now();
          }

          if (resetSeekTimer) clearTimeout(resetSeekTimer);
          resetSeekTimer = setTimeout(() => {
            cumulativeSec = 0;
            lastSeekSide = null;
          }, 750);
        };

        // ==========================================
        // 🌟 모바일 (터치 디바이스) 전용 제스처 핸들러
        // 1. 더블터치 시 누적 탐색
        // 2. 더블터치 시 상태바가 나오지 않게 제어
        // 3. 상태바 켜져 있을 때 빈칸 탭 시 즉시 닫기 (유튜브 모바일 UX)
        // ==========================================
        let lastTouchTime = 0;
        let lastTouchSide: "left" | "right" | null = null;
        let touchTapTimer: ReturnType<typeof setTimeout> | null = null;

        const handlePointerUp = (e: PointerEvent) => {
          const target = e.target as HTMLElement | null;
          if (!target) return;

          // 컨트롤 UI, 버튼, 모달 등 영역 터치는 화면 빈칸 제스처에서 제외
          if (
            target.closest(
              ".art-bottom, .art-controls, .art-settings, .art-contextmenus, .art-notice, .art-loading, .art-mobile-center-controls, button, a, input, .player-settings-modal-root"
            )
          ) {
            return;
          }

          const isTouch = e.pointerType === "touch" || ("ontouchstart" in window && e.pointerType !== "mouse");

          // 데스크톱 (마우스) 환경은 데스크톱 전용 핸들러에서 처리
          if (!isTouch) return;

          // 터치 타임스탬프 기록 (합성 dblclick 차단용)
          lastTouchTimestamp = Date.now();

          const playerEl = art.template.$player as HTMLElement;
          if (playerEl && !playerEl.classList.contains("is-touch-device")) {
            playerEl.classList.add("is-touch-device");
          }

          if (!playerSettingsRef.current.doubleTouchSeek) {
            // 더블터치 비활성화 시 일반 컨트롤 토글
            if (art && art.controls) {
              art.controls.show = !art.controls.show;
            }
            return;
          }

          if (!playerEl) return;
          const rect = playerEl.getBoundingClientRect();
          // 하단 65px 컨트롤바 영역 터치는 제스처에서 제외
          if (e.clientY > rect.bottom - 65) return;

          const x = e.clientX - rect.left;
          const width = rect.width;
          const side: "left" | "right" = x < width * 0.5 ? "left" : "right";
          const now = Date.now();
          const diff = now - lastTouchTime;

          // 현재 상태바(컨트롤바)가 화면에 표시 중인지 판별
          const isControlsShowing = !!(
            art.controls?.show ||
            playerEl.classList.contains("art-hover") ||
            playerEl.classList.contains("art-control-show")
          );

          // 🌟 [케이스 1] 상태바가 이미 켜져 있는 상태에서 빈칸을 탭한 경우:
          // 유튜브 모바일 정석 UX: 지연 없이 즉시 상태바 닫기!
          if (isControlsShowing && diff >= 350) {
            if (touchTapTimer) {
              clearTimeout(touchTapTimer);
              touchTapTimer = null;
            }
            if (art && art.controls) {
              art.controls.show = false;
            }
            lastTouchTime = now;
            lastTouchSide = side;
            return;
          }

          // 🌟 [케이스 2] 더블 터치 감지 (동일 영역 & 380ms 이내)
          if (side === lastTouchSide && diff < 380) {
            // 1. 싱글 탭 대기 타이머 즉시 취소 ➔ 상태바가 나타나는 것을 원천 차단!
            if (touchTapTimer) {
              clearTimeout(touchTapTimer);
              touchTapTimer = null;
            }

            // 2. 만약 상태바가 열려있다면 즉시 숨김
            if (art && art.controls && art.controls.show) {
              art.controls.show = false;
            }

            // 3. 누적 탐색 실행
            executeSeekWithAccumulation(side);
            lastTouchTime = now;
          } else {
            // 🌟 [케이스 3] 상태바가 꺼져 있을 때 첫 번째 터치
            wasPlayingBeforeTap = art.video ? !art.video.paused : false;
            lastTouchTime = now;
            lastTouchSide = side;

            if (touchTapTimer) clearTimeout(touchTapTimer);
            // 260ms 후 싱글 탭 확정 (더블터치 확인 시 취소됨)
            touchTapTimer = setTimeout(() => {
              touchTapTimer = null;
              lastTouchSide = null;
              // 싱글 탭 확정: 상태바(컨트롤바) 켜기!
              if (art && art.controls) {
                art.controls.show = true;
              }
            }, 260);
          }
        };

        // 모바일 터치 후 브라우저가 생성하는 합성 click 이벤트가 Artplayer 내부로 전파되는 것을 캡처 단계에서 차단
        const handlePlayerClickCapture = (e: MouseEvent) => {
          if (Date.now() - lastTouchTimestamp < 600) {
            const target = e.target as HTMLElement | null;
            // 버튼, 하단/상단 컨트롤바, 모달 등의 직접 클릭은 통과시킴
            if (
              target &&
              target.closest(
                ".art-mobile-center-btn, .art-bottom, .art-top, .art-settings, .art-contextmenus, button, input, a"
              )
            ) {
              return;
            }
            // 비디오 화면 빈칸에 떨어지는 합성 클릭은 차단(Artplayer의 click 토글 방지)
            e.stopPropagation();
            e.preventDefault();
          }
        };

        // ==========================================
        // 🌟 데스크톱 (PC / 마우스) 환경 전용 핸들러
        // 1. 더블클릭 시 무조건 전체화면 토글만 동작 (탐색 제외)
        // 2. 모바일 터치로 인한 가짜 dblclick은 100% 원천 차단
        // ==========================================
        let desktopWasPlaying = false;

        const handlePlayerDblClick = (e: MouseEvent) => {
          // 🌟 모바일 터치 후 1000ms 이내에 발생하는 합성 dblclick은 무조건 차단! (모바일 더블터치 전체화면 방지)
          if (Date.now() - lastTouchTimestamp < 1000) {
            e.stopPropagation();
            e.preventDefault();
            return;
          }

          const target = e.target as HTMLElement | null;
          if (!target) return;
          if (
            target.closest(
              ".art-bottom, .art-controls, .art-settings, .art-contextmenus, .art-notice, .art-loading, .art-mobile-center-controls, button, a, input, .player-settings-modal-root"
            )
          ) {
            return;
          }

          // 🌟 데스크톱 더블클릭: 무조건 전체화면 토글! (탐색은 절대로 발생하지 않음)
          art.fullscreen = !art.fullscreen;

          // 1번째 클릭으로 인해 비디오 재생/정지 상태가 바뀐 경우 원래 상태로 복원
          setTimeout(() => {
            if (art && art.video) {
              if (desktopWasPlaying && art.video.paused) {
                art.play().catch(() => {});
              } else if (!desktopWasPlaying && !art.video.paused) {
                art.pause();
              }
            }
          }, 15);
        };

        const handlePlayerMouseDown = (e: MouseEvent) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (e.button === 0 && (e as any).pointerType !== "touch" && Date.now() - lastTouchTimestamp > 1000) {
            desktopWasPlaying = art.video ? !art.video.paused : false;
          }
        };

        // ==========================================
        // 🌟 모바일 상태바 중앙 컨트롤 이벤트 바인딩
        // (뒤로 탐색, 재생/일시정지, 앞으로 탐색)
        // ==========================================
        let cleanupCenterControls: (() => void) | null = null;
        const bindMobileCenterControls = () => {
          const doc = (art.template.$player as HTMLElement)?.ownerDocument || document;
          const btnSeekBack = doc.getElementById("mobile-seek-backward");
          const btnSeekFwd = doc.getElementById("mobile-seek-forward");
          const btnPlay = doc.getElementById("mobile-center-play");
          const iconPlay = doc.getElementById("mobile-icon-play");
          const iconPause = doc.getElementById("mobile-icon-pause");

          const updatePlayStateIcons = () => {
            if (!iconPlay || !iconPause || !art.video) return;
            if (art.video.paused) {
              iconPlay.style.display = "block";
              iconPause.style.display = "none";
            } else {
              iconPlay.style.display = "none";
              iconPause.style.display = "block";
            }
          };

          const onSeekBack = (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
            executeSeekWithAccumulation("left");
          };

          const onSeekFwd = (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
            executeSeekWithAccumulation("right");
          };

          const onTogglePlay = (e: Event) => {
            e.stopPropagation();
            e.preventDefault();
            art.toggle();
            if (art.controls) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (art.controls as any).timer = Date.now();
            }
          };

          if (btnSeekBack) btnSeekBack.addEventListener("click", onSeekBack);
          if (btnSeekFwd) btnSeekFwd.addEventListener("click", onSeekFwd);
          if (btnPlay) btnPlay.addEventListener("click", onTogglePlay);

          art.on("play", updatePlayStateIcons);
          art.on("pause", updatePlayStateIcons);
          updatePlayStateIcons();

          cleanupCenterControls = () => {
            if (btnSeekBack) btnSeekBack.removeEventListener("click", onSeekBack);
            if (btnSeekFwd) btnSeekFwd.removeEventListener("click", onSeekFwd);
            if (btnPlay) btnPlay.removeEventListener("click", onTogglePlay);
            art.off("play", updatePlayStateIcons);
            art.off("pause", updatePlayStateIcons);
          };
        };

        bindMobileCenterControls();

        const playerEl = art.template.$player as HTMLElement;
        if (playerEl) {
          playerEl.addEventListener("pointerup", handlePointerUp);
          playerEl.addEventListener("click", handlePlayerClickCapture, { capture: true });
          playerEl.addEventListener("dblclick", handlePlayerDblClick, { capture: true });
          playerEl.addEventListener("mousedown", handlePlayerMouseDown);
        }

        cleanupDoubleTap = () => {
          if (playerEl) {
            playerEl.removeEventListener("pointerup", handlePointerUp);
            playerEl.removeEventListener("click", handlePlayerClickCapture, { capture: true });
            playerEl.removeEventListener("dblclick", handlePlayerDblClick, { capture: true });
            playerEl.removeEventListener("mousedown", handlePlayerMouseDown);
          }
          if (touchTapTimer) clearTimeout(touchTapTimer);
          if (resetSeekTimer) clearTimeout(resetSeekTimer);
          if (rippleHideTimer) clearTimeout(rippleHideTimer);
          if (cleanupCenterControls) cleanupCenterControls();
        };

        // Playback rate event and ready handler
        art.on("playbackRate", (rate: number) => {
          updateSpeed2xButton(rate, (art?.template?.$player as HTMLElement | undefined)?.ownerDocument);
        });

        // 🌟 하이브리드 PIP - 네이티브 Video PiP 진입/해제 이벤트 연동
        const handleNativePipEnter = () => {
          if (art && art.template && art.template.$player) {
            art.template.$player.classList.add("in-native-pip");
          }
          syncCuesToPipTrack(true).catch(() => {});
          if (art && art.notice) {
            art.notice.show = "화면 속 화면 (PIP) 모드 실행됨";
          }
        };
        const handleNativePipLeave = () => {
          hideAllNativeVideoTracks();
          if (nativePipTextTrackRef.current) {
            nativePipTextTrackRef.current.mode = "hidden";
          }
          if (pipTrackElementRef.current && pipTrackElementRef.current.track) {
            pipTrackElementRef.current.track.mode = "hidden";
          }
          if (art && art.template && art.template.$player) {
            art.template.$player.classList.remove("in-native-pip");
          }
          if (octopusRef.current && typeof octopusRef.current.resize === "function") {
            try {
              octopusRef.current.resize();
            } catch {}
          }
        };

        art.on("video:enterpictureinpicture", handleNativePipEnter);
        art.on("video:leavepictureinpicture", handleNativePipLeave);
        if (art.video) {
          art.video.addEventListener("enterpictureinpicture", handleNativePipEnter);
          art.video.addEventListener("leavepictureinpicture", handleNativePipLeave);
          // 🌟 iOS Safari WebKit 전용 PiP 이벤트 연동
          art.video.addEventListener("webkitpresentationmodechanged", () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((art.video as any).webkitPresentationMode === "picture-in-picture") {
              handleNativePipEnter();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } else if ((art.video as any).webkitPresentationMode === "inline") {
              handleNativePipLeave();
            }
          });
        }

        art.once("ready", () => {
          setSubtitleFontSize(currentSubSize);
          applyPlayerSettingsStyles(playerSettings);
          const savedRate = parseFloat(localStorage.getItem("anime_playback_rate") || "1.0");
          if (savedRate && Math.abs(savedRate - 1.0) >= 0.05) {
            art.playbackRate = savedRate;
            updateSpeed2xButton(savedRate, (art?.template?.$player as HTMLElement | undefined)?.ownerDocument);
          }

          // 🌟 플레이어 준비 완료 시 대기 중인 자막이 있으면 즉시 적용, 없으면 기본 내장 자막 즉시 적용
          if (pendingSubtitleRef.current && applySubtitleRef.current) {
            applySubtitleRef.current(pendingSubtitleRef.current, currentSyncOffsetRef.current);
          } else if (defaultVttUrl && applySubtitleRef.current) {
            applySubtitleRef.current(
              {
                name: "기본 내장",
                format: "VTT",
                is_ass: false,
                url: defaultVttUrl,
              },
              currentSyncOffsetRef.current
            );
          }
        });

        // Auto re-apply highlights on metadata or duration changes
        art.on("video:loadedmetadata", () => {
          if (!isNativePipActive()) {
            hideAllNativeVideoTracks();
          }
          if (skipIntervalsRef.current.length > 0) {
            applyTimelineHighlight(skipIntervalsRef.current);
          }
        });
        art.on("video:play", () => {
          if (!isNativePipActive()) {
            hideAllNativeVideoTracks();
          }
        });
        art.on("video:durationchange", () => {
          if (skipIntervalsRef.current.length > 0) {
            applyTimelineHighlight(skipIntervalsRef.current);
          }
        });
        if (skipIntervalsRef.current.length > 0) {
          applyTimelineHighlight(skipIntervalsRef.current);
        }

        // Helper: 영상이 거의 끝까지(95% 이상 or 15초 미만 남음) 시청 완료되었는지 검사
        const isPlaybackCompleted = (sec: number, dur: number) => {
          if (!dur || dur <= 0) return false;
          return sec >= dur - 15 || (dur > 60 && sec / dur >= 0.95);
        };

        // Restore playback time from localStorage or Cloud DB
        const getSaveKey = (ep = currentEpRef.current) => `anime_progress_${animeId}_ep${ep}`;
        const initialEp = currentEpRef.current;
        const initialSaveKey = getSaveKey(initialEp);
        const savedSec = parseFloat(localStorage.getItem(initialSaveKey) || "0");

        const tryRestorePlaybackTime = (targetSec: number, isFromCloud = false) => {
          if (targetSec <= 10) return;
          const dur = art.duration || art.template?.$video?.duration || 0;
          if (dur > 0 && isPlaybackCompleted(targetSec, dur)) {
            // 이미 100% (완료) 시청된 경우 처음부터 재생
            console.log(`[Playback] Episode ${initialEp} was already completed (${targetSec.toFixed(1)}/${dur.toFixed(1)}s). Resetting to 0s.`);
            localStorage.removeItem(initialSaveKey);
            return;
          }

          art.currentTime = targetSec;
          art.notice.show = `${isFromCloud ? "클라우드 " : ""}이어보기: ${Math.floor(targetSec / 60)}분 ${Math.floor(targetSec % 60)}초부터 재생`;
        };

        if (savedSec > 10) {
          const onRestore = () => {
            tryRestorePlaybackTime(savedSec, false);
          };
          art.once("ready", onRestore);
          art.once("video:loadedmetadata", onRestore);
        } else {
          fetch(`/api/anime/history?anime_id=${animeId}`)
            .then((r) => r.json())
            .then((d) => {
              if (d.success && Array.isArray(d.items)) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const epHistory = d.items.find((h: any) => h.episode_number === initialEp);
                const cloudSec = epHistory ? parseFloat(epHistory.current_time || epHistory.watch_time || "0") : 0;
                if (cloudSec > 10 && !epHistory.is_completed && artRef.current) {
                  const onRestoreCloud = () => {
                    tryRestorePlaybackTime(cloudSec, true);
                  };
                  art.once("ready", onRestoreCloud);
                  art.once("video:loadedmetadata", onRestoreCloud);
                }
              }
            })
            .catch(() => {});
        }

        // Periodic cloud & local progress saving
        const syncHistory = (isCompleted = false) => {
          if (!art) return;
          const cur = art.currentTime;
          if (cur <= 2 && !isCompleted) return;

          const ep = currentEpRef.current;
          const watchUrl = currentM3u8UrlRef.current || m3u8Url;

          fetch("/api/anime/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              animeId,
              animeTitle,
              animePoster: animePoster || "",
              episodeNumber: ep,
              // 실제 회차 제목 우선 (사이트에서 스크래핑된 제목 유지, 없으면 "N화" 폴백)
              episodeTitle:
                currentEpisodes.find((e) => e.number === ep)?.title ||
                `${ep}화`,
              watchUrl,
              currentTime: cur,
              duration: art.duration || 0,
              isCompleted,
            }),
            keepalive: true,
          }).catch(() => {});

          setEpHistoryMap((prev) => ({
            ...prev,
            [ep]: {
              watch_time: cur,
              duration: art.duration || 0,
              is_completed: isCompleted,
            },
          }));
        };
        syncHistoryRef.current = syncHistory;

        art.on("video:timeupdate", () => {
          const cur = art.currentTime;
          const dur = art.duration || art.template?.$video?.duration || 0;
          const curSaveKey = getSaveKey(currentEpRef.current);

          if (cur > 2 && !art.ended) {
            const completed = isPlaybackCompleted(cur, dur);
            if (completed) {
              // 95% 이상 시청 시 완료 처리 및 로컬 저장 삭제 (다시 틀었을 때 0초부터 시작하도록)
              localStorage.removeItem(curSaveKey);
              if (Date.now() - lastSyncTimeRef.current > 5000) {
                lastSyncTimeRef.current = Date.now();
                syncHistory(true);
              }
            } else {
              localStorage.setItem(curSaveKey, String(cur));
              // Sync to Cloud DB every 35 seconds (서버리스 함수 및 DB 쓰기 70% 이상 절감)
              if (Date.now() - lastSyncTimeRef.current > 35000) {
                lastSyncTimeRef.current = Date.now();
                syncHistory(false);
              }
            }
          }

          // Self-healing: 스킵 구간 데이터가 있는데 하이라이트 DOM이 비워져 있다면 자동 복구
          if (
            skipIntervalsRef.current.length > 0 &&
            typeof art.__renderHighlights === "function" &&
            dur > 0
          ) {
            const container = art.template?.$progress?.querySelector(".art-progress-highlight");
            if (container && container.children.length === 0) {
              art.__renderHighlights();
            }
          }
        });

        art.on("video:pause", () => {
          if (Date.now() - lastSyncTimeRef.current > 3000) {
            lastSyncTimeRef.current = Date.now();
            syncHistory(false);
          }
        });

        let debouncedSeekTimer: ReturnType<typeof setTimeout> | null = null;
        art.on("video:seeked", () => {
          if (debouncedSeekTimer) clearTimeout(debouncedSeekTimer);
          debouncedSeekTimer = setTimeout(() => {
            lastSyncTimeRef.current = Date.now();
            syncHistory(false);
          }, 1200);
        });

        // Auto next episode on video end
        art.on("video:ended", () => {
          const curSaveKey = getSaveKey(currentEpRef.current);
          localStorage.removeItem(curSaveKey);
          syncHistory(true);

          const nextEp = currentNextEpRef.current;
          if (autoNextRef.current && nextEp) {
            art.notice.show = "다음 화로 자동 연결합니다...";
            setTimeout(() => {
              if (switchEpisodeRef.current) {
                switchEpisodeRef.current(nextEp);
              }
            }, 1000);
          }
        });

        const handleUnload = () => {
          syncHistory(false);
          stopPlayerImmediately();
        };
        const handlePopState = () => {
          const match = window.location.pathname.match(/\/watch\/[^/]+\/(\d+)/);
          if (match && match[1]) {
            const targetEp = parseInt(match[1], 10);
            if (targetEp !== currentEpRef.current && switchEpisodeRef.current) {
              switchEpisodeRef.current(targetEp);
            }
            return;
          }
          stopPlayerImmediately();
        };
        const handleLinkClick = (e: MouseEvent) => {
          const target = (e.target as HTMLElement)?.closest("a");
          if (!target || !target.href) return;
          if (target.hasAttribute("download")) return;
          if (target.target && target.target !== "_self") return;
          if (target.getAttribute("href")?.startsWith("#")) return;
          if (containerRef.current && containerRef.current.contains(target)) return;
          // 무중단 회차 전환 링크(/watch/...)는 비디오를 파괴하지 않음
          if (target.getAttribute("href")?.includes(`/watch/${animeId}/`)) return;
          stopPlayerImmediately();
        };

        window.addEventListener("beforeunload", handleUnload);
        window.addEventListener("pagehide", handleUnload);
        window.addEventListener("popstate", handlePopState);
        document.addEventListener("click", handleLinkClick, { capture: true });

        cleanupUnload = () => {
          if (debouncedSeekTimer) clearTimeout(debouncedSeekTimer);
          window.removeEventListener("beforeunload", handleUnload);
          window.removeEventListener("pagehide", handleUnload);
          window.removeEventListener("popstate", handlePopState);
          document.removeEventListener("click", handleLinkClick, { capture: true });
        };

        // Resize & Fullscreen sync for SubtitlesOctopus libass canvas
        art.on("resize", () => {
          if (octopusRef.current && typeof octopusRef.current.resize === "function") {
            try {
              octopusRef.current.resize();
            } catch {}
          }
        });
        art.on("fullscreen", () => {
          setTimeout(() => {
            if (octopusRef.current && typeof octopusRef.current.resize === "function") {
              try {
                octopusRef.current.resize();
              } catch {}
            }
          }, 150);
        });
        art.on("fullscreenWeb", () => {
          setTimeout(() => {
            if (octopusRef.current && typeof octopusRef.current.resize === "function") {
              try {
                octopusRef.current.resize();
              } catch {}
            }
          }, 150);
        });

        // Initial default subtitle
        const initialSubs: SubtitleItem[] = [];
        if (defaultVttUrl) {
          initialSubs.push({
            name: "기본 내장 자막",
            format: "VTT",
            is_ass: false,
            url: defaultVttUrl,
          });
        }
        setSubs(initialSubs);
        if (initialSubs.length > 0) {
          applySubtitle(initialSubs[0], 0.0);
        }
      } catch (err) {
        console.error("[Player initialization error]:", err);
      }
    }

    init();

    return () => {
      isMounted = false;
      stopPlayerImmediately();
      if (cleanupDoubleTap) {
        try {
          cleanupDoubleTap();
        } catch {}
      }
      if (cleanupUnload) {
        try {
          cleanupUnload();
        } catch {}
      }
      if (docPipWindowRef.current && !docPipWindowRef.current.closed) {
        try {
          docPipWindowRef.current.close();
        } catch {}
      }
      if (octopusRef.current) {
        try {
          octopusRef.current.dispose();
        } catch {}
        octopusRef.current = null;
      }
      updateNativeTrackElement("");
      hideAllNativeVideoTracks();
      if (currentBlobUrlRef.current) {
        try {
          URL.revokeObjectURL(currentBlobUrlRef.current);
        } catch {}
        currentBlobUrlRef.current = null;
      }
      if (artRef.current) {
        try {
          artRef.current.destroy(true);
        } catch {}
        artRef.current = null;
      }
    };
  }, [
    animeId,
    isDub,
    applySubtitle,
    toggleHybridPip,
    syncCuesToPipTrack,
    isNativePipActive,
    updateNativeTrackElement,
    hideAllNativeVideoTracks,
    stopPlayerImmediately,
  ]);

  // Asynchronous Subtitles Loading
  useEffect(() => {
    let isCancelled = false;
    setIsLoadingSubs(true);

    fetch(`/api/anime/subtitles?title=${encodeURIComponent(animeTitle)}&ep=${currentEp}&animeId=${encodeURIComponent(animeId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (isCancelled || !data.success) return;

        if (Array.isArray(data.creators)) {
          setCreators(data.creators);
        }

        const newSubs: SubtitleItem[] = [];
        if (currentVttUrl) {
          newSubs.push({
            name: "기본 내장",
            format: "VTT",
            is_ass: false,
            url: currentVttUrl,
          });
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fetchedList: SubtitleItem[] = (data.subtitles || []).map((s: any) => ({
          name: `${s.name} (${s.format})`,
          format: s.format,
          is_ass: s.is_ass,
          content: s.content,
        }));

        const combined = [...newSubs, ...fetchedList];
        setSubs(combined);

        const assIdx = combined.findIndex((s) => s.is_ass);
        const targetIdx = assIdx >= 0 ? assIdx : 0;
        if (combined.length > 0) {
          setSelectedSubIndex(targetIdx);
          if (applySubtitleRef.current) {
            applySubtitleRef.current(combined[targetIdx], currentSyncOffsetRef.current);
          }
          setTimeout(() => {
            if (refreshSubtitleSettingsRef.current) {
              refreshSubtitleSettingsRef.current(combined, targetIdx);
            }
          }, 150);
        }
      })
      .catch((e) => {
        console.error("[Fetch Subtitles error]:", e);
        if (!isCancelled && currentVttUrl) {
          const fallbackSubs: SubtitleItem[] = [
            {
              name: "기본 내장",
              format: "VTT",
              is_ass: false,
              url: currentVttUrl,
            },
          ];
          setSubs(fallbackSubs);
          setSelectedSubIndex(0);
          if (applySubtitleRef.current) {
            applySubtitleRef.current(fallbackSubs[0], currentSyncOffsetRef.current);
          }
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingSubs(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [animeTitle, currentEp, currentVttUrl]);

  // 4-Stage Audio Skip Trigger
  const triggerManualAudioSkip = async (isAuto = false) => {
    if (audioAnalysisStatus === "running") return;

    // 수동 클릭 시 설정에서 꺼져 있다면 브라우저 데이터 사용 동의 확인
    if (!isAuto && !playerSettings.autoAudioAnalysis) {
      const agreed = window.confirm(
        "오디오 AI 분석을 실행하시겠습니까?\n\n" +
        "• 앞 4분(OP)과 뒤 2.5분(ED) 음원 데이터(약 5~10MB) 및 기기 연산이 소모됩니다.\n" +
        "• 분석된 스킵 구간은 데이터베이스에 저장되어 다음 시청자에게 공유됩니다.\n\n" +
        "분석을 시작할까요?"
      );
      if (!agreed) return;
    }

    setAudioAnalysisStatus("running");
    setAudioAnalysisText("오디오 분석 준비 중...");
    if (artRef.current) {
      artRef.current.notice.show = "오디오 AI 분석을 시작합니다...";
    }

    try {
      const { runAudioSkipPipeline } = await import("@/lib/audioSkipEngine");
      const results = await runAudioSkipPipeline({
        animeId,
        episodeNumber: currentEpRef.current,
        currentM3u8Url: currentM3u8UrlRef.current || m3u8Url,
        compareEpisodeNumber: currentNextEpRef.current || (currentPreEpRef.current ? currentPreEpRef.current : undefined),
        onProgress: (p) => {
          setAudioAnalysisText(p.step);
          if (artRef.current && (p.progress === 45 || p.progress === 75 || p.progress === 100)) {
            artRef.current.notice.show = p.step;
          }
        },
      });

      if (results && results.length > 0) {
        const formatted: SkipInterval[] = results.map((r) => ({
          type: r.type,
          label: (r.label === "엔딩" ? "엔딩" : "오프닝") as "오프닝" | "엔딩",
          start: r.start,
          end: r.end,
        }));
        setSkipIntervals(formatted);
        applyTimelineHighlight(formatted);
        setAudioAnalysisStatus("success");
        const desc = getSkipLabelDesc(formatted);
        setAudioAnalysisText(desc ? `AI 분석 완료 (${desc})` : "AI 분석 완료");
        setSkipSource("audio_ai");
        if (artRef.current) {
          artRef.current.notice.show = `🎯 오디오 AI 분석 성공! (${desc || `${formatted.length}개 구간`})`;
        }
      } else {
        setAudioAnalysisStatus("none");
        setAudioAnalysisText("일치 구간 없음");
        if (artRef.current) {
          artRef.current.notice.show = "오디오 일치 구간(OP/ED)을 찾을 수 없습니다.";
        }
        setTimeout(() => {
          setAudioAnalysisStatus(skipIntervalsRef.current.length > 0 ? "success" : "idle");
          if (skipIntervalsRef.current.length === 0) {
            setAudioAnalysisText("오디오 AI 분석");
          }
        }, 3500);
      }
    } catch (err) {
      console.error("[Audio analysis error]:", err);
      setAudioAnalysisStatus("none");
      setAudioAnalysisText("분석 실패");
      if (artRef.current) {
        artRef.current.notice.show = "오디오 분석 중 오류가 발생했습니다.";
      }
      setTimeout(() => {
        setAudioAnalysisStatus(skipIntervalsRef.current.length > 0 ? "success" : "idle");
        if (skipIntervalsRef.current.length === 0) {
          setAudioAnalysisText("오디오 AI 분석");
        }
      }, 3500);
    }
  };

  // Fetch Skip intervals with 4-stage pipeline (DB -> Chroma Template -> AniSkip)
  useEffect(() => {
    let isCancelled = false;

    // Reset previous episode skip data immediately
    setSkipIntervals([]);
    applyTimelineHighlight([]);
    setSkipSource("");

    const query = new URLSearchParams({
      title: animeTitle,
      ep: String(currentEp),
    });
    if (animePoster) query.set("poster", animePoster);

    fetch(`/api/anime/skip?${query.toString()}`)
      .then((r) => r.json())
      .then(async (data) => {
        if (isCancelled || !data.success) return;

        console.log("[SkipAPI] Response:", data);

        // 1. 이미 DB나 AniSkip에 스킵 구간이 있는 경우
        if (data.found && Array.isArray(data.intervals) && data.intervals.length > 0) {
          console.log("[SkipAPI] Applying intervals:", data.intervals);
          setSkipIntervals(data.intervals);
          applyTimelineHighlight(data.intervals);
          setSkipSource(data.source || "db");
          setAudioAnalysisStatus("success");
          const opCount = data.intervals.filter((i: any) => i.type === "op" || i.label === "오프닝").length;
          const edCount = data.intervals.filter((i: any) => i.type === "ed" || i.label === "엔딩").length;
          const desc = [opCount > 0 ? "OP" : "", edCount > 0 ? "ED" : ""].filter(Boolean).join("/");
          setAudioAnalysisText(desc ? `스킵 감지 (${desc})` : "스킵 감지 완료");
          if (artRef.current) {
            artRef.current.notice.show = `🎯 스킵 구간 로드 (${desc || `${data.intervals.length}개 구간`})`;
          }
          return;
        }

        // 2. 스킵은 없지만 등록된 크로마 지문(anime_themes)이 있는 경우: 설정에서 켜진 경우에만 1:1 템플릿 매칭 시도
        if (playerSettings.autoAudioAnalysis && data.hasThemes && Array.isArray(data.themes) && data.themes.length > 0) {
          try {
            setAudioAnalysisText("크로마 지문 매칭 중...");
            const { runAudioSkipPipeline } = await import("@/lib/audioSkipEngine");
            if (isCancelled) return;
            const matched = await runAudioSkipPipeline({
              animeId,
              episodeNumber: currentEp,
              currentM3u8Url,
            });
            if (isCancelled) return;
            if (matched && matched.length > 0) {
              const formatted: SkipInterval[] = matched.map((r) => ({
                type: r.type,
                label: (r.label === "엔딩" ? "엔딩" : "오프닝") as "오프닝" | "엔딩",
                start: r.start,
                end: r.end,
              }));
              setSkipIntervals(formatted);
              applyTimelineHighlight(formatted);
              setSkipSource("chroma");
              setAudioAnalysisStatus("success");
              const desc = getSkipLabelDesc(formatted);
              setAudioAnalysisText(desc ? `AI 분석 완료 (${desc})` : "AI 분석 완료");
              return;
            }
          } catch (e) {
            console.warn("[Background chroma match error]:", e);
          }
        }

        // 3. 스킵 데이터가 없는 경우
        if (!isCancelled) {
          setAudioAnalysisStatus("idle");
          setAudioAnalysisText("오디오 AI 분석");
          if (playerSettings.autoAudioAnalysis) {
            setTimeout(() => {
              if (!isCancelled) triggerManualAudioSkip(true);
            }, 1000);
          }
        }
      })
      .catch((e) => console.error("[Fetch Skip error]:", e));

    return () => {
      isCancelled = true;
    };
  }, [animeTitle, animeId, currentEp, animePoster, currentM3u8Url, applyTimelineHighlight, playerSettings.autoAudioAnalysis]);

  // Video timeupdate watcher for Auto-Skip & Floating Button
  useEffect(() => {
    if (!artRef.current) return;
    const art = artRef.current;

    let lastAutoSkipped = 0;

    const onTimeUpdate = () => {
      const cur = art.currentTime;

      // Skip interval check
      let matched: SkipInterval | null = null;
      for (const interval of skipIntervals) {
        if (cur >= interval.start && cur < interval.end - 0.5) {
          matched = interval;
          break;
        }
      }

      if (matched) {
        if (autoSkipEnabled) {
          if (Math.abs(lastAutoSkipped - matched.end) > 2) {
            lastAutoSkipped = matched.end;
            art.seek = matched.end + 0.1;
            art.notice.show = `⚡ ${matched.label} 자동 스킵 완료!`;
            setFloatingSkip({ show: false, label: "", targetTime: 0 });
          }
        } else {
          setFloatingSkip({
            show: true,
            label: `${matched.label} 스킵`,
            targetTime: matched.end + 0.1,
            isManual: false,
          });
        }
        return;
      }

      // 스킵 구간이 아니면 플로팅 버튼 숨김
      setFloatingSkip((prev) => (prev.show ? { ...prev, show: false } : prev));
    };

    art.on("video:timeupdate", onTimeUpdate);

    return () => {
      try {
        art.off("video:timeupdate", onTimeUpdate);
      } catch {}
    };
  }, [skipIntervals, autoSkipEnabled]);

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* Breadcrumb Header (실시간 회차 번호 동기화) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/anime/${animeId}`}
            onClick={() => setNavigatingTarget("anime")}
            className={`flex items-center gap-1.5 font-bold transition ${
              navigatingTarget === "anime"
                ? "text-purple-400 pointer-events-none cursor-wait"
                : "text-slate-300 hover:text-purple-400"
            }`}
          >
            {navigatingTarget === "anime" ? (
              <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
            ) : (
              <ArrowLeft className="h-4 w-4" />
            )}
            {animeTitle}
          </Link>
          <span className="text-slate-600">/</span>
          <span className="font-extrabold text-purple-300">
            {currentEpTitle} {isDub && "(더빙)"}
          </span>
        </div>
      </div>

      {/* Player Wrapper */}
      <div className="artplayer-wrapper rounded-2xl relative">
        <div ref={containerRef} className="w-full h-full" />

        {/* Floating AniSkip / Manual Skip Button */}
        {floatingSkip.show && playerSettings.floatingSkipBtn && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (artRef.current) {
                artRef.current.seek = Math.min(
                  artRef.current.duration || 99999,
                  floatingSkip.targetTime
                );
                artRef.current.notice.show = `⏩ ${floatingSkip.label} 완료!`;
              }
              setFloatingSkip({ show: false, label: "", targetTime: 0 });
            }}
            className="absolute bottom-16 right-5 z-30 flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 px-4 py-2.5 text-xs sm:text-sm font-extrabold text-white shadow-2xl shadow-purple-900/60 border border-purple-300/40 backdrop-blur-md animate-pulse transition hover:scale-105 active:scale-95 cursor-pointer"
          >
            <Sparkles className="h-4 w-4 fill-white" />
            <span>{floatingSkip.label}</span>
          </button>
        )}
      </div>

      {/* Episode Navigation & Controls */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-purple-500/20 bg-slate-900/80 p-4 backdrop-blur-md">
        {/* Navigation Buttons */}
        <div className="flex items-center gap-2">
          {currentPreEp ? (
            <button
              type="button"
              disabled={Boolean(isSwitchingEp)}
              onClick={() => switchEpisode(currentPreEp)}
              className={`flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                isSwitchingEp === currentPreEp
                  ? "bg-purple-900/50 text-purple-200 border border-purple-500/50 pointer-events-none cursor-wait"
                  : "bg-slate-800 text-slate-200 hover:bg-purple-600 hover:text-white cursor-pointer"
              } ${isSwitchingEp && isSwitchingEp !== currentPreEp ? "opacity-60 pointer-events-none" : ""}`}
            >
              {isSwitchingEp === currentPreEp ? (
                <Loader2 className="h-4 w-4 animate-spin text-purple-300" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
              {isSwitchingEp === currentPreEp ? `로딩 중... (${currentPreEp}화)` : `이전 화 (${currentPreEp}화)`}
            </button>
          ) : (
            <span className="rounded-xl bg-slate-950 px-3 py-2 text-xs text-slate-600 cursor-not-allowed">
              첫 번째 화
            </span>
          )}

          <Link
            href={`/anime/${animeId}`}
            onClick={() => setNavigatingTarget("list")}
            className={`flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold transition ${
              navigatingTarget === "list"
                ? "bg-purple-900/50 text-purple-200 border border-purple-500/50 pointer-events-none cursor-wait"
                : "bg-slate-800 text-slate-200 hover:bg-slate-700"
            }`}
          >
            {navigatingTarget === "list" ? (
              <Loader2 className="h-4 w-4 animate-spin text-purple-300" />
            ) : (
              <List className="h-4 w-4" />
            )}
            {navigatingTarget === "list" ? "이동 중..." : "회차 목록"}
          </Link>

          {currentNextEp ? (
            <button
              type="button"
              disabled={Boolean(isSwitchingEp)}
              onClick={() => switchEpisode(currentNextEp)}
              className={`flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-bold text-white shadow-lg transition ${
                isSwitchingEp === currentNextEp
                  ? "bg-purple-800 pointer-events-none cursor-wait shadow-purple-950/60"
                  : "bg-purple-600 shadow-purple-600/30 hover:bg-purple-500 cursor-pointer"
              } ${isSwitchingEp && isSwitchingEp !== currentNextEp ? "opacity-60 pointer-events-none" : ""}`}
            >
              {isSwitchingEp === currentNextEp ? (
                <Loader2 className="h-4 w-4 animate-spin text-white" />
              ) : null}
              <span>{isSwitchingEp === currentNextEp ? `로딩 중... (${currentNextEp}화)` : `다음 화 (${currentNextEp}화)`}</span>
              {isSwitchingEp !== currentNextEp && <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="rounded-xl bg-slate-950 px-3 py-2 text-xs text-slate-600 cursor-not-allowed">
              마지막 화
            </span>
          )}
        </div>

        {/* 3 Controls matching Flask: 1) OP/ED 자동 스킵, 2) 오디오 분석, 3) 다음 화 자동재생 */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {/* 1) OP/ED 자동 스킵 토글 */}
          <label
            htmlFor="autoSkipToggle"
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-semibold transition border cursor-pointer select-none ${
              autoSkipEnabled
                ? "bg-purple-600/20 text-purple-200 border-purple-500/50 shadow-sm"
                : "bg-slate-800/80 text-slate-400 border-slate-700"
            }`}
          >
            <input
              type="checkbox"
              id="autoSkipToggle"
              checked={autoSkipEnabled}
              onChange={toggleAutoSkip}
              className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-purple-600 accent-purple-600 cursor-pointer"
            />
            <span>OP/ED 자동 스킵</span>
          </label>

          {/* 2) 스킵 분석 상태 보고 뱃지 및 수동 분석/재분석 버튼 */}
          {audioAnalysisStatus === "running" ? (
            /* 2-1) 분석 진행 중: 실시간 단계 안내 뱃지 */
            <div
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-bold border border-purple-500/50 bg-purple-900/30 text-purple-300 animate-pulse cursor-wait select-none"
              title="오디오 AI 분석이 진행 중입니다"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400" />
              <span>{audioAnalysisText}</span>
            </div>
          ) : audioAnalysisStatus === "success" ? (
            /* 2-2) 스킵 감지 완료: 선택/클릭되지 않는 상태 보고용 뱃지 */
            <div className="inline-flex items-center gap-1.5">
              <div
                className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-bold border border-purple-500/40 bg-purple-600/20 text-purple-200 select-none cursor-default"
                title={
                  skipIntervals.length > 0
                    ? skipIntervals
                        .map((i) => `${i.label}: ${formatTimeStr(i.start)} ~ ${formatTimeStr(i.end)}`)
                        .join(" | ")
                    : "스킵 구간이 감지되어 적용되었습니다"
                }
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-purple-400" />
                <span>
                  {(() => {
                    const desc = getSkipLabelDesc(skipIntervals);
                    const descSuffix = desc ? ` (${desc})` : "";
                    if (skipSource === "audio_ai" || skipSource === "chroma") {
                      return `AI 분석 완료${descSuffix}`;
                    }
                    if (skipSource === "aniskip") {
                      return `스킵 감지${descSuffix} · AniSkip`;
                    }
                    if (skipSource === "db") {
                      return `스킵 감지${descSuffix} · DB`;
                    }
                    return descSuffix ? `스킵 감지${descSuffix}` : audioAnalysisText;
                  })()}
                </span>
              </div>

              {/* AniSkip 데이터인 경우 싱크 불일치 대비 수동 재분석 버튼 */}
              {skipSource === "aniskip" && (
                <button
                  type="button"
                  onClick={() => triggerManualAudioSkip(false)}
                  title="AniSkip 타임스탬프가 맞지 않을 경우 오디오를 직접 AI 분석하여 재검출합니다"
                  className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-xs font-semibold border border-purple-500/30 bg-slate-800/90 text-purple-300 hover:bg-purple-900/40 hover:text-white transition cursor-pointer"
                >
                  <RotateCw className="h-3 w-3 text-purple-400" />
                  <span>AI 재분석</span>
                </button>
              )}
            </div>
          ) : (
            /* 2-3) 스킵 데이터 없음 (idle 또는 none): 수동 오디오 분석 버튼 */
            <button
              type="button"
              id="manualAudioSkipBtn"
              onClick={() => triggerManualAudioSkip(false)}
              title="영상 오디오를 직접 AI 분석하여 오프닝/엔딩 구간을 감지합니다"
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-bold transition border border-purple-500/40 bg-purple-500/10 text-purple-300 hover:bg-purple-600/20 cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 text-purple-400" />
              <span>{audioAnalysisText}</span>
            </button>
          )}

          {/* 3) 다음 화 자동재생 토글 */}
          <label
            htmlFor="autoNextToggle"
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 font-semibold transition border cursor-pointer select-none ${
              autoNextEnabled
                ? "bg-indigo-600/20 text-indigo-200 border-indigo-500/50 shadow-sm"
                : "bg-slate-800/80 text-slate-400 border-slate-700"
            }`}
          >
            <input
              type="checkbox"
              id="autoNextToggle"
              checked={autoNextEnabled}
              onChange={toggleAutoNext}
              className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 text-indigo-600 accent-indigo-600 cursor-pointer"
            />
            <span>다음 화 자동재생</span>
          </label>

          {/* 4) ⚙️ 플레이어 환경설정 버튼 */}
          <button
            type="button"
            onClick={() => setIsSettingsModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-600/20 px-3 py-1.5 font-bold text-purple-200 transition hover:bg-purple-600 hover:text-white cursor-pointer shadow-sm"
            title="플레이어 환경설정 (세부 기능 ON/OFF)"
          >
            <Settings className="h-3.5 w-3.5 text-purple-400" />
            <span>설정</span>
          </button>
        </div>
      </div>

      {/* Episode Navigator Toolbar (Flask-style in-player ep selector) */}
      {currentEpisodes.length > 0 && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-[#10182c]/80 p-4 backdrop-blur-md shadow-lg">
          {/* Header Row: Sub/Dub Switch & Ep Quick Jump */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
            <div className="flex items-center gap-3">
              {/* 자막 / 더빙 세그먼트 전환 스위치 (더빙판 제공 시) */}
              {dubEpisodes && dubEpisodes.length > 0 && (
                <div className="inline-flex items-center rounded-full bg-slate-950/80 p-1 border border-white/10 text-xs">
                  {(() => {
                    const targetSubEp = subEpisodes?.some((e) => e.number === currentEp)
                      ? currentEp
                      : subEpisodes?.[0]?.number || 1;
                    const targetDubEp = dubEpisodes.some((e) => e.number === currentEp)
                      ? currentEp
                      : dubEpisodes[0]?.number || 1;
                    return (
                      <>
                        <Link
                          href={`/watch/${animeId}/${targetSubEp}`}
                          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold transition ${
                            !isDub
                              ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-sm"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          <Film className="h-3.5 w-3.5" />
                          자막판 ({subEpisodes?.length || 0})
                        </Link>
                        <Link
                          href={`/watch/${animeId}/${targetDubEp}?dub=1`}
                          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-semibold transition ${
                            isDub
                              ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-sm"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          <Mic className="h-3.5 w-3.5" />
                          더빙판 ({dubEpisodes.length})
                        </Link>
                      </>
                    );
                  })()}
                </div>
              )}

              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                <List className="h-3.5 w-3.5 text-purple-400" />
                회차 선택
              </span>
            </div>

            {/* 빠른 회차 점프 입력창 */}
            <form onSubmit={handleJump} className="relative flex items-center gap-1">
              <div className="relative">
                <input
                  type="number"
                  min="1"
                  value={jumpInput}
                  onChange={(e) => setJumpInput(e.target.value)}
                  placeholder="회차 이동"
                  className="w-24 sm:w-28 rounded-xl bg-slate-950/90 px-2.5 py-1 text-xs text-white placeholder-slate-500 border border-white/10 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
              </div>
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-xl bg-purple-600 px-2.5 py-1 text-xs font-semibold text-white shadow hover:bg-purple-500 transition"
              >
                <Search className="h-3 w-3" /> 이동
              </button>
              {jumpError && (
                <span className="absolute right-0 top-8 whitespace-nowrap rounded-lg bg-red-950/90 px-2.5 py-1 text-[11px] font-semibold text-red-300 border border-red-500/40 z-20 shadow-lg">
                  {jumpError}
                </span>
              )}
            </form>
          </div>

          {/* 50화 단위 구간 선택 탭 (50화 초과 시 자동 표시) */}
          {chunkCount > 1 && (
            <div className="flex gap-2 overflow-x-auto py-2.5 scrollbar-thin scrollbar-thumb-purple-500/30">
              {Array.from({ length: chunkCount }).map((_, idx) => {
                const startNum = idx * CHUNK_SIZE + 1;
                const endNum = Math.min((idx + 1) * CHUNK_SIZE, currentEpisodes.length);
                const isActive = selectedChunk === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedChunk(idx)}
                    className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                      isActive
                        ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-500/30 font-bold"
                        : "bg-white/5 border border-white/10 text-slate-400 hover:bg-purple-600/20 hover:text-white"
                    }`}
                  >
                    <span>{startNum} - {endNum}화</span>
                    {currentEpisodes.slice(idx * CHUNK_SIZE, (idx + 1) * CHUNK_SIZE).some((e) => {
                      const h = epHistoryMap[e.number];
                      return h && (h.is_completed || h.watch_time > 10);
                    }) && (
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* 회차 알약 가로 스크롤 (ep-pill) with 시청 진행도/완주 표시 */}
          <div
            ref={scrollContainerRef}
            className="mt-2 flex gap-2 overflow-x-auto py-1.5 scrollbar-thin scrollbar-thumb-purple-500/30"
          >
            {displayedEpisodes.map((ep) => {
              const isActive = ep.number === currentEp;
              const watched = epHistoryMap[ep.number];
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

              const hasProgress = watched && (isCompleted || pct > 0);

              return (
                <button
                  type="button"
                  key={ep.number}
                  ref={isActive ? activePillRef : null}
                  disabled={Boolean(isSwitchingEp)}
                  onClick={() => switchEpisode(ep.number)}
                  className={`group relative flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition overflow-hidden ${
                    isSwitchingEp === ep.number
                      ? "bg-purple-900/60 border border-purple-400 text-purple-200 pointer-events-none cursor-wait ring-1 ring-purple-400"
                      : isSwitchingEp
                      ? "opacity-50 pointer-events-none"
                      : isActive
                      ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-500/30 ring-1 ring-purple-400 scale-105 font-bold cursor-pointer"
                      : isCompleted
                      ? "bg-emerald-950/40 border border-emerald-500/40 text-emerald-200 hover:bg-emerald-900/50 hover:border-emerald-400 cursor-pointer"
                      : hasProgress
                      ? "bg-purple-950/40 border border-purple-500/30 text-purple-200 hover:bg-purple-900/50 cursor-pointer"
                      : "bg-white/5 border border-white/10 text-slate-300 hover:bg-white/15 hover:text-white cursor-pointer"
                  }`}
                >
                  {isSwitchingEp === ep.number ? (
                    <Loader2 className="h-3 w-3 animate-spin text-purple-300 shrink-0" />
                  ) : null}
                  <span>{ep.title}</span>

                  {/* 회차 진행도 뱃지/아이콘 */}
                  {isSwitchingEp === ep.number ? null : isActive ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
                  ) : isCompleted ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                  ) : pct > 0 ? (
                    <span className="rounded bg-purple-500/30 px-1 py-0.5 text-[9px] font-bold text-purple-200 border border-purple-400/30">
                      {pct}%
                    </span>
                  ) : null}

                  {/* 하단 미니 진행도 프로그레스 바 */}
                  {!isActive && hasProgress && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-950/80">
                      <div
                        className={`h-full ${
                          isCompleted ? "bg-emerald-400" : "bg-purple-400"
                        }`}
                        style={{ width: `${isCompleted ? 100 : Math.max(8, pct)}%` }}
                      />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Subtitles Selection Bar */}
      <div className="mt-4 rounded-2xl border border-purple-500/20 bg-slate-900/60 p-4 backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-purple-500/10">
          <div className="flex items-center gap-2 text-sm font-bold text-white">
            <MessageSquare className="h-4 w-4 text-purple-400" />
            <span>선택 가능한 자막 목록</span>
            {isLoadingSubs && (
              <span className="text-xs font-normal text-purple-300 animate-pulse">
                (외부 자막 실시간 검색 중...)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 mr-1">총 {subs.length}개 발견</span>
            {playerSettings.localSubBtn && (
              <>
                <input
                  type="file"
                  ref={localFileInputRef}
                  accept=".ass,.ssa,.smi,.srt,.vtt"
                  onChange={handleLocalSubFile}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => localFileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/10 px-3 py-1.5 text-xs font-bold text-purple-300 transition hover:bg-purple-600 hover:text-white cursor-pointer"
                  title="내 PC에서 로컬 자막 파일(.ass, .smi, .srt, .vtt) 직접 열기"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  <span>자막 파일 열기</span>
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {subs.map((sub, idx) => (
            <button
              key={idx}
              onClick={() => {
                setSelectedSubIndex(idx);
                applySubtitle(sub, currentSyncOffset);
                refreshSubtitleSettings(subs, idx);
              }}
              className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                selectedSubIndex === idx
                  ? "bg-purple-600 text-white shadow-md shadow-purple-600/30 ring-2 ring-purple-400"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              <span>{sub.name}</span>
              {sub.is_ass && (
                <span className="rounded bg-purple-950 px-1 py-0.5 text-[10px] font-bold text-purple-300 border border-purple-400/40">
                  ASS 효과
                </span>
              )}
            </button>
          ))}

          {subs.length === 0 && !isLoadingSubs && (
            <span className="text-xs text-slate-500 py-1">자막이 제공되지 않는 회차입니다.</span>
          )}
        </div>
      </div>

      {/* Anissia Subtitle Creators Status */}
      {playerSettings.anissiaCard && (creators.length > 0 || isLoadingSubs) && (
        <div className="mt-4 rounded-2xl border border-purple-500/20 bg-slate-900/60 p-4 backdrop-blur-md">
          <div className="flex items-center justify-between pb-3 border-b border-purple-500/10">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Users className="h-4 w-4 text-purple-400" />
              <span>애니시아 등록 제작자 현황</span>
              {isLoadingSubs && (
                <span className="text-xs font-normal text-purple-300 animate-pulse">
                  (조회 중...)
                </span>
              )}
            </div>
            <span className="text-xs text-slate-400">제작자 {creators.length}명</span>
          </div>

          <div className="mt-3 space-y-2">
            {creators.map((c, idx) => {
              const matchedSub = subs.find(
                (s) =>
                  s.name.includes(c.name) ||
                  (c.name.includes("카이란") && s.name.includes("카이란"))
              );
              const isCurrentlyActive =
                selectedSubIndex >= 0 &&
                subs[selectedSubIndex] &&
                (subs[selectedSubIndex].name.includes(c.name) ||
                  (c.name.includes("카이란") && subs[selectedSubIndex].name.includes("카이란")) ||
                  (matchedSub && subs[selectedSubIndex].name === matchedSub.name));
              const isAss =
                (matchedSub && matchedSub.is_ass) ||
                c.name.includes("카이란") ||
                c.name.includes("슈퍼소닉");
              const isErusha = Boolean(
                c.name.includes("에루샤") || (c.website && c.website.includes("erulabo.com"))
              );
              const isLoading = loadingCreatorName === c.name;

              return (
                <div
                  key={idx}
                  className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 transition ${
                    isErusha
                      ? "border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50"
                      : "border-white/5 bg-slate-950/60 hover:border-purple-500/30"
                  }`}
                >
                  <div className="flex flex-col gap-0.5 max-w-full sm:max-w-[65%]">
                    <div className="flex items-center gap-1.5">
                      {isAss ? (
                        <Wand2 className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                      ) : isErusha ? (
                        <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                      ) : (
                        <UserPen className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                      )}
                      <span className="font-bold text-sm text-white">{c.name}</span>
                      {isAss && (
                        <span className="rounded bg-purple-950/80 px-1.5 py-0.5 text-[10px] font-bold text-purple-300 border border-purple-500/40">
                          ASS
                        </span>
                      )}
                      {isErusha && (
                        <span className="rounded bg-amber-950/80 px-1.5 py-0.5 text-[10px] font-bold text-amber-300 border border-amber-500/40">
                          보안 캡차
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">
                      {isErusha ? (
                        <span className="text-amber-400/90 flex items-center gap-1 font-medium">
                          <AlertCircle className="h-3 w-3 shrink-0" />
                          Cloudflare 보안 캡차 보호 사이트 (자동 추출 불가 · 직접 방문 다운로드 필요)
                        </span>
                      ) : matchedSub ? (
                        <span className="text-emerald-400 flex items-center gap-1 font-medium">
                          <CheckCircle2 className="h-3 w-3" />
                          현재 {currentEp}화 자막 매칭 완료
                        </span>
                      ) : c.is_current_ep ? (
                        <span className="text-purple-300 flex items-center gap-1 font-medium">
                          <CheckCircle2 className="h-3 w-3 text-purple-400" />
                          현재 {currentEp}화 자막 제공
                        </span>
                      ) : (
                        <span>
                          블로그 등록 회차: {c.episode || "-"}화 {c.update_date ? `(${c.update_date})` : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {matchedSub ? (
                      isCurrentlyActive ? (
                        matchedSub.is_ass ? (
                          <button
                            disabled
                            type="button"
                            className="inline-flex items-center gap-1 rounded-xl bg-emerald-600/20 border border-emerald-500/50 px-3 py-1.5 text-xs font-bold text-emerald-300 cursor-default"
                            title="현재 화면에 적용 중인 ASS 자막입니다"
                          >
                            <Check className="h-3.5 w-3.5" />
                            <span>적용 중</span>
                          </button>
                        ) : (
                          <button
                            disabled
                            type="button"
                            className="inline-flex items-center gap-1 rounded-xl bg-slate-800/90 border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 cursor-default"
                            title="현재 화면에 적용 중인 자막과 동일합니다"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 text-slate-400" />
                            <span>동일 자막</span>
                          </button>
                        )
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const foundIdx = subs.findIndex((s) => s.name === matchedSub.name);
                            if (foundIdx !== -1) {
                              setSelectedSubIndex(foundIdx);
                              applySubtitle(matchedSub, currentSyncOffset);
                              refreshSubtitleSettings(subs, foundIdx);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-xl border border-purple-500/40 bg-slate-800 px-3 py-1.5 text-xs font-bold text-purple-200 transition hover:bg-purple-600 hover:text-white cursor-pointer"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>자막 적용</span>
                        </button>
                      )
                    ) : isErusha ? (
                      c.website && (
                        <a
                          href={c.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/50 bg-amber-600/20 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-600 hover:text-white transition shadow-sm"
                          title="Cloudflare 캡차가 적용되어 있어 블로그에서 직접 다운로드해야 합니다"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>블로그에서 직접 받기</span>
                        </a>
                      )
                    ) : (
                      c.website && (
                        <button
                          type="button"
                          disabled={isLoading}
                          onClick={() => handleLoadCreatorSub(c)}
                          className={`inline-flex items-center gap-1 rounded-xl border border-purple-500/50 px-3 py-1.5 text-xs font-bold transition ${
                            isLoading
                              ? "bg-slate-800 text-slate-400 cursor-wait"
                              : "bg-purple-600/20 text-purple-200 hover:bg-purple-600 hover:text-white cursor-pointer"
                          }`}
                        >
                          {isLoading ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400" />
                              <span>추출 중...</span>
                            </>
                          ) : (
                            <>
                              <Download className="h-3.5 w-3.5" />
                              <span>자막 등록</span>
                            </>
                          )}
                        </button>
                      )
                    )}

                    {!isErusha && c.website && (
                      <a
                        href={c.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-xl border border-white/10 bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition"
                        title="제작자 블로그 방문"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}

            {creators.length === 0 && !isLoadingSubs && (
              <div className="text-slate-500 text-xs py-2 px-1">
                등록된 제작자 정보가 없습니다.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Player Settings Modal */}
      <PlayerSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={playerSettings}
        onUpdateSettings={handleUpdateSettings}
      />
    </div>
  );
}

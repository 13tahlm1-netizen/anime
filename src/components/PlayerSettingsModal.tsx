"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  X,
  RotateCcw,
  Sliders,
  Sparkles,
  Maximize2,
  Tv,
  PictureInPicture,
  Zap,
  FastForward,
  Keyboard,
  FolderOpen,
  Users,
  Settings,
  ArrowRight,
  Cloud,
  Touchpad,
  MoveVertical,
} from "lucide-react";

export interface PlayerSettings {
  // ⏩ 재생 & 스킵 자동화
  autoSkip: boolean;            // OP/ED 자동 건너뛰기 (기본 ON)
  floatingSkipBtn: boolean;     // 스킵 플로팅 버튼 표시 (기본 ON)
  autoNext: boolean;            // 다음 화 자동 재생 (기본 ON)
  autoAudioAnalysis: boolean;   // 백그라운드 오디오 분석 자동 시도 (기본 OFF)

  // 🎛️ 플레이어 UI & 컨트롤러
  fullscreenBtn: boolean;       // 전체화면 버튼
  fullscreenWebBtn: boolean;    // 웹 전체화면 버튼
  pipBtn: boolean;              // PIP 모드 버튼 (기본 ON)
  speed2xBtn: boolean;          // 배속 순환 캡슐 버튼
  skip85sBtn: boolean;          // +85초 즉시 점프 버튼
  miniProgressBar: boolean;     // 미니 진행바
  hotkey: boolean;              // 키보드 단축키
  doubleTouchSeek: boolean;     // 화면 더블 탭 스킵 (기본 ON)
  doubleTouchDuration: number;  // 더블 탭 스킵 시간 (5초 / 10초)
  mobileGesture: boolean;       // 모바일 화면 스와이프 탐색

  // 💬 자막 & 외부 데이터
  subtitleBottom: number;       // 일반 자막 최저 하단 여백 (15 / 25 / 35 px)
  localSubBtn: boolean;         // 로컬 자막 파일 열기 버튼 표시
  anissiaCard: boolean;         // 애니시아 등록 제작자 현황 카드 표시
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  // ⏩ 재생 & 스킵 자동화
  autoSkip: true,
  floatingSkipBtn: true,
  autoNext: true,
  autoAudioAnalysis: false,

  // 🎛️ 플레이어 UI & 컨트롤러
  fullscreenBtn: true,
  fullscreenWebBtn: false,
  pipBtn: true, // ⭐ 기본값 ON
  speed2xBtn: true,
  skip85sBtn: false,
  miniProgressBar: true,
  hotkey: true,
  doubleTouchSeek: true,
  doubleTouchDuration: 10,
  mobileGesture: false, // ⭐ 기본 OFF

  // 💬 자막 & 외부 데이터
  subtitleBottom: 15,
  localSubBtn: true,
  anissiaCard: true,
};

const SETTINGS_KEY = "anime_player_settings";

let saveDbTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 계정 DB에 사용자 플레이어 환경설정 비동기 저장
 */
export async function saveUserSettingsToDb(settings: PlayerSettings): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const res = await fetch("/api/settings/player", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings }),
    });
    return res.ok;
  } catch (e) {
    console.error("[saveUserSettingsToDb error]:", e);
    return false;
  }
}

/**
 * 계정 DB에서 사용자 플레이어 환경설정 불러오기
 */
export async function fetchUserSettingsFromDb(): Promise<{
  settings: PlayerSettings | null;
  authenticated: boolean;
  userId?: string;
}> {
  if (typeof window === "undefined") return { settings: null, authenticated: false };
  try {
    const res = await fetch("/api/settings/player");
    if (!res.ok) return { settings: null, authenticated: false };
    const data = await res.json();
    return {
      settings: data.settings || null,
      authenticated: Boolean(data.authenticated),
      userId: data.userId,
    };
  } catch {
    return { settings: null, authenticated: false };
  }
}

export function loadPlayerSettings(): PlayerSettings {
  if (typeof window === "undefined") return DEFAULT_PLAYER_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      // 레거시 키 호환
      const savedAutoSkip = localStorage.getItem("anime_auto_skip");
      const savedAutoNext = localStorage.getItem("anime_auto_next");
      return {
        ...DEFAULT_PLAYER_SETTINGS,
        autoSkip: savedAutoSkip !== null ? savedAutoSkip === "1" : DEFAULT_PLAYER_SETTINGS.autoSkip,
        autoNext: savedAutoNext !== null ? savedAutoNext === "1" : DEFAULT_PLAYER_SETTINGS.autoNext,
        pipBtn: true,
      };
    }
    const parsed = JSON.parse(raw);

    // 이전에 pipBtn이 false(구 기본값)로 캐싱되어 있던 브라우저를 위해 1회 기본값 ON 마이그레이션
    const hasPipMigrated = localStorage.getItem("anime_pip_migrated_v1") === "1";
    let pipBtnVal = parsed.pipBtn !== undefined ? Boolean(parsed.pipBtn) : DEFAULT_PLAYER_SETTINGS.pipBtn;
    if (!hasPipMigrated) {
      pipBtnVal = true;
      try {
        localStorage.setItem("anime_pip_migrated_v1", "1");
      } catch {}
    }

    const subBottomVal = [15, 25, 35].includes(Number(parsed.subtitleBottom))
      ? Number(parsed.subtitleBottom)
      : DEFAULT_PLAYER_SETTINGS.subtitleBottom;

    return {
      ...DEFAULT_PLAYER_SETTINGS,
      ...parsed,
      pipBtn: pipBtnVal,
      doubleTouchSeek: parsed.doubleTouchSeek !== undefined ? !!parsed.doubleTouchSeek : true,
      doubleTouchDuration: parsed.doubleTouchDuration === 5 ? 5 : 10,
      mobileGesture: parsed.mobileGesture !== undefined ? !!parsed.mobileGesture : false,
      subtitleBottom: subBottomVal,
    };
  } catch {
    return DEFAULT_PLAYER_SETTINGS;
  }
}

export function savePlayerSettings(settings: PlayerSettings) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    localStorage.setItem("anime_auto_skip", settings.autoSkip ? "1" : "0");
    localStorage.setItem("anime_auto_next", settings.autoNext ? "1" : "0");
    localStorage.setItem("anime_pip_migrated_v1", "1");
  } catch {}

  // 계정 DB에 디바운스 비동기 동기화 (200ms)
  if (saveDbTimer) clearTimeout(saveDbTimer);
  saveDbTimer = setTimeout(() => {
    saveUserSettingsToDb(settings).catch(() => {});
  }, 200);
}

export function applyPlayerSettingsStyles(settings: PlayerSettings) {
  if (typeof document === "undefined") return;
  let styleEl = document.getElementById("player-custom-settings-style");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "player-custom-settings-style";
    document.head.appendChild(styleEl);
  }

  const subBottom = [15, 25, 35].includes(Number(settings?.subtitleBottom))
    ? Number(settings.subtitleBottom)
    : 15;

  styleEl.innerHTML = `
    .art-video-player,
    .art-video-player .art-subtitle {
      --art-subtitle-bottom: ${subBottom}px !important;
    }
    ${!settings.fullscreenBtn ? ".art-video-player .art-control-fullscreen { display: none !important; }" : ""}
    ${!settings.fullscreenWebBtn ? ".art-video-player .art-control-fullscreenWeb { display: none !important; }" : ""}
    ${!settings.pipBtn ? ".art-video-player .art-control-pip, .art-video-player .art-control-hybrid-pip { display: none !important; }" : ""}
    ${!settings.speed2xBtn ? ".art-video-player .art-control-speed2x { display: none !important; }" : ""}
    ${!settings.skip85sBtn ? ".art-video-player .art-control-skip85s { display: none !important; }" : ""}
    ${!settings.miniProgressBar ? ".art-video-player .art-mini-progress-bar { display: none !important; }" : ""}
  `;

  // Document PiP 윈도우가 활성이면 변경 사항을 전달 (Player 컴포넌트가 수신해 PIP 문서로 동기화)
  try {
    window.dispatchEvent(new CustomEvent("anime-player-styles-updated"));
  } catch {}
}

interface PlayerSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: PlayerSettings;
  onUpdateSettings: (newSettings: PlayerSettings) => void;
}

export default function PlayerSettingsModal({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
}: PlayerSettingsModalProps) {
  const [mounted, setMounted] = useState(false);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [showConsentModal, setShowConsentModal] = useState(false);

  useEffect(() => {
    setMounted(true);
    const updateTarget = () => {
      const fsEl = (document.fullscreenElement as HTMLElement) || null;
      setPortalTarget(fsEl || document.body);
    };
    updateTarget();
    document.addEventListener("fullscreenchange", updateTarget);
    return () => {
      document.removeEventListener("fullscreenchange", updateTarget);
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const fsEl = (document.fullscreenElement as HTMLElement) || null;
    setPortalTarget(fsEl || document.body);
  }, [isOpen, mounted]);

  // ESC 키로 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        if (showConsentModal) {
          setShowConsentModal(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, showConsentModal]);

  // 모달 열려 있을 때 body 스크롤 방지
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  if (!isOpen || !mounted || !portalTarget) return null;

  const toggleSetting = (key: keyof PlayerSettings) => {
    if (key === "autoAudioAnalysis" && !settings.autoAudioAnalysis) {
      setShowConsentModal(true);
      return;
    }
    const nextSettings = {
      ...settings,
      [key]: !settings[key],
    };
    savePlayerSettings(nextSettings);
    applyPlayerSettingsStyles(nextSettings);
    onUpdateSettings(nextSettings);
  };

  const handleReset = () => {
    savePlayerSettings(DEFAULT_PLAYER_SETTINGS);
    applyPlayerSettingsStyles(DEFAULT_PLAYER_SETTINGS);
    onUpdateSettings(DEFAULT_PLAYER_SETTINGS);
  };

  const modalContent = (
    <div
      className="player-settings-modal-root fixed inset-0 z-[99999999] flex items-center justify-center p-4 select-none"
      style={{ zIndex: 99999999 }}
    >
      {/* Backdrop */}
      <div
        className="player-settings-backdrop fixed inset-0 bg-black/80 backdrop-blur-md transition-opacity"
        style={{ zIndex: 99999998 }}
        onClick={onClose}
      />

      {/* Modal Container */}
      <div
        className="player-settings-content relative z-[99999999] flex max-h-[85vh] w-full max-w-lg flex-col rounded-3xl border border-purple-500/30 bg-[#0d1322] shadow-2xl shadow-purple-950/60"
        style={{ zIndex: 99999999 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-500/30">
              <Settings className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">플레이어 환경설정</h2>
                <span className="inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[11px] font-semibold text-purple-300">
                  <Cloud className="h-3 w-3 text-purple-400" />
                  계정 DB 연동
                </span>
              </div>
              <p className="text-xs text-slate-400">자주 사용하는 기능 및 버튼을 개별 설정합니다</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              title="기본 설정으로 복원"
              className="inline-flex items-center gap-1 rounded-xl border border-white/10 bg-slate-800/80 px-2.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-700 hover:text-white"
            >
              <RotateCcw className="h-3 w-3" />
              <span>초기화</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Settings Body with Smooth Scroll */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 scrollbar-thin scrollbar-thumb-purple-500/30">
          {/* Section 1: ⏩ 재생 & 스킵 자동화 */}
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-purple-400">
              <Sparkles className="h-4 w-4" />
              <span>재생 & 스킵 자동화</span>
            </div>

            <div className="space-y-2.5">
              {/* OP/ED 자동 건너뛰기 */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-3.5 hover:border-purple-500/20 transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                    <FastForward className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">OP/ED 자동 건너뛰기</div>
                    <div className="text-xs text-slate-400">오프닝 및 엔딩 감지 시 즉시 자동으로 스킵합니다</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.autoSkip}
                  onChange={() => toggleSetting("autoSkip")}
                />
              </div>

              {/* 스킵 플로팅 버튼 표시 */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-3.5 hover:border-purple-500/20 transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                    <Zap className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">스킵 플로팅 버튼 표시</div>
                    <div className="text-xs text-slate-400">자동 스킵 OFF 시 화면 우측 하단에 보라색 스킵 버튼을 띄웁니다</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.floatingSkipBtn}
                  onChange={() => toggleSetting("floatingSkipBtn")}
                />
              </div>

              {/* 다음 화 자동 재생 */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-3.5 hover:border-purple-500/20 transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">다음 화 자동 재생</div>
                    <div className="text-xs text-slate-400">영상이 종료되면 다음 에피소드로 1초 후 자동 이동합니다</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.autoNext}
                  onChange={() => toggleSetting("autoNext")}
                />
              </div>

              {/* 브라우저 오디오 스킵 분석 */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-3.5 hover:border-purple-500/20 transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-white">브라우저 오디오 AI 스킵</span>
                      <span className="rounded-full bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-bold text-purple-300">데이터 소모</span>
                    </div>
                    <div className="text-xs text-slate-400">DB에 스킵 정보가 없을 때 브라우저가 음원(5~10MB)을 직접 분석합니다</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.autoAudioAnalysis}
                  onChange={() => toggleSetting("autoAudioAnalysis")}
                />
              </div>
            </div>
          </div>

          {/* Section 2: 🎛️ 플레이어 UI & 컨트롤러 */}
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-indigo-400">
              <Sliders className="h-4 w-4" />
              <span>플레이어 UI & 컨트롤러</span>
            </div>

            <div className="space-y-2.5">
              {/* 전체화면 버튼 (기본 ON) */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-3.5 hover:border-purple-500/20 transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                    <Maximize2 className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">전체화면 버튼</div>
                    <div className="text-xs text-slate-400">모니터 전체 화면 전환 버튼을 컨트롤 바에 표시합니다</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.fullscreenBtn}
                  onChange={() => toggleSetting("fullscreenBtn")}
                />
              </div>

              {/* 웹 전체화면 버튼 */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-3.5 hover:border-purple-500/20 transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                    <Tv className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">웹 전체화면 버튼</div>
                    <div className="text-xs text-slate-400">브라우저 창 크기에 맞춘 웹 전체화면 버튼을 표시합니다</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.fullscreenWebBtn}
                  onChange={() => toggleSetting("fullscreenWebBtn")}
                />
              </div>

              {/* PIP 모드 버튼 */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-3.5 hover:border-purple-500/20 transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                    <PictureInPicture className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">PIP 모드 버튼</div>
                    <div className="text-xs text-slate-400">화면 속 화면(팝업 윈도우) 재생 버튼을 표시합니다</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.pipBtn}
                  onChange={() => toggleSetting("pipBtn")}
                />
              </div>

              {/* 배속 순환 캡슐 버튼 (1x~2x) */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-3.5 hover:border-purple-500/20 transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                    <Zap className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">배속 순환 캡슐 버튼</div>
                    <div className="text-xs text-slate-400">컨트롤 바 우측의 배속 원클릭 순환(1x ➔ 1.3x ➔ 1.5x ➔ 2x) 버튼을 표시합니다</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.speed2xBtn}
                  onChange={() => toggleSetting("speed2xBtn")}
                />
              </div>

              {/* +85초 즉시 점프 버튼 */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-3.5 hover:border-purple-500/20 transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 font-bold text-xs">
                    85s
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">+85초 즉시 점프 버튼</div>
                    <div className="text-xs text-slate-400">컨트롤 바 좌측에 +85초 원클릭 건너뛰기 버튼을 표시합니다</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.skip85sBtn}
                  onChange={() => toggleSetting("skip85sBtn")}
                />
              </div>

              {/* 미니 진행바 */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-3.5 hover:border-purple-500/20 transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                    <Sliders className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">미니 진행바</div>
                    <div className="text-xs text-slate-400">마우스가 멈춰 컨트롤 바가 사라졌을 때 하단에 얇은 진행선을 띄웁니다</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.miniProgressBar}
                  onChange={() => toggleSetting("miniProgressBar")}
                />
              </div>

              {/* 키보드 단축키 */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-3.5 hover:border-purple-500/20 transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                    <Keyboard className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">키보드 단축키 (Hotkeys)</div>
                    <div className="text-xs text-slate-400">스페이스(정지/재생), 방향키(5초 점프), F(전체화면) 등 단축키를 활성화합니다</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.hotkey}
                  onChange={() => toggleSetting("hotkey")}
                />
              </div>

              {/* 화면 좌/우 더블 탭 스킵 */}
              <div className="flex flex-col gap-2.5 rounded-2xl border border-white/5 bg-slate-900/60 p-3.5 hover:border-purple-500/20 transition">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                      <FastForward className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">화면 좌/우 더블 탭 스킵</div>
                      <div className="text-xs text-slate-400">
                        화면 좌측(되감기) 또는 우측(앞으로)을 더블 탭/더블 클릭하여 이동합니다
                      </div>
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={settings.doubleTouchSeek}
                    onChange={() => toggleSetting("doubleTouchSeek")}
                  />
                </div>

                {/* 스킵 시간 선택 (5초 / 10초) */}
                {settings.doubleTouchSeek && (
                  <div className="mt-0.5 flex items-center justify-between border-t border-white/5 pt-2.5 pl-11">
                    <span className="text-xs text-slate-300 font-medium">스킵 시간 설정</span>
                    <div className="inline-flex rounded-xl bg-slate-800/90 p-0.5 border border-white/10 text-xs font-semibold">
                      <button
                        type="button"
                        onClick={() => {
                          const next = { ...settings, doubleTouchDuration: 5 };
                          savePlayerSettings(next);
                          applyPlayerSettingsStyles(next);
                          onUpdateSettings(next);
                        }}
                        className={`rounded-lg px-3 py-1 transition cursor-pointer ${
                          settings.doubleTouchDuration === 5
                            ? "bg-purple-600 text-white shadow-sm font-bold"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        5초
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = { ...settings, doubleTouchDuration: 10 };
                          savePlayerSettings(next);
                          applyPlayerSettingsStyles(next);
                          onUpdateSettings(next);
                        }}
                        className={`rounded-lg px-3 py-1 transition cursor-pointer ${
                          settings.doubleTouchDuration === 10
                            ? "bg-purple-600 text-white shadow-sm font-bold"
                            : "text-slate-400 hover:text-white"
                        }`}
                      >
                        10초
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 모바일 화면 스와이프 탐색 */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-3.5 hover:border-purple-500/20 transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                    <Touchpad className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">모바일 화면 스와이프 탐색</div>
                    <div className="text-xs text-slate-400">화면을 길게 누른 채 좌우로 스와이프하여 영상 재생 위치를 조절합니다</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.mobileGesture}
                  onChange={() => toggleSetting("mobileGesture")}
                />
              </div>
            </div>
          </div>

          {/* Section 3: 💬 자막 & 외부 데이터 */}
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-pink-400">
              <FolderOpen className="h-4 w-4" />
              <span>자막 & 외부 데이터</span>
            </div>

            <div className="space-y-2.5">
              {/* 일반 자막 최저 높이 */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-3.5 hover:border-purple-500/20 transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                    <MoveVertical className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">일반 자막 최저 높이</div>
                    <div className="text-xs text-slate-400">일반 자막(VTT/SRT)의 화면 하단 여백을 설정합니다</div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="inline-flex rounded-xl bg-slate-800/90 p-0.5 border border-white/10 text-xs font-semibold">
                    {([15, 25, 35] as const).map((val) => {
                      const isSelected = (settings.subtitleBottom || 15) === val;
                      return (
                        <button
                          key={val}
                          type="button"
                          onClick={() => {
                            const next = { ...settings, subtitleBottom: val };
                            savePlayerSettings(next);
                            applyPlayerSettingsStyles(next);
                            onUpdateSettings(next);
                          }}
                          className={`rounded-lg px-3 py-1 transition cursor-pointer ${
                            isSelected
                              ? "bg-purple-600 text-white shadow-sm font-bold"
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          {val}
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-xs font-medium text-slate-400">px</span>
                </div>
              </div>

              {/* 로컬 자막 파일 열기 버튼 */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-3.5 hover:border-purple-500/20 transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400">
                    <FolderOpen className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">로컬 자막 파일 열기 버튼</div>
                    <div className="text-xs text-slate-400">자막 목록 상단에 내 PC의 자막 파일(.ass, .smi, .srt, .vtt) 열기 버튼을 표시합니다</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.localSubBtn}
                  onChange={() => toggleSetting("localSubBtn")}
                />
              </div>

              {/* 애니시아 등록 제작자 현황 카드 */}
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-slate-900/60 p-3.5 hover:border-purple-500/20 transition">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                    <Users className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">애니시아 등록 제작자 현황 카드</div>
                    <div className="text-xs text-slate-400">하단에 애니시아 등록 자막 제작자 블로그 리스트 및 온디맨드 자막 등록 카드를 표시합니다</div>
                  </div>
                </div>
                <ToggleSwitch
                  checked={settings.anissiaCard}
                  onChange={() => toggleSetting("anissiaCard")}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-white/10 px-6 py-3.5 bg-slate-950/40 rounded-b-3xl">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-purple-600/30 hover:from-purple-500 hover:to-indigo-500 transition"
          >
            완료
          </button>
        </div>
      </div>

      {/* 브라우저 오디오 스킵 데이터 사용 동의 모달 */}
      {showConsentModal && (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-3xl border border-purple-500/30 bg-[#0b0f19] p-5 shadow-2xl shadow-purple-950/60 text-left">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-purple-500/20 text-purple-400">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">오디오 AI 분석 동의</h3>
                <p className="text-[11px] text-purple-300">브라우저 데이터 소모 및 연산 동의</p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-slate-300 bg-slate-900/90 rounded-2xl p-3.5 border border-white/5 mb-4">
              <div className="flex items-start gap-1.5">
                <span className="text-purple-400 font-bold">•</span>
                <span><strong>기능 안내</strong>: DB에 스킵 정보가 없는 애니메이션의 오프닝/엔딩 음원을 브라우저가 직접 분석하여 스킵 구간을 감지합니다.</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-purple-400 font-bold">•</span>
                <span><strong>데이터 사용</strong>: 앞 4분(OP)과 뒤 2.5분(ED) 음원 세그먼트(약 5~10MB)를 다운로드합니다.</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-purple-400 font-bold">•</span>
                <span><strong>기기 연산</strong>: 음원 디코딩 및 주파수 분석이 사용자의 기기(브라우저)에서 실행됩니다.</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConsentModal(false)}
                className="rounded-xl px-3.5 py-2 text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                취소 (꺼짐 유지)
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowConsentModal(false);
                  const nextSettings = {
                    ...settings,
                    autoAudioAnalysis: true,
                  };
                  savePlayerSettings(nextSettings);
                  applyPlayerSettingsStyles(nextSettings);
                  onUpdateSettings(nextSettings);
                }}
                className="rounded-xl px-3.5 py-2 text-xs font-bold bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-600/30 hover:brightness-110 transition"
              >
                동의하고 켜기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return createPortal(modalContent, portalTarget);
}

// iOS 스타일의 스위치 토글 컴포넌트
function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
        checked
          ? "bg-gradient-to-r from-purple-600 to-indigo-600 shadow-sm shadow-purple-500/40"
          : "bg-slate-800"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

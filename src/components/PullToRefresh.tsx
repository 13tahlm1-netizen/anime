"use client";

import { useEffect, useState, useRef } from "react";
import { Loader2, ArrowDown } from "lucide-react";

const PULL_THRESHOLD = 64; // 새로고침 발동 기준 당김 거리 (px)
const MAX_PULL = 90; // 최대 당김 거리 (px)

export default function PullToRefresh() {
  const [pullDistance, setPullDistance] = useState(0);
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const isEligibleRef = useRef(false);
  const isRefreshingRef = useRef(false);

  useEffect(() => {
    isRefreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  useEffect(() => {
    // 터치 지원 기기(스마트폰/태블릿)인지 확인
    if (typeof window === "undefined") return;

    const handleTouchStart = (e: TouchEvent) => {
      if (isRefreshingRef.current) return;

      // 영상 플레이어, 모달 내부, 폼 컨트롤 터치 시에는 풀투리프레시 비활성화
      const target = e.target as HTMLElement | null;
      if (
        target &&
        target.closest(
          ".art-video-player, .artplayer-wrapper, video, input, textarea, select, [role='dialog'], .player-settings-modal-root"
        )
      ) {
        isEligibleRef.current = false;
        return;
      }

      // 페이지 최상단(스크롤이 맨 위)일 때만 시작
      if (window.scrollY <= 2) {
        isEligibleRef.current = true;
        startYRef.current = e.touches[0].clientY;
        startXRef.current = e.touches[0].clientX;
      } else {
        isEligibleRef.current = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isEligibleRef.current || isRefreshingRef.current) return;

      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const deltaY = currentY - startYRef.current;
      const deltaX = currentX - startXRef.current;

      // 수평 스와이프 제스처인 경우 무시
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
        isEligibleRef.current = false;
        setPullDistance(0);
        setIsPulling(false);
        return;
      }

      // 최상단에서 아래로 당기는 경우에만 실행
      if (deltaY > 0 && window.scrollY <= 0) {
        // 브라우저 기본 바운스 스크롤 방지
        if (e.cancelable) {
          e.preventDefault();
        }

        // 고무줄 저항 텐션 (사파리 스타일 감쇄 곡선)
        const damped = Math.min(MAX_PULL, Math.pow(deltaY, 0.82) * 1.3);
        setPullDistance(damped);
        setIsPulling(true);
      } else if (deltaY <= 0) {
        setPullDistance(0);
        setIsPulling(false);
      }
    };

    const handleTouchEnd = () => {
      if (!isEligibleRef.current) return;
      isEligibleRef.current = false;

      if (pullDistance >= PULL_THRESHOLD && !isRefreshingRef.current) {
        // 새로고침 실행
        setIsRefreshing(true);
        setPullDistance(52); // 스피너 유지 높이

        // 햅틱 진동 피드백 (지원 기기)
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          try {
            navigator.vibrate(25);
          } catch {}
        }

        // 스피너가 회전하는 시각적 피드백 후 새로고침
        setTimeout(() => {
          window.location.reload();
        }, 400);
      } else {
        // 기준치 미달 시 원위치 복귀
        setPullDistance(0);
        setIsPulling(false);
      }
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [pullDistance]);

  if (pullDistance <= 0 && !isRefreshing) return null;

  const progress = Math.min(1, pullDistance / PULL_THRESHOLD);
  const isReady = pullDistance >= PULL_THRESHOLD;

  return (
    <div
      className="fixed left-1/2 z-[9999] -translate-x-1/2 pointer-events-none transition-transform"
      style={{
        top: "calc(env(safe-area-inset-top, 0px) + 10px)",
        transform: `translate(-50%, ${pullDistance - 52}px)`,
        transition: isPulling ? "none" : "transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)",
      }}
      aria-hidden="true"
    >
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full border shadow-xl backdrop-blur-lg transition-all duration-200 ${
          isReady || isRefreshing
            ? "border-purple-400/60 bg-[#0f172a]/95 shadow-purple-500/30 scale-105"
            : "border-purple-500/30 bg-[#0b0f19]/90 shadow-black/50"
        }`}
        style={{
          opacity: Math.max(0.2, progress),
          transform: `scale(${0.75 + progress * 0.25})`,
        }}
      >
        {isRefreshing ? (
          <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
        ) : (
          <ArrowDown
            className={`h-5 w-5 transition-transform duration-150 ${
              isReady ? "text-purple-400 rotate-180" : "text-slate-300"
            }`}
            style={{
              transform: isReady ? "rotate(180deg)" : `rotate(${progress * 180}deg)`,
            }}
          />
        )}
      </div>
    </div>
  );
}

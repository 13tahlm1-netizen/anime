"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * 전역 네비게이션 인디케이터
 * 어떤 것이든 화면이 넘어갈 만한 링크/버튼을 클릭하면 즉시 해당 요소를 비활성화하고
 * 동그란 로딩 스피너 애니메이션을 노출하여 사용자가 클릭 여부를 확실히 인지할 수 있도록 보장합니다.
 */
export default function GlobalNavigationIndicator() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeElRef = useRef<HTMLElement | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 페이지 이동 완료(URL 또는 쿼리 변경) 시 로딩 상태 해제
  useEffect(() => {
    resetLoading();
  }, [pathname, searchParams]);

  const resetLoading = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // data-nav-active가 붙어 있는 모든 요소 복구
    const elements = document.querySelectorAll<HTMLElement>("[data-nav-active]");
    elements.forEach((el) => {
      el.removeAttribute("data-nav-active");
      el.style.pointerEvents = "";
      el.classList.remove("cursor-wait");

      // 동적으로 주입된 스피너 제거
      const spinner = el.querySelector(".global-nav-spinner");
      if (spinner) {
        spinner.remove();
      }

      // 숨겨두었던 기존 아이콘 복원
      const hiddenIcons = el.querySelectorAll<HTMLElement>(".global-nav-hidden-icon");
      hiddenIcons.forEach((icon) => {
        icon.classList.remove("global-nav-hidden-icon");
        icon.style.display = "";
      });
    });

    activeElRef.current = null;
  };

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      // 보조키 클릭(새 탭, 새 창 등)은 브라우저 기본 동작 유지
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) {
        return;
      }

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // 가장 가까운 링크(a) 또는 명시적 네비게이션 버튼 탐색
      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (!link) return;

      const href = link.getAttribute("href");
      if (!href) return;

      // 무시할 링크 조건 (새 탭, 앵커, 다운로드, 스크립트 등)
      if (
        link.target === "_blank" ||
        link.hasAttribute("download") ||
        link.getAttribute("rel")?.includes("external") ||
        href.startsWith("#") ||
        href.startsWith("javascript:") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:")
      ) {
        return;
      }

      // 외부 도메인 링크 제외
      if (href.startsWith("http://") || href.startsWith("https://")) {
        try {
          const url = new URL(href);
          if (url.origin !== window.location.origin) {
            return;
          }
        } catch {
          return;
        }
      }

      // 현재 페이지와 완전히 동일한 URL인 경우 제외
      try {
        const targetUrl = new URL(href, window.location.origin);
        if (
          targetUrl.pathname === window.location.pathname &&
          targetUrl.search === window.location.search &&
          targetUrl.hash === window.location.hash
        ) {
          return;
        }
      } catch {}

      // 이미 다른 네비게이션 진행 중이면 중복 클릭 방지
      if (activeElRef.current) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // 유효한 화면 전환 링크 감지!
      activeElRef.current = link;
      link.setAttribute("data-nav-active", "true");
      link.style.pointerEvents = "none";
      link.classList.add("cursor-wait");

      // 컴포넌트 자체에서 이미 animate-spin 스피너를 표시 중이라면 중복 주입 방지
      if (link.querySelector(".animate-spin")) {
        // 8초 후 자동 해제 안전장치
        timeoutRef.current = setTimeout(resetLoading, 8000);
        return;
      }

      // 1. 카드형 대형 링크인 경우 (예: AnimeCard, History 카드 등)
      const isCard =
        link.classList.contains("group") ||
        link.offsetWidth > 160 ||
        link.offsetHeight > 80;

      if (isCard) {
        const overlay = document.createElement("div");
        overlay.className =
          "global-nav-spinner absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/60 backdrop-blur-[2px] transition-all rounded-[inherit] pointer-events-none animate-fade-in";
        overlay.innerHTML = `
          <div class="flex items-center gap-2 rounded-xl bg-purple-950/90 border border-purple-400/50 px-3 py-1.5 shadow-2xl">
            <svg class="h-4 w-4 animate-spin text-purple-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="text-xs font-bold text-white">이동 중...</span>
          </div>
        `;
        link.appendChild(overlay);
      } else {
        // 2. 일반 버튼/인라인 링크인 경우: 첫 번째 아이콘 대체 또는 맨 앞에 스피너 삽입
        const firstIcon = link.querySelector("svg");
        const spinner = document.createElement("span");
        spinner.className = "global-nav-spinner inline-flex items-center shrink-0 mr-1.5 animate-spin";
        spinner.innerHTML = `
          <svg class="h-3.5 w-3.5 text-purple-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        `;

        if (firstIcon && !firstIcon.classList.contains("pointer-events-none")) {
          firstIcon.classList.add("global-nav-hidden-icon");
          firstIcon.style.display = "none";
          firstIcon.parentNode?.insertBefore(spinner, firstIcon);
        } else {
          link.insertBefore(spinner, link.firstChild);
        }
      }

      // 8초 후 자동 해제 안전장치 (네트워크 중단 등 대비)
      timeoutRef.current = setTimeout(resetLoading, 8000);
    };

    window.addEventListener("click", handleClick, { capture: true });
    window.addEventListener("pageshow", resetLoading);
    window.addEventListener("popstate", resetLoading);

    return () => {
      window.removeEventListener("click", handleClick, { capture: true });
      window.removeEventListener("pageshow", resetLoading);
      window.removeEventListener("popstate", resetLoading);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return null;
}

"use client";

import { useEffect } from "react";

/**
 * 보안: 전역 401 인터셉터
 *
 * 세션 토큰이 만료된 뒤(장시간 재생 중 등) API 호출이 401로 실패해도
 * 사용자가 로그아웃된 상태인지 모른 채 앱을 계속 사용하는 문제를 방지합니다.
 * 전역 fetch를 관찰만(observer)하여 401을 감지하면 로그인 페이지로 이동시킵니다.
 *
 * - /api/auth/* (로그인 실패도 401 반환)는 제외
 * - 이미 /login, /setup 페이지이면 중복 리다이렉트 방지
 */
export default function AuthGuard() {
  useEffect(() => {
    const w = window as unknown as { __authGuardInstalled?: boolean };
    if (w.__authGuardInstalled) return;
    w.__authGuardInstalled = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (
      input: RequestInfo | URL | Request,
      init?: RequestInit
    ) => {
      const res = await originalFetch(input, init);
      try {
        if (res.status === 401) {
          const raw =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          const url = new URL(raw, window.location.origin);
          const isAuthEndpoint = url.pathname.startsWith("/api/auth/");
          const onAuthPage =
            window.location.pathname.startsWith("/login") ||
            window.location.pathname.startsWith("/setup");
          if (!isAuthEndpoint && !onAuthPage) {
            window.location.href = "/login";
          }
        }
      } catch {
        // URL 파싱 등 부수 오류는 무시 (원본 응답은 항상 그대로 반환)
      }
      return res;
    };
  }, []);
  return null;
}

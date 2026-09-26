import { NextRequest, NextResponse } from "next/server";
import {
  getLinkkfBaseUrl,
  setLinkkfBaseUrl,
  DEFAULT_LINKKF_URL,
  getOhli24BaseUrl,
  setOhli24BaseUrl,
  DEFAULT_OHLI24_URL,
  getReanimeBaseUrl,
  setReanimeBaseUrl,
  DEFAULT_REANIME_URL,
} from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { assertSafeProxyUrl, UnsafeProxyUrlError } from "@/lib/proxyGuard";

export const dynamic = "force-dynamic";

// 헬스체크 캐시 (30초)
const healthCache: Record<string, { ok: boolean; latencyMs: number; statusText?: string; timestamp: number }> = {};
const CACHE_TTL_MS = 30 * 1000;

// 헬스체크 함수 (해외 CDN/클라우드플레어 지연 고려하여 기본 8초 타임아웃)
async function checkUrlHealth(
  url: string,
  timeoutMs: number = 8000,
  bypassCache: boolean = false
): Promise<{ ok: boolean; latencyMs: number; statusText?: string }> {
  const now = Date.now();
  if (!bypassCache && healthCache[url] && now - healthCache[url].timestamp < CACHE_TTL_MS) {
    return healthCache[url];
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const latencyMs = Date.now() - start;
    const serverHeader = res.headers.get("server")?.toLowerCase() || "";
    const isCf =
      res.status === 403 &&
      (res.headers.get("cf-mitigated") === "challenge" ||
        serverHeader.includes("cloudflare"));
    // 200~399 상태코드 혹은 Cloudflare WAF 챌린지는 도메인이 정상 동작함을 의미
    const ok: boolean = (res.status >= 200 && res.status < 400) || isCf;
    const result = {
      ok,
      latencyMs,
      statusText: isCf ? "200 OK (Cloudflare)" : `${res.status} ${res.statusText}`,
    };
    healthCache[url] = { ...result, timestamp: now };
    return result;
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const result = {
      ok: false,
      latencyMs,
      statusText: err?.message || "Connection timeout or failed",
    };
    // 실패 시 5초만 캐시하여 빠른 복구 확인
    healthCache[url] = { ...result, timestamp: now - CACHE_TTL_MS + 5000 };
    return result;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawProvider = searchParams.get("provider") || "linkkf";
  const provider: "linkkf" | "ohli24" | "reanime" =
    rawProvider === "reanime" ? "reanime" : rawProvider === "ohli24" ? "ohli24" : "linkkf";

  try {
    const isReanime = provider === "reanime";
    const isOhli24 = provider === "ohli24";

    const debug = searchParams.get("debug") === "1";
    if (debug) {
      const testUrl = searchParams.get("test_url") || "https://reanime.to/api/v1/home";
      try {
        const debugRes = await fetch(testUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Referer: "https://reanime.to/",
            Accept: "application/json, text/plain, */*",
          },
          signal: AbortSignal.timeout(8000),
        });
        const debugText = await debugRes.text();
        return NextResponse.json({
          testUrl,
          status: debugRes.status,
          headers: Object.fromEntries(debugRes.headers.entries()),
          preview: debugText.substring(0, 500),
        });
      } catch (e: any) {
        return NextResponse.json({ testUrl, error: e.message });
      }
    }

    const currentBaseUrl = isReanime
      ? await getReanimeBaseUrl()
      : isOhli24
      ? await getOhli24BaseUrl()
      : await getLinkkfBaseUrl();
    const defaultUrl = isReanime
      ? DEFAULT_REANIME_URL
      : isOhli24
      ? DEFAULT_OHLI24_URL
      : DEFAULT_LINKKF_URL;
    const checkTargetUrl = isReanime ? `${currentBaseUrl}/api/v1/home` : currentBaseUrl;
    const health = await checkUrlHealth(checkTargetUrl, isReanime ? 8000 : 5000);

    return NextResponse.json({
      success: true,
      provider,
      baseUrl: currentBaseUrl,
      defaultUrl,
      isHealthy: health.ok,
      latencyMs: health.latencyMs,
      statusText: health.statusText,
    });
  } catch (error: any) {
    console.error("[GET /api/settings/base-url error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json(
      { success: false, message: "베이스 URL을 불러오지 못했습니다." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { success: false, message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }
  // 보안: 사이트 전체에 적용되는 설정이므로 관리자만 변경 가능
  if (!user.isAdmin) {
    return NextResponse.json(
      { success: false, message: "관리자만 베이스 URL을 변경할 수 있습니다." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const rawUrl = body.baseUrl?.trim();
    const force = Boolean(body.force);
    const rawProvider = body.provider;
    const provider: "linkkf" | "ohli24" | "reanime" =
      rawProvider === "reanime"
        ? "reanime"
        : rawProvider === "ohli24"
        ? "ohli24"
        : "linkkf";

    if (!rawUrl) {
      return NextResponse.json(
        { success: false, message: "베이스 URL을 입력해주세요." },
        { status: 400 }
      );
    }

    let formatted = rawUrl;
    if (!formatted.startsWith("http://") && !formatted.startsWith("https://")) {
      formatted = `https://${formatted}`;
    }
    formatted = formatted.replace(/\/+$/, "");

    const defaultUrl =
      provider === "reanime"
        ? DEFAULT_REANIME_URL
        : provider === "ohli24"
        ? DEFAULT_OHLI24_URL
        : DEFAULT_LINKKF_URL;

    // 유효한 URL 형식 검증
    try {
      new URL(formatted);
    } catch {
      return NextResponse.json(
        { success: false, message: `올바른 URL 형식이 아닙니다 (예: ${defaultUrl})` },
        { status: 400 }
      );
    }

    // 보안: 내부/비공개 주소로의 SSRF 차단
    try {
      await assertSafeProxyUrl(formatted);
    } catch (e) {
      if (e instanceof UnsafeProxyUrlError) {
        return NextResponse.json(
          { success: false, message: `허용되지 않는 주소입니다: ${e.message}` },
          { status: 400 }
        );
      }
      throw e;
    }

    // 연결성 테스트 (저장 시에는 캐시 우회)
    const checkTarget = provider === "reanime" ? `${formatted}/api/v1/home` : formatted;
    const health = await checkUrlHealth(checkTarget, 8000, true);
    if (!health.ok && !force) {
      return NextResponse.json(
        {
          success: false,
          needsConfirmation: true,
          message: `입력하신 URL(${formatted})에 접속할 수 없습니다 (${health.statusText}). 그래도 강제로 저장하시겠습니까?`,
          health,
        },
        { status: 422 }
      );
    }

    const saved =
      provider === "reanime"
        ? await setReanimeBaseUrl(formatted)
        : provider === "ohli24"
        ? await setOhli24BaseUrl(formatted)
        : await setLinkkfBaseUrl(formatted);

    delete healthCache[formatted];
    if (provider === "reanime") {
      delete healthCache[checkTarget];
    }

    if (!saved) {
      return NextResponse.json(
        { success: false, message: "데이터베이스 저장에 실패했습니다." },
        { status: 500 }
      );
    }

    const providerLabel =
      provider === "reanime" ? "ReAnime" : provider === "ohli24" ? "Ohli24" : "Linkkf";

    return NextResponse.json({
      success: true,
      provider,
      baseUrl: formatted,
      message: `${providerLabel} 스트리밍 베이스 URL이 성공적으로 변경되었습니다.`,
      health,
    });
  } catch (error: any) {
    console.error("[POST /api/settings/base-url error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json(
      { success: false, message: "베이스 URL 저장에 실패했습니다." },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { assertSafeProxyUrl, UnsafeProxyUrlError } from "@/lib/proxyGuard";
import { getSessionUser } from "@/lib/auth";
import { extractAacFromTs } from "@/lib/tsDemuxer";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // 보안: 미인증 사용자가 서버를 오픈 프록시로 악용하는 것을 방지
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url")?.trim();
  let refUrl = searchParams.get("ref")?.trim();
  if (!refUrl) {
    if (targetUrl && (targetUrl.includes("whycdn") || targetUrl.includes("fri") || targetUrl.includes("michealcdn"))) {
      refUrl = "https://michealcdn.com/";
    } else {
      refUrl = "https://playv2.sub3.top/";
    }
  }
  const isAudioOnly = searchParams.get("audio") === "1" || searchParams.get("audio") === "true";

  if (!targetUrl) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  try {
    await assertSafeProxyUrl(targetUrl);
  } catch (e) {
    if (e instanceof UnsafeProxyUrlError) {
      return new NextResponse(`Blocked URL: ${e.message}`, { status: 400 });
    }
    throw e;
  }

  try {
    const fetchHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      Referer: refUrl,
    };
    if (targetUrl.includes("whycdn") || targetUrl.includes("fri") || targetUrl.includes("michealcdn")) {
      fetchHeaders["Origin"] = "https://michealcdn.com";
    }

    const res = await fetch(targetUrl, {
      headers: fetchHeaders,
    });

    if (!res.ok) {
      return new NextResponse(`Upstream segment error: ${res.statusText}`, { status: res.status });
    }

    const arrayBuffer = await res.arrayBuffer();

    if (isAudioOnly) {
      const uint8 = new Uint8Array(arrayBuffer);
      const aac = extractAacFromTs(uint8);
      // aac가 추출되었고 비디오가 제거되어 크기가 줄어든 경우 순수 오디오로 반환
      if (aac.length > 0 && aac.length < uint8.length) {
        const aacBuffer = aac.buffer.slice(aac.byteOffset, aac.byteOffset + aac.byteLength) as ArrayBuffer;
        return new NextResponse(aacBuffer, {
          status: 200,
          headers: {
            "Content-Type": "audio/aac",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Cache-Control": "public, max-age=86400, s-maxage=86400, immutable",
          },
        });
      }
    }

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "video/mp2t",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control": "public, max-age=86400, s-maxage=86400, immutable",
      },
    });
  } catch (error) {
    console.error("[Segment Proxy error]:", error);
    // 보안: 내부/외부 에러 상세를 응답 본문에 노출하지 않음
    return new NextResponse("Proxy error", {
      status: 502,
    });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

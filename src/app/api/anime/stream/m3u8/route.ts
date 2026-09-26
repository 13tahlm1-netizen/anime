import { NextRequest, NextResponse } from "next/server";
import { assertSafeProxyUrl, UnsafeProxyUrlError } from "@/lib/proxyGuard";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  // 보안: 미인증 사용자가 서버를 오픈 프록시로 악용하는 것을 방지
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  let targetUrl = searchParams.get("url")?.trim();
  let refUrl = searchParams.get("ref")?.trim();
  if (!refUrl) {
    try {
      refUrl = targetUrl ? new URL(targetUrl).origin + "/" : "https://playv2.sub3.top/";
    } catch {
      refUrl = "https://playv2.sub3.top/";
    }
  }

  if (!targetUrl) {
    return new NextResponse("Missing url parameter", { status: 400 });
  }

  // FirePlayer (michealcdn) 방어:
  // master.m3u8은 특정 발급 서버 IP에 바인딩된 토큰이므로 Vercel 멀티 인스턴스 환경에서 403 Forbidden 발생
  // 반면 master.txt는 토큰 없이 동일한 HLS 스트림을 제공하므로 자동 정규화
  if (targetUrl.includes("michealcdn.com") && targetUrl.includes("master.m3u8")) {
    targetUrl = targetUrl.replace(/master\.m3u8(\?.*)?$/, "master.txt");
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
    let res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Referer: refUrl,
      },
    });

    // 403 Forbidden 발생 시 master.m3u8 주소였다면 master.txt 폴백 재시도
    if (!res.ok && res.status === 403 && targetUrl.includes("master.m3u8")) {
      const fallbackUrl = targetUrl.replace(/master\.m3u8(\?.*)?$/, "master.txt");
      try {
        await assertSafeProxyUrl(fallbackUrl);
        const fallbackRes = await fetch(fallbackUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            Referer: refUrl,
          },
        });
        if (fallbackRes.ok) {
          res = fallbackRes;
          targetUrl = fallbackUrl;
        }
      } catch {}
    }

    if (!res.ok) {
      return new NextResponse(`Upstream error: ${res.statusText}`, { status: res.status });
    }

    const text = await res.text();
    const lines = text.split(/\r?\n/);
    const newLines: string[] = [];

    const isMasterPlaylist = text.includes("#EXT-X-STREAM-INF");
    let prevLine = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const stripped = line.trim();

      if (stripped && !stripped.startsWith("#")) {
        const absUrl = new URL(stripped, targetUrl).toString();

        // 1) 마스터 플레이리스트의 하위 변형 스트림 (EXT-X-STREAM-INF 바로 다음 라인)이거나,
        //    URL 자체에 m3u8, /m3/, /hls/ 등이 포함된 하위 플레이리스트는 m3u8 프록시로 전달
        const isSubPlaylist =
          isMasterPlaylist ||
          prevLine.startsWith("#EXT-X-STREAM-INF") ||
          absUrl.includes(".m3u8") ||
          absUrl.includes("/m3/") ||
          absUrl.endsWith(".txt");

        if (isSubPlaylist) {
          newLines.push(
            `/api/anime/stream/m3u8?url=${encodeURIComponent(absUrl)}&ref=${encodeURIComponent(refUrl)}`
          );
        } else {
          // 2) 미디어 세그먼트 (ts, html 등) 처리:
          //    브라우저의 Origin 헤더를 거부하는 특정 CDN (whycdn, fri*ncloud, michealcdn 등)은
          //    CORS 및 500 차단 우회를 위해 segment 프록시로 전달하고,
          //    CORS가 허용되는 일반 Linkkf CDN은 서버 대역폭 절약을 위해 직접 주소 유지
          const needsSegmentProxy =
            absUrl.includes("whycdn") ||
            absUrl.includes("fri") ||
            absUrl.includes("michealcdn") ||
            refUrl.includes("michealcdn") ||
            refUrl.includes("ohli24");

          if (needsSegmentProxy) {
            newLines.push(
              `/api/anime/stream/segment?url=${encodeURIComponent(absUrl)}&ref=${encodeURIComponent(refUrl)}`
            );
          } else {
            newLines.push(absUrl);
          }
        }
      } else {
        // 태그 라인 내부의 URI 속성 (예: #EXT-X-MEDIA:TYPE=...,URI="...") 변환
        if (stripped.startsWith("#EXT-X-MEDIA:") && stripped.includes('URI="')) {
          const replaced = stripped.replace(/URI="([^"]+)"/, (_, rawUri) => {
            const abs = new URL(rawUri, targetUrl).toString();
            return `URI="/api/anime/stream/m3u8?url=${encodeURIComponent(abs)}&ref=${encodeURIComponent(refUrl)}"`;
          });
          newLines.push(replaced);
        } else if (stripped.startsWith("#EXT-X-KEY:") && stripped.includes('URI="')) {
          // 암호화 키 URI 프록시
          const replaced = stripped.replace(/URI="([^"]+)"/, (_, rawUri) => {
            const abs = new URL(rawUri, targetUrl).toString();
            return `URI="/api/anime/stream/segment?url=${encodeURIComponent(abs)}&ref=${encodeURIComponent(refUrl)}"`;
          });
          newLines.push(replaced);
        } else {
          newLines.push(line);
        }
      }

      if (stripped) {
        prevLine = stripped;
      }
    }

    return new NextResponse(newLines.join("\n"), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control": "public, s-maxage=86400, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[Proxy m3u8 error]:", error);
    // 보안: 내부/외부 에러 상세를 응답 본문에 노출하지 않음
    return new NextResponse("Proxy error", {
      status: 502,
    });
  }
}

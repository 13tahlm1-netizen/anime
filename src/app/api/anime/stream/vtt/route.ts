import { NextRequest, NextResponse } from "next/server";
import { assertSafeProxyUrl, UnsafeProxyUrlError } from "@/lib/proxyGuard";
import { getSessionUser } from "@/lib/auth";

function vttShiftOffset(vttText: string, offset = 0): string {
  if (Math.abs(offset) < 0.001) {
    return vttText;
  }

  const toSeconds = (tStr: string) => {
    const cleanStr = tStr.replace(",", ".").trim();
    const p = cleanStr.split(":");
    if (p.length === 3) {
      return parseFloat(p[0]) * 3600 + parseFloat(p[1]) * 60 + parseFloat(p[2]);
    } else if (p.length === 2) {
      return parseFloat(p[0]) * 60 + parseFloat(p[1]);
    }
    return parseFloat(cleanStr) || 0;
  };

  const toVttTs = (sec: number) => {
    const s = Math.max(0, sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rem = s % 60;
    let wholeS = Math.floor(rem);
    let ms = Math.floor(Math.round((rem - wholeS) * 1000));
    if (ms >= 1000) {
      wholeS += 1;
      ms -= 1000;
    }
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(wholeS).padStart(2, "0")}.${String(Math.min(ms, 999)).padStart(3, "0")}`;
  };

  const pattern = /((?:\d{1,2}:)?\d{2}:\d{2}[\.,]\d{2,3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[\.,]\d{2,3})(.*)/g;

  return vttText.replace(pattern, (_, t1, t2, extra) => {
    const st = toSeconds(t1) + offset;
    const et = toSeconds(t2) + offset;
    if (et <= 0) {
      return `00:00:00.000 --> 00:00:00.000${extra || ""}`;
    }
    return `${toVttTs(Math.max(0, st))} --> ${toVttTs(et)}${extra || ""}`;
  });
}

export async function GET(request: NextRequest) {
  // 보안: 미인증 사용자가 서버를 오픈 프록시로 악용하는 것을 방지
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get("url")?.trim();
  const offset = parseFloat(searchParams.get("offset") || "0") || 0;

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
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });

    if (!res.ok) {
      return new NextResponse(`Upstream error: ${res.statusText}`, { status: res.status });
    }

    const vttText = await res.text();
    // Clean unparsed ASS style/pos tags like {\an8}, {\pos}, etc.
    const cleanedVtt = vttText.replace(/\{[^}]*\}/g, "");
    const finalVtt = vttShiftOffset(cleanedVtt, offset);

    return new NextResponse(finalVtt, {
      status: 200,
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[Proxy vtt error]:", error);
    // 보안: 내부/외부 에러 상세를 응답 본문에 노출하지 않음
    return new NextResponse("VTT proxy error", {
      status: 502,
    });
  }
}

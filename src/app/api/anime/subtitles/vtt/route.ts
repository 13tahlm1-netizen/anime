import { NextRequest, NextResponse } from "next/server";
import { searchAllSubtitlesParallel, findKairanSubtitle } from "@/lib/subtitles";
import { assertSafeProxyUrl, UnsafeProxyUrlError } from "@/lib/proxyGuard";
import { getSessionUser } from "@/lib/auth";

function toSeconds(tStr: string): number {
  const p = tStr.trim().split(":");
  if (p.length === 3) {
    return parseFloat(p[0]) * 3600 + parseFloat(p[1]) * 60 + parseFloat(p[2]);
  } else if (p.length === 2) {
    return parseFloat(p[0]) * 60 + parseFloat(p[1]);
  }
  return parseFloat(tStr) || 0;
}

function toVttTimestamp(sec: number): string {
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
}

function assToWebVtt(assText: string, offset = 0): string {
  const lines = [
    "WEBVTT\n\n",
    "STYLE\n",
    "::cue {\n",
    "  font-size: 80%;\n",
    "  line-height: 1.25;\n",
    "}\n\n",
  ];

  const pattern =
    /^Dialogue:\s*[^,]+,(\d+:\d{2}:\d{2}(?:\.\d+)?),(\d+:\d{2}:\d{2}(?:\.\d+)?),([^,]*),([^,]*),(?:[^,]*,){4}(.*)$/gim;

  const cues: Array<{ st: number; et: number; text: string }> = [];
  let match;
  while ((match = pattern.exec(assText)) !== null) {
    const st = toSeconds(match[1]) + offset;
    const et = toSeconds(match[2]) + offset;
    const raw = match[5];
    const clean = raw
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\N/gi, "\n")
      .replace(/\\n/gi, "\n")
      .replace(/\\h/gi, " ")
      .trim();
    if (clean && et > 0) {
      cues.push({ st: Math.max(0, st), et, text: clean });
    }
  }

  cues.sort((a, b) => a.st - b.st);
  cues.forEach((c, i) => {
    lines.push(`${i + 1}\n${toVttTimestamp(c.st)} --> ${toVttTimestamp(c.et)}\n${c.text}\n\n`);
  });

  return lines.join("");
}

function vttShiftOffset(vttText: string, offset = 0): string {
  if (Math.abs(offset) < 0.001) return vttText;

  const pattern = /((?:\d{1,2}:)?\d{2}:\d{2}[\.,]\d{2,3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[\.,]\d{2,3})(.*)/g;

  return vttText.replace(pattern, (_, t1, t2, extra) => {
    const st = toSeconds(t1) + offset;
    const et = toSeconds(t2) + offset;
    if (et <= 0) {
      return `00:00:00.000 --> 00:00:00.000${extra || ""}`;
    }
    return `${toVttTimestamp(Math.max(0, st))} --> ${toVttTimestamp(et)}${extra || ""}`;
  });
}

export async function GET(request: NextRequest) {
  // 보안: 미인증 사용자가 서버를 오픈 크롤링/퍼치 서비스로 악용하는 것을 방지
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title")?.trim();
  const ep = parseInt(searchParams.get("ep") || "1", 10) || 1;
  const subName = searchParams.get("name")?.trim();
  const rawUrl = searchParams.get("url")?.trim();
  const offset = parseFloat(searchParams.get("offset") || "0") || 0;

  try {
    let content = "";
    let isAss = false;

    // 1. URL이 전달된 경우 (기존 프록시 또는 외부 URL)
    if (rawUrl) {
      const fetchUrl = rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
        ? rawUrl
        : new URL(rawUrl, request.url).toString();
      let urlOk = true;
      try {
        await assertSafeProxyUrl(fetchUrl);
      } catch (e) {
        if (e instanceof UnsafeProxyUrlError) {
          console.warn("[Subtitles VTT] Blocked unsafe url:", e.message);
          urlOk = false;
        } else {
          throw e;
        }
      }
      if (urlOk) {
        const res = await fetch(fetchUrl);
        if (res.ok) {
          content = await res.text();
          isAss = rawUrl.toLowerCase().includes(".ass") || content.includes("[Script Info]");
        }
      }
    }

    // 2. title과 ep로 검색
    if (!content && title) {
      // 카이란 단독 검색 시도
      if (subName && subName.includes("카이란")) {
        const kairan = await findKairanSubtitle(title, ep, 5000);
        if (kairan && kairan.content) {
          content = kairan.content;
          isAss = Boolean(kairan.is_ass);
        }
      }

      // 전체 자막 검색 결과에서 일치 자막 탐색
      if (!content) {
        const result = await searchAllSubtitlesParallel(title, ep, 10000);
        if (result && result.subtitles && result.subtitles.length > 0) {
          let matched = subName
            ? result.subtitles.find((s) => s.name === subName || subName.includes(s.name) || s.name.includes(subName))
            : null;
          if (!matched) {
            matched = result.subtitles.find((s) => s.is_ass) || result.subtitles[0];
          }
          if (matched && matched.content) {
            content = matched.content;
            isAss = Boolean(matched.is_ass);
          }
        }
      }
    }

    if (!content) {
      return new NextResponse("WEBVTT\n\n", {
        status: 200,
        headers: {
          "Content-Type": "text/vtt; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    let finalVtt = "";
    if (isAss || content.includes("[Script Info]") || content.includes("Dialogue:")) {
      finalVtt = assToWebVtt(content, offset);
    } else {
      const cleaned = content.replace(/\{[^}]*\}/g, "");
      finalVtt = vttShiftOffset(cleaned, offset);
    }

    return new NextResponse(finalVtt, {
      status: 200,
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    console.error("[Subtitles VTT Conversion Error]:", err);
    return new NextResponse("WEBVTT\n\n", {
      status: 200,
      headers: {
        "Content-Type": "text/vtt; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}

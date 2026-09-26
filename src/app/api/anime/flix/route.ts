import { NextRequest, NextResponse } from "next/server";
import { getReanimeBaseUrl } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const preferredRegion = "iad1";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const anilistId = searchParams.get("anilistId");
  const ep = searchParams.get("ep") || "1";

  if (!anilistId) {
    return NextResponse.json({ success: false, message: "Missing anilistId" }, { status: 400 });
  }

  const baseUrl = await getReanimeBaseUrl();
  const targetUrl = `${baseUrl}/api/flix/${anilistId}/${ep}`;

  // 1순위: 직접 fetch 시도
  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: `${baseUrl}/`,
        Accept: "application/json, text/plain, */*",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.success && Array.isArray(data.servers) && data.servers.length > 0) {
        return NextResponse.json(data);
      }
    }
  } catch (err) {
    // 2순위 우회로 이동
  }

  // 2순위: Jina Reader를 통한 Cloudflare WAF 우회
  try {
    const jinaRes = await fetch(`https://r.jina.ai/${targetUrl}`, {
      headers: {
        Accept: "application/json",
        "X-No-Cache": "true",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (jinaRes.ok) {
      const jinaJson = await jinaRes.json();
      const content = jinaJson?.data?.content;
      if (content && typeof content === "string") {
        const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        let parsed: any = null;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          const match = cleaned.match(/\{[\s\S]*\}/);
          if (match) parsed = JSON.parse(match[0]);
        }
        if (parsed?.success && Array.isArray(parsed.servers) && parsed.servers.length > 0) {
          return NextResponse.json(parsed);
        }
      }
    }
  } catch (jinaErr: any) {
    console.error("[flix route Jina bypass error]:", jinaErr);
  }

  return NextResponse.json(
    { success: false, message: "영상 스트림(FlixCloud) 정보를 가져오지 못했습니다." },
    { status: 502 }
  );
}

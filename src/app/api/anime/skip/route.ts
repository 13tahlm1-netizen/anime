import { NextRequest, NextResponse } from "next/server";
import { getSkipTimes, SkipInterval } from "@/lib/aniskip";
import { getDb, initDb, getSkipTimesFromDb, upsertSkipTimes, getAnimeThemes } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // 보안: 미인증 사용자가 AniSkip/AniList/Anissia 외부 조회를 유도하는 것을 방지
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title")?.trim();
  const ep = parseInt(searchParams.get("ep") || "1", 10) || 1;
  const duration = parseInt(searchParams.get("duration") || "0", 10) || 0;
  const poster = searchParams.get("poster")?.trim() || "";

  if (!title) {
    return NextResponse.json({ success: false, message: "Missing title parameter" }, { status: 400 });
  }

  // 1. DB에 현재 회차 스킵 타임스탬프가 있는지 확인
  try {
    const record = await getSkipTimesFromDb(title, ep);
    if (record) {
      const intervals: SkipInterval[] = [];
      if (record.op_start !== null && record.op_end !== null) {
        intervals.push({ type: "op", label: "오프닝", start: record.op_start, end: record.op_end });
      }
      if (record.ed_start !== null && record.ed_end !== null) {
        intervals.push({ type: "ed", label: "엔딩", start: record.ed_start, end: record.ed_end });
      }

      if (intervals.length > 0) {
        return NextResponse.json(
          { success: true, found: true, source: record.source || "db", intervals },
          {
            headers: {
              "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=43200",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }
    }
  } catch (e) {
    console.error("[DB Skip lookup error]:", e);
  }

  // 2. DB에 해당 작품의 크로마 지문 데이터(anime_themes)가 있는지 확인
  let themes: any[] = [];
  try {
    themes = await getAnimeThemes(title);
  } catch (e) {
    console.error("[DB Themes lookup error]:", e);
  }

  // 3. AniSkip 조회
  try {
    const intervals = await getSkipTimes(title, ep, duration, poster);

    if (intervals.length > 0) {
      const op = intervals.find((i) => i.type === "op");
      const ed = intervals.find((i) => i.type === "ed");

      upsertSkipTimes({
        animeId: title,
        episodeNumber: ep,
        opStart: op ? op.start : null,
        opEnd: op ? op.end : null,
        edStart: ed ? ed.start : null,
        edEnd: ed ? ed.end : null,
        source: "aniskip",
      }).catch((err) => console.error("[DB Skip insert error]:", err));

      return NextResponse.json(
        {
          success: true,
          found: true,
          source: "aniskip",
          intervals,
          themes: themes.length > 0 ? themes : undefined,
        },
        {
          headers: {
            "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=43200",
            "Access-Control-Allow-Origin": "*",
          },
        }
      );
    }
  } catch (error) {
    console.error("[Skip API error]:", error);
  }

  // AniSkip에도 없는 경우: 등록된 크로마 지문이 있다면 themes 전달
  return NextResponse.json(
    {
      success: true,
      found: false,
      hasThemes: themes.length > 0,
      themes,
      intervals: [],
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}

export async function POST(request: NextRequest) {
  // 보안: 공용 스킵 데이터는 로그인한 사용자만 수정 가능
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { success: false, message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { animeId, episodeNumber, opStart, opEnd, edStart, edEnd, source } = body;

    if (!animeId || typeof episodeNumber !== "number") {
      return NextResponse.json(
        { success: false, message: "Missing required parameters" },
        { status: 400 }
      );
    }

    const ok = await upsertSkipTimes({
      animeId: String(animeId),
      episodeNumber,
      opStart: typeof opStart === "number" ? opStart : null,
      opEnd: typeof opEnd === "number" ? opEnd : null,
      edStart: typeof edStart === "number" ? edStart : null,
      edEnd: typeof edEnd === "number" ? edEnd : null,
      source: source || "audio_ai",
    });

    return NextResponse.json({ success: ok });
  } catch (error) {
    console.error("[POST /api/anime/skip error]:", error);
    return NextResponse.json(
      { success: false, message: "Failed to save skip times" },
      { status: 500 }
    );
  }
}

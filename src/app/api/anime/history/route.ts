import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
import { checkAndPromoteNewEpisodes } from "@/lib/historyPromotion";
import { getCurrentUserId, getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  // 보안: 미인증 접근은 401 ("default" 사용자 데이터 노출 방지)
  const session = await getSessionUser();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  // 보안: 클라이언트에서 user_id를 지정할 수 없도록 현재 세션 사용자만 사용
  const userId = await getCurrentUserId();
  const animeId = searchParams.get("anime_id");

  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ success: true, items: [] });
  }

  try {
    await initDb();

    if (animeId) {
      const rows = await sql`
        SELECT * FROM anime_history
        WHERE user_id = ${userId} AND anime_id = ${animeId}
        ORDER BY episode_number ASC;
      `;
      // 보안: 사용자별 데이터이므로 어떤 캐시도 허용하지 않음
      return NextResponse.json(
        { success: true, items: rows },
        { headers: { "Cache-Control": "private, no-store" } }
      );
    }

    // 방영 중 신규 회차 감지 및 승격 (10분 캐시 내에서는 즉시 리턴)
    await checkAndPromoteNewEpisodes(userId);

    const rows = await sql`
      SELECT * FROM (
        SELECT DISTINCT ON (anime_id)
          anime_id, anime_title, anime_poster, episode_number, episode_title, watch_url, watch_time as current_time, duration, is_completed, updated_at
        FROM anime_history
        WHERE user_id = ${userId}
        ORDER BY anime_id, updated_at DESC
      ) t
      ORDER BY updated_at DESC
      LIMIT 30;
    `;

    // 보안: 사용자별 데이터이므로 어떤 캐시도 허용하지 않음
    return NextResponse.json(
      { success: true, items: rows },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    console.error("[History API GET error]:", error);
    // 보안: 내부 에러 상세(DB 스키마 등)를 클라이언트에 노출하지 않음
    return NextResponse.json(
      { success: false, message: "시청 기록을 불러오지 못했습니다.", items: [] },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ success: false, message: "Database not configured" });
  }

  // 보안: 미인증 쓰기는 401 ("default" 사용자로의 조용한 기록 방지)
  const session = await getSessionUser();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    await initDb();
    const body = await request.json();
    // 보안: 클라이언트에서 userId를 지정할 수 없도록 현재 세션 사용자만 사용
    const effectiveUserId = await getCurrentUserId();
    const animeId = body.animeId ?? body.anime_id;
    const animeTitle = body.animeTitle ?? body.anime_title ?? "";
    const animePoster = body.animePoster ?? body.anime_poster ?? "";
    const episodeNumber = body.episodeNumber !== undefined ? body.episodeNumber : body.episode_number;
    const episodeTitle = body.episodeTitle ?? body.episode_title ?? "";
    const watchUrl = body.watchUrl ?? body.watch_url;
    const currentTime = parseFloat(body.currentTime ?? body.watch_time ?? body.watchTime ?? "0") || 0.0;
    const duration = parseFloat(body.duration ?? "0") || 0.0;
    const isCompleted = Boolean(body.isCompleted ?? body.is_completed ?? false);

    if (!animeId || episodeNumber === undefined || !watchUrl) {
      return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
    }

    await sql`
      INSERT INTO anime_history (
        user_id, anime_id, anime_title, anime_poster, episode_number, episode_title, watch_url, watch_time, duration, is_completed, updated_at
      ) VALUES (
        ${effectiveUserId}, ${animeId}, ${animeTitle}, ${animePoster}, ${episodeNumber}, ${episodeTitle}, ${watchUrl}, ${currentTime}, ${duration}, ${isCompleted}, CURRENT_TIMESTAMP
      )
      ON CONFLICT (user_id, anime_id, episode_number)
      DO UPDATE SET
        watch_time = EXCLUDED.watch_time,
        duration = EXCLUDED.duration,
        is_completed = EXCLUDED.is_completed,
        anime_title = EXCLUDED.anime_title,
        anime_poster = EXCLUDED.anime_poster,
        episode_title = EXCLUDED.episode_title,
        watch_url = EXCLUDED.watch_url,
        updated_at = CURRENT_TIMESTAMP;
    `;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[History API POST error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json({ success: false, message: "시청 기록 저장에 실패했습니다." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  // 보안: 미인증 쓰기는 401
  const session = await getSessionUser();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  // 보안: 클라이언트에서 user_id를 지정할 수 없도록 현재 세션 사용자만 사용
  const userId = await getCurrentUserId();
  const animeId = searchParams.get("anime_id");
  const ep = searchParams.get("ep");

  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ success: false, message: "Database not configured" });
  }

  try {
    await initDb();
    if (animeId && ep) {
      await sql`
        DELETE FROM anime_history
        WHERE user_id = ${userId} AND anime_id = ${animeId} AND episode_number = ${parseInt(ep, 10)};
      `;
    } else if (animeId) {
      await sql`
        DELETE FROM anime_history
        WHERE user_id = ${userId} AND anime_id = ${animeId};
      `;
    } else {
      await sql`
        DELETE FROM anime_history
        WHERE user_id = ${userId};
      `;
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[History API DELETE error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json({ success: false, message: "시청 기록 삭제에 실패했습니다." }, { status: 500 });
  }
}

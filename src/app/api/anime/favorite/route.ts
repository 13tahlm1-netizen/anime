import { NextRequest, NextResponse } from "next/server";
import { getDb, initDb } from "@/lib/db";
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
  const animeId = searchParams.get("id");

  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ success: true, is_favorited: false, items: [] });
  }

  try {
    await initDb();

    if (animeId) {
      const rows = await sql`
        SELECT 1 FROM anime_favorites
        WHERE user_id = ${userId} AND anime_id = ${animeId}
        LIMIT 1;
      `;
      return NextResponse.json({ success: true, is_favorited: rows.length > 0 });
    }

    const rows = await sql`
      SELECT * FROM anime_favorites
      WHERE user_id = ${userId}
      ORDER BY created_at DESC;
    `;
    // 보안: 사용자별 데이터이므로 어떤 캐시도 허용하지 않음
    return NextResponse.json(
      { success: true, items: rows },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error: any) {
    console.error("[Favorite API GET error]:", error);
    // 보안: 내부 에러 상세(DB 스키마 등)를 클라이언트에 노출하지 않음
    return NextResponse.json(
      { success: false, message: "즐겨찾기를 불러오지 못했습니다.", items: [] },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // 보안: 미인증 쓰기는 401
  const session = await getSessionUser();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const sql = getDb();
  if (!sql) {
    return NextResponse.json({ success: false, message: "Database not configured" });
  }

  try {
    await initDb();
    const body = await request.json();
    // 보안: 클라이언트에서 userId를 지정할 수 없도록 현재 세션 사용자만 사용
    const effectiveUserId = await getCurrentUserId();
    const { animeId, animeTitle, animePoster = "" } = body;

    if (!animeId) {
      return NextResponse.json({ success: false, message: "Missing animeId" }, { status: 400 });
    }

    // 원자 토글: 먼저 삽입 시도 (이미 있으면 DO NOTHING),
    // 실패(이미 존재) 시에만 삭제 -> check-then-act 레이스 제거
    const inserted = await sql`
      INSERT INTO anime_favorites (user_id, anime_id, anime_title, anime_poster)
      VALUES (${effectiveUserId}, ${animeId}, ${animeTitle}, ${animePoster})
      ON CONFLICT (user_id, anime_id) DO NOTHING
      RETURNING id;
    `;

    if (inserted.length > 0) {
      return NextResponse.json({ success: true, is_favorited: true });
    }

    await sql`
      DELETE FROM anime_favorites
      WHERE user_id = ${effectiveUserId} AND anime_id = ${animeId};
    `;
    return NextResponse.json({ success: true, is_favorited: false });
  } catch (error) {
    console.error("[Favorite API POST error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json({ success: false, message: "즐겨찾기 처리에 실패했습니다." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getAnimeThemes, saveAnimeTheme } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // 보안: 미인증 사용자가 크로마 지문 데이터를 읽는 것을 방지
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const animeId = searchParams.get("anime_id")?.trim();

  if (!animeId) {
    return NextResponse.json(
      { success: false, message: "Missing anime_id parameter" },
      { status: 400 }
    );
  }

  try {
    const themes = await getAnimeThemes(animeId);
    return NextResponse.json({ success: true, themes });
  } catch (error) {
    console.error("[GET /api/anime/themes error]:", error);
    return NextResponse.json(
      { success: false, message: "Failed to load anime themes" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // 보안: 크로마 지문 데이터는 로그인한 사용자만 저장 가능 (무제한 TEXT 컬럼 남용 방지)
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { success: false, message: "로그인이 필요합니다." },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { animeId, themeType, version, duration, chromaData } = body;

    if (!animeId || !themeType || !chromaData) {
      return NextResponse.json(
        { success: false, message: "Missing required parameters (animeId, themeType, chromaData)" },
        { status: 400 }
      );
    }

    if (themeType !== "op" && themeType !== "ed") {
      return NextResponse.json(
        { success: false, message: "themeType must be 'op' or 'ed'" },
        { status: 400 }
      );
    }

    const ok = await saveAnimeTheme({
      animeId: String(animeId),
      themeType,
      version: typeof version === "number" ? version : 1,
      duration: typeof duration === "number" ? duration : 90.0,
      chromaData: String(chromaData),
    });

    return NextResponse.json({ success: ok });
  } catch (error) {
    console.error("[POST /api/anime/themes error]:", error);
    return NextResponse.json(
      { success: false, message: "Failed to save anime theme" },
      { status: 500 }
    );
  }
}

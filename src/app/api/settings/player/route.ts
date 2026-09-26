import { NextRequest, NextResponse } from "next/server";
import { getUserSettings, saveUserSettings, getDb, initDb } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({
        success: true,
        authenticated: false,
        userId: "default",
        settings: null,
      });
    }

    const settings = await getUserSettings(user.username);
    return NextResponse.json({
      success: true,
      authenticated: true,
      userId: user.username,
      settings,
    });
  } catch (error: any) {
    console.error("[GET /api/settings/player error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json(
      { success: false, message: "설정 조회 실패" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const settings = body?.settings;
    if (!settings || typeof settings !== "object") {
      return NextResponse.json(
        { success: false, message: "올바른 설정 데이터가 아닙니다." },
        { status: 400 }
      );
    }

    const saved = await saveUserSettings(user.username, settings);
    if (!saved) {
      return NextResponse.json(
        { success: false, message: "데이터베이스 저장에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "설정이 성공적으로 저장되었습니다.",
      settings,
    });
  } catch (error: any) {
    console.error("[POST /api/settings/player error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json(
      { success: false, message: "설정 저장 실패" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }
    const sql = getDb();
    if (sql) {
      await initDb();
      await sql`DELETE FROM user_settings WHERE user_id = ${user.username}`;
    }
    return NextResponse.json({ success: true, message: "설정이 초기화되었습니다." });
  } catch (error: any) {
    console.error("[DELETE /api/settings/player error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json(
      { success: false, message: "설정 초기화 실패" },
      { status: 500 }
    );
  }
}

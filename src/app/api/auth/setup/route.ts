import { NextRequest, NextResponse } from "next/server";
import { getUserCount, createFirstAdmin } from "@/lib/db";
import { hashPassword, createAuthToken, AUTH_COOKIE_NAME } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    // 1. 이미 등록된 계정이 있는지 원자적으로 확인
    const count = await getUserCount();
    if (count > 0) {
      return NextResponse.json(
        { success: false, message: "이미 관리자 계정이 등록되어 있습니다. 로그인해 주세요." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { username, nickname, password, confirmPassword } = body;

    // 2. 유효성 검사
    if (!username || typeof username !== "string" || !username.trim()) {
      return NextResponse.json(
        { success: false, message: "로그인 ID를 입력해주세요." },
        { status: 400 }
      );
    }

    if (!password || typeof password !== "string" || password.length < 4) {
      return NextResponse.json(
        { success: false, message: "비밀번호는 최소 4자 이상이어야 합니다." },
        { status: 400 }
      );
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { success: false, message: "비밀번호 확인이 일치하지 않습니다." },
        { status: 400 }
      );
    }

    // 3. 비밀번호 해싱 및 첫 마스터 관리자(is_admin=true) 원자 생성
    // (NOT EXISTS 단일 문으로 동시 세팅 요청이 중복 계정을 만드는 것을 방지)
    const passwordHash = hashPassword(password);
    const assignedNickname = (nickname && nickname.trim()) || "관리자";

    const newUser = await createFirstAdmin({
      username: username.trim(),
      passwordHash,
      nickname: assignedNickname,
    });

    // 동시 요청 경쟁에서 지는 경우 (이미 다른 요청이 먼저 생성)
    if (!newUser) {
      return NextResponse.json(
        { success: false, message: "이미 관리자 계정이 등록되어 있습니다. 로그인해 주세요." },
        { status: 403 }
      );
    }

    // 4. 인증 토큰 생성 및 쿠키 주입
    const token = createAuthToken({
      id: newUser.id,
      username: newUser.username,
      nickname: newUser.nickname,
      isAdmin: newUser.is_admin,
    });

    const response = NextResponse.json({
      success: true,
      message: "🎉 초기 마스터 관리자 계정이 안전하게 생성되었습니다!",
      user: {
        id: newUser.id,
        username: newUser.username,
        nickname: newUser.nickname,
        isAdmin: newUser.is_admin,
      },
    });

    response.cookies.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 86400, // 30일
      path: "/",
    });

    return response;
  } catch (error: any) {
    console.error("[setup API error]:", error);
    // 보안: 내부 에러 상세(DB 제약/스키마 등)를 클라이언트에 노출하지 않음
    return NextResponse.json(
      { success: false, message: "관리자 계정 생성 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

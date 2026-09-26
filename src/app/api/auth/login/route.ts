import { NextRequest, NextResponse } from "next/server";
import {
  findUserByUsername,
  getLoginAttempts,
  recordLoginFailure,
  clearLoginFailures,
  LOGIN_RATE_LIMIT,
} from "@/lib/db";
import { verifyPassword, createAuthToken, AUTH_COOKIE_NAME } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { success: false, message: "아이디와 비밀번호를 모두 입력해주세요." },
        { status: 400 }
      );
    }

    const userKey = username.trim().toLowerCase();

    // 보안: 브루트포스 방어 - 일정 시간 내 실패 횟수 초과 시 시도 자체를 차단
    const attempts = await getLoginAttempts(userKey);
    if (attempts >= LOGIN_RATE_LIMIT.maxAttempts) {
      return NextResponse.json(
        {
          success: false,
          message: `로그인 시도가 너무 많습니다. ${LOGIN_RATE_LIMIT.windowMinutes}분 후 다시 시도해주세요.`,
        },
        { status: 429 }
      );
    }

    const user = await findUserByUsername(username.trim());
    if (!user) {
      await recordLoginFailure(userKey);
      return NextResponse.json(
        { success: false, message: "아이디 또는 비밀번호가 일치하지 않습니다." },
        { status: 401 }
      );
    }

    if (!user.is_active) {
      return NextResponse.json(
        { success: false, message: "비활성화된 계정입니다. 관리자에게 문의하세요." },
        { status: 403 }
      );
    }

    const isValid = verifyPassword(password, user.password);
    if (!isValid) {
      await recordLoginFailure(userKey);
      return NextResponse.json(
        { success: false, message: "아이디 또는 비밀번호가 일치하지 않습니다." },
        { status: 401 }
      );
    }

    await clearLoginFailures(userKey);

    const token = createAuthToken({
      id: user.id,
      username: user.username,
      nickname: user.nickname || user.username,
      isAdmin: Boolean(user.is_admin),
      isFirstLogin: Boolean(user.is_first_login),
    });

    const response = NextResponse.json({
      success: true,
      message: "로그인에 성공했습니다.",
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname || user.username,
        isAdmin: Boolean(user.is_admin),
        isFirstLogin: Boolean(user.is_first_login),
      },
    });

    response.cookies.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 86400,
      path: "/",
    });

    return response;
  } catch (error: any) {
    console.error("[login API error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json(
      { success: false, message: "로그인 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

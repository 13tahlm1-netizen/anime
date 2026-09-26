import { NextRequest, NextResponse } from "next/server";
import {
  getSessionUser,
  verifyPassword,
  hashPassword,
  createAuthToken,
  AUTH_COOKIE_NAME,
} from "@/lib/auth";
import { findUserByUsername, updateUserProfile } from "@/lib/db";

export async function PATCH(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json(
        { success: false, message: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { nickname, currentPassword, newPassword } = body;

    let passwordHash: string | undefined = undefined;

    if (newPassword) {
      if (!currentPassword) {
        return NextResponse.json(
          { success: false, message: "현재 비밀번호를 입력해주세요." },
          { status: 400 }
        );
      }
      
      if (typeof newPassword !== "string" || newPassword.length < 4) {
        return NextResponse.json(
          { success: false, message: "새 비밀번호는 최소 4자 이상이어야 합니다." },
          { status: 400 }
        );
      }

      const dbUser = await findUserByUsername(user.username);
      if (!dbUser) {
        return NextResponse.json(
          { success: false, message: "사용자 정보를 찾을 수 없습니다." },
          { status: 404 }
        );
      }

      const isValid = verifyPassword(currentPassword, dbUser.password);
      if (!isValid) {
        return NextResponse.json(
          { success: false, message: "현재 비밀번호가 일치하지 않습니다." },
          { status: 400 }
        );
      }

      passwordHash = hashPassword(newPassword);
    }

    const newNickname = nickname?.trim() || undefined;

    if (!newNickname && !passwordHash) {
      return NextResponse.json(
        { success: false, message: "변경할 내용이 없습니다." },
        { status: 400 }
      );
    }

    const success = await updateUserProfile(user.id, {
      nickname: newNickname,
      passwordHash,
    });

    if (!success) {
      return NextResponse.json(
        { success: false, message: "프로필 업데이트에 실패했습니다." },
        { status: 500 }
      );
    }

    const finalNickname = newNickname || user.nickname;

    let response = NextResponse.json({
      success: true,
      message: "프로필이 업데이트되었습니다.",
      user: {
        id: user.id,
        username: user.username,
        nickname: finalNickname,
        isAdmin: user.isAdmin,
      },
    });

    // 만약 비밀번호가 변경되었다면 새로운 토큰 발급 (isFirstLogin 해제 목적)
    if (passwordHash) {
      const newToken = createAuthToken({
        id: user.id,
        username: user.username,
        nickname: finalNickname,
        isAdmin: user.isAdmin,
        isFirstLogin: false,
      });

      response.cookies.set(AUTH_COOKIE_NAME, newToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 30 * 86400,
        path: "/",
      });
    }

    return response;
  } catch (error: any) {
    console.error("[profile API error]:", error);
    return NextResponse.json(
      { success: false, message: "프로필 업데이트 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

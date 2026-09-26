import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, hashPassword } from "@/lib/auth";
import { getAllUsers, createUser } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user || user.isAdmin !== true) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }

    const users = await getAllUsers();
    return NextResponse.json({ success: true, users });
  } catch (error: any) {
    console.error("[admin get all users error]:", error);
    return NextResponse.json({ success: false, message: "사용자 목록을 불러오는 중 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user || user.isAdmin !== true) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }

    const body = await request.json();
    const { username, tempPassword, nickname } = body;

    if (!username || typeof username !== "string" || username.trim() === "") {
      return NextResponse.json({ success: false, message: "아이디를 입력해주세요." }, { status: 400 });
    }

    if (!tempPassword || typeof tempPassword !== "string" || tempPassword.length < 4) {
      return NextResponse.json({ success: false, message: "임시 비밀번호는 최소 4자 이상이어야 합니다." }, { status: 400 });
    }

    try {
      const newUser = await createUser({
        username: username.trim(),
        passwordHash: hashPassword(tempPassword),
        nickname: nickname?.trim() || username.trim(),
        isAdmin: false,
        isFirstLogin: true,
      });

      return NextResponse.json({
        success: true,
        message: "계정이 생성되었습니다.",
        user: { id: newUser.id, username: newUser.username, nickname: newUser.nickname },
      });
    } catch (e: any) {
      if (e?.code === "23505" || e?.message?.includes("unique constraint")) {
        return NextResponse.json({ success: false, message: "이미 존재하는 아이디입니다." }, { status: 409 });
      }
      throw e;
    }
  } catch (error: any) {
    console.error("[admin create user error]:", error);
    return NextResponse.json({ success: false, message: "계정 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}

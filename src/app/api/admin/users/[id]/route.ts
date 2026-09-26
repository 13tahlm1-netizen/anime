import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, hashPassword } from "@/lib/auth";
import { toggleUserActive, resetUserPassword, deleteUser } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user || user.isAdmin !== true) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const targetUserId = parseInt(id, 10);
    if (isNaN(targetUserId)) {
      return NextResponse.json({ success: false, message: "잘못된 사용자 ID입니다." }, { status: 400 });
    }

    const body = await request.json();
    const { action } = body;

    if (action === "toggle_active") {
      if (user.id === targetUserId) {
        return NextResponse.json({ success: false, message: "자기 자신의 계정을 비활성화할 수 없습니다." }, { status: 400 });
      }
      const isActive = Boolean(body.isActive);
      const success = await toggleUserActive(targetUserId, isActive);
      if (success) {
        return NextResponse.json({ success: true, message: "계정 상태가 변경되었습니다." });
      }
    } else if (action === "reset_password") {
      const tempPassword = body.tempPassword;
      if (!tempPassword || typeof tempPassword !== "string" || tempPassword.length < 4) {
        return NextResponse.json({ success: false, message: "임시 비밀번호는 최소 4자 이상이어야 합니다." }, { status: 400 });
      }
      const success = await resetUserPassword(targetUserId, hashPassword(tempPassword));
      if (success) {
        return NextResponse.json({ success: true, message: "비밀번호가 초기화되었습니다." });
      }
    } else {
      return NextResponse.json({ success: false, message: "잘못된 요청입니다." }, { status: 400 });
    }

    return NextResponse.json({ success: false, message: "작업 처리에 실패했습니다." }, { status: 500 });
  } catch (error: any) {
    console.error("[admin patch user error]:", error);
    return NextResponse.json({ success: false, message: "작업 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user || user.isAdmin !== true) {
      return NextResponse.json({ success: false, message: "권한이 없습니다." }, { status: 403 });
    }

    const { id } = await params;
    const targetUserId = parseInt(id, 10);
    if (isNaN(targetUserId)) {
      return NextResponse.json({ success: false, message: "잘못된 사용자 ID입니다." }, { status: 400 });
    }

    if (user.id === targetUserId) {
      return NextResponse.json({ success: false, message: "자기 자신의 계정을 삭제할 수 없습니다." }, { status: 400 });
    }

    const success = await deleteUser(targetUserId);
    if (success) {
      return NextResponse.json({ success: true, message: "계정이 삭제되었습니다." });
    }

    return NextResponse.json({ success: false, message: "계정 삭제에 실패했습니다." }, { status: 500 });
  } catch (error: any) {
    console.error("[admin delete user error]:", error);
    return NextResponse.json({ success: false, message: "계정 삭제 중 오류가 발생했습니다." }, { status: 500 });
  }
}

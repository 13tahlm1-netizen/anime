import { NextResponse } from "next/server";
import { getUserCount } from "@/lib/db";

export async function GET() {
  try {
    const count = await getUserCount();
    return NextResponse.json({
      needsSetup: count === 0,
      userCount: count,
    });
  } catch (error: any) {
    console.error("[setup-status API error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json({ needsSetup: false }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getProviderByAnimeId } from "@/lib/providers";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  // 보안: 미인증 사용자가 서버를 무료 스크레이퍼로 악용하는 것을 방지
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id")?.trim();

  if (!id) {
    return NextResponse.json({ error: "Missing anime id" }, { status: 400 });
  }

  const provider = getProviderByAnimeId(id);
  const detail = await provider.getAnimeDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "Anime not found" }, { status: 404 });
  }

  const noCache = searchParams.get("nocache") === "1";
  return NextResponse.json(detail, {
    headers: {
      "Cache-Control": noCache
        ? "no-store"
        : "public, s-maxage=600, stale-while-revalidate=3600",
    },
  });
}

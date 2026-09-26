import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, getCurrentUserId } from "@/lib/auth";
import { getReanimeSubtitleSetting, setReanimeSubtitleSetting } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const animeId = searchParams.get("animeId") || searchParams.get("anime_id");
  const epStr = searchParams.get("ep") || searchParams.get("episode_number") || searchParams.get("episode");

  if (!animeId || !epStr) {
    return NextResponse.json({ success: false, message: "Missing animeId or ep" }, { status: 400 });
  }

  const epNum = parseInt(epStr, 10);
  if (isNaN(epNum)) {
    return NextResponse.json({ success: false, message: "Invalid ep number" }, { status: 400 });
  }

  const userId = await getCurrentUserId();
  const setting = await getReanimeSubtitleSetting(userId, animeId, epNum);

  return NextResponse.json(
    { success: true, setting },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const animeId = body.animeId || body.anime_id;
    const rawEp = body.ep !== undefined ? body.ep : body.episode_number !== undefined ? body.episode_number : body.episode;
    const rawSyncOffset = body.syncOffset !== undefined ? body.syncOffset : body.sync_offset;
    const subtitleName = body.subtitleName || body.subtitle_name;
    const subtitleUrl = body.subtitleUrl || body.subtitle_url;

    if (!animeId || rawEp === undefined) {
      return NextResponse.json({ success: false, message: "Missing required fields" }, { status: 400 });
    }

    const epNum = parseInt(String(rawEp), 10);
    const offsetVal = parseFloat(String(rawSyncOffset || 0.0));

    const userId = await getCurrentUserId();
    const ok = await setReanimeSubtitleSetting(
      userId,
      animeId,
      epNum,
      offsetVal,
      subtitleName || null,
      subtitleUrl || null
    );

    return NextResponse.json({ success: ok });
  } catch (e: any) {
    console.error("[reanime-sync POST error]:", e);
    return NextResponse.json({ success: false, message: e?.message || "Internal error" }, { status: 500 });
  }
}

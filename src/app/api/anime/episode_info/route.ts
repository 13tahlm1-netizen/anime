import { NextRequest, NextResponse } from "next/server";
import { getProviderByAnimeId } from "@/lib/providers";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  // 보안: 미인증 사용자가 2회 외부 스크래핑을 유도하는 것을 방지
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const animeId = searchParams.get("id")?.trim();
  const epNum = parseInt(searchParams.get("ep") || "1", 10) || 1;
  const isDub = searchParams.get("is_dub") === "1" || searchParams.get("is_dub") === "true";

  if (!animeId) {
    return NextResponse.json({ success: false, message: "Missing anime id" }, { status: 400 });
  }

  const provider = getProviderByAnimeId(animeId);
  const anime = await provider.getAnimeDetail(animeId);
  if (!anime) {
    return NextResponse.json({ success: false, message: "Anime not found" }, { status: 404 });
  }

  const epList = isDub ? anime.dub_episodes : anime.sub_episodes;

  // 보안: 클라이언트에서 ?url= 로 임의 URL을 지정해 서버를 프록시/SSRF 수단으로 쓰는 것을 막기 위해
  // 스트림 URL은 항상 서버가 스크래핑한 회차 목록에서만 해석합니다.
  const matched = epList.find((e) => e.number === epNum) || epList[0];
  const watchUrl = matched?.watch_url || "";

  if (!watchUrl) {
    return NextResponse.json({ success: false, message: "Watch URL not found" }, { status: 404 });
  }

  const streamInfo = await provider.getEpisodeStream(watchUrl);
  const playerRef = streamInfo?.player_url || "";
  const rawM3u8 = streamInfo?.m3u8_url || "";
  const rawVtt = streamInfo?.vtt_url || "";

  const proxiedM3u8 = rawM3u8
    ? `/api/anime/stream/m3u8?url=${encodeURIComponent(rawM3u8)}&ref=${encodeURIComponent(playerRef)}`
    : "";
  const proxiedVtt = rawVtt ? `/api/anime/stream/vtt?url=${encodeURIComponent(rawVtt)}` : "";

  let linkPre = "";
  let linkNext = "";
  let linkPreEpNum: number | null = null;
  let linkNextEpNum: number | null = null;
  let epTitle = `${epNum}화`;

  for (let idx = 0; idx < epList.length; idx++) {
    const e = epList[idx];
    if (e.number === epNum) {
      epTitle = e.title;
      if (idx > 0) {
        linkPre = epList[idx - 1].watch_url;
        linkPreEpNum = epList[idx - 1].number;
      }
      if (idx + 1 < epList.length) {
        linkNext = epList[idx + 1].watch_url;
        linkNextEpNum = epList[idx + 1].number;
      }
      break;
    }
  }

  const noCache = searchParams.get("nocache") === "1";
  return NextResponse.json(
    {
      success: true,
      anime_id: animeId,
      anime_title: anime.title,
      episode_number: epNum,
      episode_title: epTitle,
      watch_url: watchUrl,
      proxied_m3u8: proxiedM3u8,
      proxied_vtt: proxiedVtt,
      m3u8_url: proxiedM3u8,
      vtt_url: proxiedVtt,
      link_pre: linkPre,
      link_next: linkNext,
      link_pre_ep_num: linkPreEpNum,
      link_next_ep_num: linkNextEpNum,
      is_dub: isDub,
      server_sources: streamInfo?.server_sources || [],
    },
    {
      headers: {
        "Cache-Control": noCache
          ? "no-store"
          : "public, s-maxage=1800, stale-while-revalidate=3600",
      },
    }
  );
}

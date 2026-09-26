import { NextRequest, NextResponse } from "next/server";
import {
  getProvider,
  LINKKF_GENRES,
  LINKKF_YEARS,
  LINKKF_TYPES,
  REANIME_GENRES,
} from "@/lib/providers";
import { OHLI24_GENRES } from "@/lib/providers/ohli24";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  // 보안: 미인증 사용자가 서버를 무료 스크레이퍼로 악용하는 것을 방지
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const source = searchParams.get("source") || "anissia";
  const provider = getProvider(source);

  const q = searchParams.get("q")?.trim() || "";
  const tab = searchParams.get("tab") || "airing";
  const page = parseInt(searchParams.get("page") || "1", 10) || 1;
  const section = searchParams.get("section") || "2";
  const genre = searchParams.get("genre") || "";
  const year = searchParams.get("year") || "";
  const typeLang = searchParams.get("type") || "";
  const period = (searchParams.get("period") || "day") as "day" | "week" | "month" | "all";

  let result;
  if (q) {
    result = await provider.searchAnime(q, page);
  } else if (source === "reanime") {
    const category = (
      tab === "trending"
        ? "trending"
        : tab === "top"
        ? "top"
        : tab === "upcoming"
        ? "upcoming"
        : tab === "finished"
        ? "finished"
        : "airing"
    ) as "airing" | "top" | "upcoming" | "finished" | "trending";
    result = await provider.getAnimeList({ category, page, genre });
  } else if (tab === "list") {
    result = await provider.getAnimeListFiltered({ section, genre, year, typeLang, page });
  } else if (tab === "top") {
    result = await provider.getAnimeList({ category: "top", page, period });
  } else {
    // Default 'airing'
    result = await provider.getAnimeListFiltered({ section: "2", page, category: "airing" });
  }

  const noCache = searchParams.get("nocache") === "1";
  const cacheControl =
    noCache || q
      ? "no-store"
      : "public, s-maxage=300, stale-while-revalidate=600";

  const isReanime = source === "reanime";
  const isOhli24 = source === "ohli24";
  return NextResponse.json(
    {
      ...result,
      source,
      tab,
      filters: {
        genres: isReanime ? REANIME_GENRES : isOhli24 ? OHLI24_GENRES : LINKKF_GENRES,
        years: isOhli24 || isReanime ? [] : LINKKF_YEARS,
        types: isOhli24 || isReanime ? [] : LINKKF_TYPES,
      },
    },
    {
      headers: {
        "Cache-Control": cacheControl,
      },
    }
  );
}

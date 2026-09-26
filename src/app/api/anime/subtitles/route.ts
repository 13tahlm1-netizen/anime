import { NextRequest, NextResponse } from "next/server";
import {
  searchAllSubtitlesParallel,
  findKairanSubtitle,
  fetchCreatorSubtitle,
  resolveKoreanTitle,
} from "@/lib/subtitles";
import { assertSafeProxyUrl, UnsafeProxyUrlError } from "@/lib/proxyGuard";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  // 보안: 미인증 사용자가 서버를 오픈 크롤링/퍼치 서비스로 악용하는 것을 방지
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const title = searchParams.get("title")?.trim();
  const ep = parseInt(searchParams.get("ep") || "1", 10) || 1;
  const animeIdParam = searchParams.get("animeId") || searchParams.get("animeNo") || "";
  let directAnimeNo: number | null = null;
  if (animeIdParam) {
    const rawNo = animeIdParam.replace(/^ani_/, "");
    const parsed = parseInt(rawNo, 10);
    if (!isNaN(parsed) && parsed > 0) {
      directAnimeNo = parsed;
    }
  }

  const website = searchParams.get("website")?.trim() || searchParams.get("sub_url")?.trim() || "";
  const creatorName = searchParams.get("creatorName")?.trim() || searchParams.get("creator")?.trim() || "";

  if (!title) {
    return NextResponse.json(
      { success: false, message: "Missing anime title parameter" },
      { status: 400 }
    );
  }

  try {
    const resolvedTitle = await resolveKoreanTitle(title);
    const searchTarget = resolvedTitle || title;

    // 0순위: 애니시아에서 이미 파악된 자막 블로그 링크가 직통으로 넘어온 경우 (초고속 직통 모드)
    if (website && website.startsWith("http")) {
      const directSub = await fetchCreatorSubtitle(creatorName || "제작자", website, searchTarget, ep, 5000);
      if (directSub && directSub.content) {
        return NextResponse.json({
          success: true,
          anime_title: title,
          resolved_title: resolvedTitle,
          episode: ep,
          count: 1,
          subtitles: [directSub],
          creators: creatorName ? [{
            name: creatorName,
            episode: String(ep),
            update_date: "",
            website,
            is_current_ep: true,
          }] : [],
        }, {
          status: 200,
          headers: {
            "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=43200",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }

    // 13초 타임아웃 방어 가드 적용 (directAnimeNo 지원)
    const result = await searchAllSubtitlesParallel(searchTarget, ep, 13000, directAnimeNo);

    // HTML 등 비정상 자막 필터링
    const validSubtitles = (result.subtitles || []).filter((s) => {
      if (!s.content) return false;
      const lower = s.content.slice(0, 300).toLowerCase();
      if (lower.includes("<!doctype html") || lower.includes("<html") || lower.includes("<head>")) {
        return false;
      }
      return true;
    });

    return NextResponse.json(
      {
        success: true,
        anime_title: title,
        resolved_title: resolvedTitle,
        episode: ep,
        count: validSubtitles.length,
        subtitles: validSubtitles,
        creators: result.creators,
      },
      {
        status: 200,
        headers: {
          // 자막이 실제로 있을 때만 Vercel Edge CDN에 24시간 캐싱
          // (검색 타임아웃 등으로 빈 결과가 24시간 캐시되면 재방문 시 자막 검색이 영구 실패함)
          "Cache-Control":
            validSubtitles.length > 0
              ? "public, s-maxage=86400, stale-while-revalidate=43200"
              : "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("[Subtitles API error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json(
      { success: false, message: "자막 검색에 실패했습니다." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // 보안: 미인증 사용자가 서버를 오픈 크롤링/퍼치 서비스로 악용하는 것을 방지
  const user = await getSessionUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = await request.json();
    const { creatorName, website, title, episodeNumber } = body;
    const ep = parseInt(String(episodeNumber || "1"), 10) || 1;

    if (!creatorName || !title) {
      return NextResponse.json(
        { success: false, message: "필수 정보가 누락되었습니다." },
        { status: 400 }
      );
    }

    // 보안: website는 서버에서 fetch하므로 SSRF 가드 통과 필수
    if (website) {
      try {
        await assertSafeProxyUrl(String(website));
      } catch (e) {
        if (e instanceof UnsafeProxyUrlError) {
          return NextResponse.json(
            { success: false, message: `허용되지 않는 주소입니다: ${e.message}` },
            { status: 400 }
          );
        }
        throw e;
      }
    }

    const resolvedTitle = await resolveKoreanTitle(title);
    const targetTitle = resolvedTitle || title;

    const isErusha = creatorName.includes("에루샤") || (website && website.toLowerCase().includes("erulabo"));
    if (isErusha) {
      return NextResponse.json({
        success: false,
        message: "에루샤 님의 배포처(erulabo.com)는 Cloudflare 보안 캡차가 적용되어 있어 자동 추출이 지원되지 않습니다. 블로그에서 직접 다운로드해 주세요.",
      });
    }

    let sub = null;
    if (creatorName.includes("카이란") || (website && website.toLowerCase().includes("kairan"))) {
      sub = await findKairanSubtitle(targetTitle, ep, 5000);
    } else if (website) {
      sub = await fetchCreatorSubtitle(creatorName, website, targetTitle, ep, 5000);
    }

    if (!sub || !sub.content) {
      return NextResponse.json({
        success: false,
        message: "해당 제작자 블로그에서 자막을 자동으로 추출하지 못했습니다.",
      });
    }

    // HTML 응답 필터링
    const lower = sub.content.slice(0, 300).toLowerCase();
    if (lower.includes("<!doctype html") || lower.includes("<html") || lower.includes("<head>")) {
      return NextResponse.json({
        success: false,
        message: "유효하지 않은 자막 파일 형식입니다.",
      });
    }

    return NextResponse.json({
      success: true,
      subtitle: sub,
    });
  } catch (error) {
    console.error("[Subtitles POST error]:", error);
    // 보안: 내부 에러 상세를 클라이언트에 노출하지 않음
    return NextResponse.json(
      { success: false, message: "자막 추출 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}


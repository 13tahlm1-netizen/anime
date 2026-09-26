import * as cheerio from "cheerio";
import { getOhli24BaseUrl, DEFAULT_OHLI24_URL } from "@/lib/db";
import {
  AnimeDetail,
  AnimeListFilterParams,
  AnimeListItem,
  AnimeListResponse,
  AnimeProvider,
  EpisodeItem,
  EpisodeStreamInfo,
  ServerSource,
} from "./types";
import { OHLI24_PREFIX, stripOhli24Id, toOhli24Id } from "./index";

export const BASE_URL = DEFAULT_OHLI24_URL;

export async function getBaseUrl(): Promise<string> {
  return await getOhli24BaseUrl();
}

export const OHLI24_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://www.ohli24.net/",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
};

export const OHLI24_GENRES: [string, string][] = [
  ["판타지", "판타지"],
  ["이세계", "이세계"],
  ["모험", "모험"],
  ["액션", "액션"],
  ["일상", "일상"],
  ["로맨스", "로맨스"],
  ["코미디", "코미디"],
  ["학원", "학원"],
  ["SF", "SF"],
  ["미스터리", "미스터리"],
  ["스릴러", "스릴러"],
  ["하렘", "하렘"],
  ["먼치킨", "먼치킨"],
  ["드라마", "드라마"],
  ["스포츠", "스포츠"],
  ["음악", "음악"],
  ["메카닉", "메카닉"],
  ["공포", "공포"],
  ["순정", "순정"],
  ["BL", "BL"],
  ["백합", "백합"],
];

// In-memory caches with timestamps
const detailCache: Record<string, { data: AnimeDetail; timestamp: number }> = {};
const streamCache: Record<string, { data: EpisodeStreamInfo; timestamp: number }> = {};
// 애니메이션 ID -> 상세 경로(/58730/제목.html) 매핑 캐시
const slugPathCache: Record<string, string> = {};

export function normalizeImageUrl(url: string | null | undefined, customBaseUrl?: string): string {
  if (!url || url.includes("loading.gif")) return "";
  const trimmed = url.trim();
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `${customBaseUrl || BASE_URL}${trimmed}`;
  return trimmed;
}

export function extractOhli24Id(href: string): string {
  if (!href) return "";
  const clean = href.replace(/\/+$/, "");
  const m = clean.match(/\/(\d+)(?:\/|$)/);
  if (m) return m[1];
  return clean.split("/").pop()?.replace(/\.html.*$/, "") || "";
}

function parseShowItems($: cheerio.CheerioAPI, baseUrl: string): AnimeListItem[] {
  const items: AnimeListItem[] = [];

  $("div.show-item").each((_, el) => {
    const aEl = $(el).find("a.show-item-img-link, a.show-item-tile-link, a[href*='.html']").first();
    const href = aEl.attr("href")?.trim() || "";
    const rawId = extractOhli24Id(href);
    if (!rawId) return;

    // slug 경로 캐싱
    if (href.startsWith("/")) {
      slugPathCache[rawId] = href;
    }

    const titleEl = $(el).find("h3.show-item-title, .show-item-title").first();
    let title = titleEl.text().trim();
    if (!title) {
      title = aEl.attr("title")?.trim() || $(el).find("img").attr("title")?.trim() || `애니메이션 ${rawId}`;
    }

    const imgEl = $(el).find("img").first();
    const rawImg = imgEl.attr("data-original") || imgEl.attr("src") || "";
    const poster = normalizeImageUrl(rawImg, baseUrl);

    const epsText = $(el).find(".show-item-eps").first().text().trim();
    const catTag = $(el).find(".cat-tag").first().text().trim();
    const updateTag = $(el).find(".update-tag").first().text().trim();
    const remarks = epsText || catTag || updateTag || "";

    const fullId = toOhli24Id(rawId);

    items.push({
      id: fullId,
      title,
      poster,
      detail_url: `/anime/${fullId}`,
      remarks,
    });
  });

  return items;
}

function parsePagination($: cheerio.CheerioAPI, currentPage: number): { hasNext: boolean; totalPages: number } {
  let maxPage = currentPage;
  $("ul.page-numbers a.page-numbers, ul.page-numbers li a, a[href*='page-']").each((_, a) => {
    const txt = $(a).text().trim();
    const p = parseInt(txt, 10);
    if (!isNaN(p) && p > maxPage) {
      maxPage = p;
    }
    const href = $(a).attr("href") || "";
    const m = href.match(/page-(\d+)/);
    if (m) {
      const hp = parseInt(m[1], 10);
      if (hp > maxPage) maxPage = hp;
    }
  });

  return {
    hasNext: maxPage > currentPage,
    totalPages: maxPage,
  };
}

export async function getAnimeList(params: {
  category?: "recent_caption" | "airing" | "top" | "movie" | "finished" | "trending" | "upcoming";
  page?: number;
  genre?: string;
  period?: "day" | "week" | "month" | "all";
}): Promise<AnimeListResponse> {
  const { category: rawCategory = "airing", page = 1, genre = "" } = params;
  const category = rawCategory === "recent_caption" ? "airing" : rawCategory;
  const baseUrl = await getBaseUrl();
  let url: string;

  if (genre) {
    const encoded = encodeURIComponent(genre.trim());
    url = page > 1
      ? `${baseUrl}/search/keyword-${encoded}-page-${page}.html`
      : `${baseUrl}/search/keyword-${encoded}.html`;
  } else if (category === "finished") {
    url = page > 1 ? `${baseUrl}/finished-page-${page}.html` : `${baseUrl}/finished`;
  } else if (category === "movie") {
    url = page > 1 ? `${baseUrl}/movie-page-${page}.html` : `${baseUrl}/movie`;
  } else {
    // airing 또는 top
    url = page > 1 ? `${baseUrl}/ing-page-${page}.html` : `${baseUrl}/ing`;
  }

  try {
    const headers = { ...OHLI24_HEADERS, Referer: `${baseUrl}/` };
    const res = await fetch(url, { headers, next: { revalidate: 60 } });
    if (!res.ok) {
      return { items: [], page, has_next: false, total_pages: 1 };
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const items = parseShowItems($, baseUrl);
    const { hasNext, totalPages } = parsePagination($, page);

    return {
      items,
      page,
      has_next: hasNext || items.length >= 24,
      total_pages: totalPages,
    };
  } catch (error) {
    console.error("[Ohli24] getAnimeList error:", error);
    return { items: [], page, has_next: false, total_pages: 1 };
  }
}

export async function getAnimeListFiltered(params: AnimeListFilterParams): Promise<AnimeListResponse> {
  const { genre = "", page = 1, category = "airing" } = params;
  return await getAnimeList({ category, page, genre });
}

export async function searchAnime(keyword: string, page = 1): Promise<AnimeListResponse> {
  const trimmed = keyword.trim();
  if (!trimmed) {
    return { items: [], page: 1, has_next: false, total_pages: 1 };
  }

  const encoded = encodeURIComponent(trimmed);
  const baseUrl = await getBaseUrl();
  const url = page > 1
    ? `${baseUrl}/search/keyword-${encoded}-page-${page}.html`
    : `${baseUrl}/search/keyword-${encoded}.html`;

  try {
    const headers = { ...OHLI24_HEADERS, Referer: `${baseUrl}/` };
    const res = await fetch(url, { headers, next: { revalidate: 60 } });
    if (!res.ok) {
      return { items: [], page, has_next: false, total_pages: 1 };
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const items = parseShowItems($, baseUrl);
    const { hasNext, totalPages } = parsePagination($, page);

    return {
      items,
      page,
      has_next: hasNext,
      total_pages: totalPages,
    };
  } catch (error) {
    console.error("[Ohli24] searchAnime error:", error);
    return { items: [], page, has_next: false, total_pages: 1 };
  }
}

export async function getAnimeDetail(animeId: string): Promise<AnimeDetail | null> {
  const fullId = toOhli24Id(animeId);
  const rawId = stripOhli24Id(animeId);

  const cached = detailCache[fullId];
  if (cached && Date.now() - cached.timestamp < 300_000) {
    return cached.data;
  }

  const baseUrl = await getBaseUrl();

  // 1. 상세 페이지 URL 후보 결정
  const candidateUrls: string[] = [];
  if (slugPathCache[rawId]) {
    candidateUrls.push(`${baseUrl}${slugPathCache[rawId]}`);
  }
  candidateUrls.push(`${baseUrl}/index.php?s=video&c=show&id=${rawId}`);
  candidateUrls.push(`${baseUrl}/${rawId}/`);

  let html = "";
  let finalUrl = "";

  for (const testUrl of candidateUrls) {
    try {
      const headers = { ...OHLI24_HEADERS, Referer: `${baseUrl}/` };
      const res = await fetch(testUrl, {
        headers,
        redirect: "follow",
        next: { revalidate: 120 },
      });
      if (res.ok) {
        const text = await res.text();
        if (text.includes("article-box") || text.includes("eps-box") || text.includes("movie-coment")) {
          html = text;
          finalUrl = res.url || testUrl;
          break;
        }
      }
    } catch {}
  }

  if (!html) return null;

  try {
    const $ = cheerio.load(html);

    // 제목 파싱
    let title = $(".top-movies-list-title h2").first().text().trim();
    if (!title) {
      title = $(".breadcrumb li:last-child span, h1.title, h2.title").first().text().trim();
    }
    // "13화" 등 회차 명칭이 붙어있으면 제거
    title = title.replace(/\s+\d+화$/, "");

    // 포스터 파싱
    const imgEl = $(".article-box-img img, .article-box img, .detail-img img").first();
    const rawImg = imgEl.attr("data-original") || imgEl.attr("src") || "";
    const poster = normalizeImageUrl(rawImg, baseUrl);

    // 줄거리 파싱
    const descEl = $(".movie-coment p, .movie-coment, .article-box-desc").first();
    const description = descEl.text().trim();

    // 메타데이터(장르, 연도, 상태) 파싱
    const genres: string[] = [];
    let yearText = "";
    let statusText = "";

    $(".article-box-meta ul li, .article-box-meta li").each((_, li) => {
      const txt = $(li).text().trim();
      if (txt.includes("장르:")) {
        const rawG = txt.replace("장르:", "").trim();
        rawG.split(",").forEach((g) => {
          const cleanG = g.trim();
          if (cleanG) genres.push(cleanG);
        });
      } else if (txt.includes("방영일:")) {
        const m = txt.match(/(\d{4})/);
        if (m) yearText = m[1];
      } else if (txt.includes("총화수:")) {
        statusText = txt.replace("총화수:", "").trim();
      }
    });

    const isFinished = statusText.includes("완결") || $(".cat-tag").text().includes("완결");

    // 에피소드 파싱 (div.eps-box div.eps-item a)
    const subEpisodes: EpisodeItem[] = [];

    $(".eps-box .eps-item a, .eps-box a.text-default").each((_, a) => {
      const epText = $(a).clone().children().remove().end().text().trim();
      const href = $(a).attr("href")?.trim() || "";
      if (!href) return;

      const watchUrl = href.startsWith("http") ? href : `${baseUrl}${href.startsWith("/") ? href : `/${href}`}`;
      const m = epText.match(/\d+/);
      const epNum = m ? parseInt(m[0], 10) : 1;

      subEpisodes.push({
        number: epNum,
        title: epText.includes("화") ? epText : `${epNum}화`,
        watch_url: watchUrl,
      });
    });

    // 번호 기준 오름차순 정렬
    subEpisodes.sort((a, b) => a.number - b.number);

    const detail: AnimeDetail = {
      id: fullId,
      title,
      poster,
      description,
      genres,
      sub_episodes: subEpisodes,
      dub_episodes: [], // Ohli24는 기본 단일 통합 트랙
      total_episodes: subEpisodes.length,
      status_text: statusText || (isFinished ? "완결" : "방영중"),
      year: yearText,
      is_finished: isFinished,
    };

    detailCache[fullId] = { data: detail, timestamp: Date.now() };
    return detail;
  } catch (error) {
    console.error("[Ohli24] getAnimeDetail parsing error:", error);
    return null;
  }
}

export async function getEpisodeStream(watchUrl: string): Promise<EpisodeStreamInfo | null> {
  const cached = streamCache[watchUrl];
  if (cached && Date.now() - cached.timestamp < 1_800_000) {
    return cached.data;
  }

  const baseUrl = await getBaseUrl();

  try {
    const headers = { ...OHLI24_HEADERS, Referer: `${baseUrl}/` };
    const res = await fetch(watchUrl, { headers, next: { revalidate: 300 } });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    // 회차 페이지 내 iframe(플레이어) 태그 탐색
    const iframeEl = $("div.play-box iframe, iframe#video, iframe").first();
    const iframeSrc = iframeEl.attr("src")?.trim() || "";
    if (!iframeSrc) {
      console.warn("[Ohli24] No player iframe found on", watchUrl);
      return null;
    }

    const playerUrl = iframeSrc.startsWith("//") ? `https:${iframeSrc}` : iframeSrc;
    const playerObj = new URL(playerUrl);
    const iframeHost = playerObj.origin;

    // ID/Hash 추출 (예: /video/fec73528cd9681706631f08c0f166dae)
    const hash = playerUrl.split("/").pop()?.replace(/[^a-zA-Z0-9_-]/g, "") || "";
    if (!hash) {
      console.warn("[Ohli24] Could not extract video hash from iframe src:", playerUrl);
      return null;
    }

    // getVideo API 호출 (Phase 0에서 검증된 파이프라인)
    const getVideoUrl = `${iframeHost}/player/index.php?data=${hash}&do=getVideo`;
    const postHeaders: Record<string, string> = {
      "User-Agent": OHLI24_HEADERS["User-Agent"],
      "X-Requested-With": "XMLHttpRequest",
      Referer: playerUrl,
      Origin: iframeHost,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    };

    const postBody = new URLSearchParams({
      hash,
      r: watchUrl,
    }).toString();

    const videoRes = await fetch(getVideoUrl, {
      method: "POST",
      headers: postHeaders,
      body: postBody,
    });

    if (!videoRes.ok) {
      console.error("[Ohli24] getVideo upstream failed:", videoRes.status, videoRes.statusText);
      return null;
    }

    const videoData = await videoRes.json();
    // FirePlayer(michealcdn)의 securedLink는 발급 서버 IP에 바인딩된 토큰(Nginx secure_link)이므로
    // Vercel 멀티 인스턴스 환경에서 프록시 요청 시 403 Forbidden이 발생합니다.
    // 반면 videoSource는 토큰 없는 master.txt 주소이며, 공식 FirePlayer 플레이어에서도 jData.videoSource를 사용합니다.
    let m3u8Url = (videoData.videoSource as string) || (videoData.securedLink as string) || "";
    if (!m3u8Url) {
      console.warn("[Ohli24] No video source found in getVideo response:", videoData);
      return null;
    }

    if (m3u8Url.startsWith("//")) {
      m3u8Url = `https:${m3u8Url}`;
    } else if (m3u8Url.startsWith("/")) {
      m3u8Url = `${iframeHost}${m3u8Url}`;
    }

    const serverSources: ServerSource[] = [
      { label: "Ohli24 HD", player_url: playerUrl },
    ];

    const result: EpisodeStreamInfo = {
      success: true,
      m3u8_url: m3u8Url,
      vtt_url: "",
      player_url: playerUrl,
      server_sources: serverSources,
      link_next: "",
      link_pre: "",
      vod_data: videoData,
    };

    streamCache[watchUrl] = { data: result, timestamp: Date.now() };
    return result;
  } catch (error) {
    console.error("[Ohli24] getEpisodeStream error:", error);
    return null;
  }
}

export const ohli24Provider: AnimeProvider = {
  name: "ohli24",
  displayName: "Ohli24",
  getBaseUrl,
  getAnimeListFiltered,
  getAnimeList,
  searchAnime,
  getAnimeDetail,
  getEpisodeStream,
};

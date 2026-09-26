import * as cheerio from "cheerio";
import { getLinkkfBaseUrl, DEFAULT_LINKKF_URL } from "@/lib/db";
import {
  AnimeDetail,
  AnimeListItem,
  AnimeListResponse,
  AnimeProvider,
  EpisodeItem,
  EpisodeStreamInfo,
  ServerSource,
} from "./types";

export const BASE_URL = DEFAULT_LINKKF_URL;

export async function getBaseUrl(): Promise<string> {
  return await getLinkkfBaseUrl();
}

export const LINKKF_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Referer: "https://linkkf.tv/",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
};

export const LINKKF_GENRES: [string, string][] = [
  ["Action", "액션"],
  ["Fantasy", "판타지"],
  ["Romance", "로맨스"],
  ["Comedy", "코미디"],
  ["Slice of Life", "일상"],
  ["Sci-Fi", "SF"],
  ["School", "학원"],
  ["Mystery", "미스터리"],
  ["Adventure", "모험"],
  ["Supernatural", "초자연"],
  ["Drama", "드라마"],
  ["Horror", "공포"],
  ["Suspense", "스릴러"],
  ["Sports", "스포츠"],
  ["Music", "음악"],
  ["Gourmet", "요리"],
  ["Military", "밀리터리"],
  ["Webtoon", "웹툰"],
  ["Shounen", "소년"],
  ["Seinen", "청년"],
  ["Shoujo", "순정"],
  ["Boys Love", "BL"],
  ["Girls Love", "백합"],
  ["Avant Garde", "아방가르드"],
  ["CN Animation", "중국애니"],
];

const CURRENT_YEAR = new Date().getFullYear();
export const LINKKF_YEARS: string[] = Array.from(
  { length: Math.max(1, CURRENT_YEAR - 1989) },
  (_, i) => String(CURRENT_YEAR - i)
);

export const LINKKF_TYPES: [string, string][] = [
  ["TV", "TV 시리즈"],
  ["Movie", "Movie 극장판"],
  ["OVA", "OVA"],
];

// In-memory caches with timestamps
const detailCache: Record<string, { data: AnimeDetail; timestamp: number }> = {};
const streamCache: Record<string, { data: EpisodeStreamInfo; timestamp: number }> = {};

export function normalizeImageUrl(url: string | null | undefined, customBaseUrl?: string): string {
  if (!url || url.includes("loading.gif")) return "";
  const trimmed = url.trim();
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `${customBaseUrl || BASE_URL}${trimmed}`;

  const proxyPrefixes = ["/370x/", "/550x/", "/600x/", "/720x/"];
  for (const prefix of proxyPrefixes) {
    if (trimmed.includes(prefix)) {
      const idx = trimmed.indexOf(prefix);
      const orig = trimmed.slice(idx + prefix.length);
      if (orig.startsWith("http://") || orig.startsWith("https://")) {
        return orig;
      }
    }
  }
  return trimmed;
}

export function extractAnimeId(href: string): string {
  if (!href) return "";
  const clean = href.replace(/\/+$/, "");
  const m = clean.match(/\/(?:ani|view|movie|vod)\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return clean.split("/").pop() || "";
}

export async function getAnimeListFiltered(params: {
  section?: string;
  genre?: string;
  year?: string;
  typeLang?: string;
  page?: number;
}): Promise<AnimeListResponse> {
  const { section = "2", genre = "", year = "", typeLang = "", page = 1 } = params;
  const baseUrl = await getBaseUrl();
  const parts = [`/list/${section || "2"}/`];

  if (genre) parts.push(`class/${encodeURIComponent(genre.trim())}/`);
  if (year) parts.push(`year/${encodeURIComponent(year.trim())}/`);
  if (typeLang) parts.push(`lang/${encodeURIComponent(typeLang.trim())}/`);
  if (page > 1) parts.push(`page/${page}/`);

  const path = parts.join("").replace(/\/+/g, "/");
  const url = `${baseUrl}${path}`;

  try {
    const headers = { ...LINKKF_HEADERS, Referer: `${baseUrl}/` };
    const res = await fetch(url, { headers, next: { revalidate: 60 } });
    if (!res.ok) {
      return { items: [], page, has_next: false, total_pages: 1 };
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const items: AnimeListItem[] = [];

    $("div.vod-item").each((_, el) => {
      const titleEl = $(el).find("h3.vod-item-title a, h3 a, a.search-title").first();
      if (!titleEl.length) return;

      const title = titleEl.text().trim();
      const href = titleEl.attr("href")?.trim() || "";
      const animeId = extractAnimeId(href);

      const imgEl = $(el).find(".img-wrapper, img").first();
      const rawImg = imgEl.attr("data-original") || imgEl.attr("src") || "";
      const poster = normalizeImageUrl(rawImg, baseUrl);

      const remarksEl = $(el).find(".vod-item-score, .vod-item-status, .item-status, .item-label").first();
      const remarks = remarksEl.text().trim();

      items.push({
        id: animeId,
        title,
        poster,
        detail_url: `/anime/${animeId}`,
        remarks,
      });
    });

    let maxPage = page;
    $("a[href*='/page/']").each((_, a) => {
      const href = $(a).attr("href") || "";
      const m = href.match(/\/page\/(\d+)/);
      if (m) {
        const p = parseInt(m[1], 10);
        if (p > maxPage) maxPage = p;
      }
    });

    const numText = $(".ewave-page .num, .num").first().text().trim();
    const numMatch = numText.match(/\/(\d+)/);
    if (numMatch) {
      const p = parseInt(numMatch[1], 10);
      if (p > maxPage) maxPage = p;
    }

    const hasNext = maxPage > page || items.length === 30;
    return {
      items,
      page,
      has_next: hasNext,
      total_pages: maxPage,
    };
  } catch (error) {
    console.error("[Linkkf] getAnimeListFiltered error:", error);
    return { items: [], page, has_next: false, total_pages: 1 };
  }
}

export async function getAnimeList(params: {
  category?: "recent_caption" | "airing" | "top" | "movie" | "finished";
  page?: number;
  genre?: string;
  period?: "day" | "week" | "month" | "all";
}): Promise<AnimeListResponse> {
  const { category: rawCategory = "airing", page = 1, genre = "", period = "day" } = params;
  const category = rawCategory === "recent_caption" ? "airing" : rawCategory;
  const baseUrl = await getBaseUrl();
  let url = `${baseUrl}/list/2/`;

  if (category === "top") {
    if (period === "week") url = `${baseUrl}/label/week/`;
    else if (period === "month") url = `${baseUrl}/label/month/`;
    else if (period === "all") url = `${baseUrl}/label/view/`;
    else url = `${baseUrl}/label/topday/`;
  } else if (category === "movie") {
    url = page > 1 ? `${baseUrl}/list/2/lang/Movie/page/${page}/` : `${baseUrl}/list/2/lang/Movie/`;
  } else if (genre) {
    const encodedGenre = encodeURIComponent(genre.trim());
    url = page > 1 ? `${baseUrl}/list/2/class/${encodedGenre}/page/${page}/` : `${baseUrl}/list/2/class/${encodedGenre}/`;
  } else {
    url = page > 1 ? `${baseUrl}/list/2/page/${page}/` : `${baseUrl}/list/2/`;
  }

  try {
    const res = await fetch(url, { headers: LINKKF_HEADERS, next: { revalidate: 60 } });
    if (!res.ok) {
      return { items: [], page, has_next: false, total_pages: 1 };
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const items: AnimeListItem[] = [];

    $("div.vod-item").each((idx, el) => {
      const titleEl = $(el).find("h3.vod-item-title a, h3 a, a.search-title").first();
      if (!titleEl.length) return;

      const title = titleEl.text().trim();
      const href = titleEl.attr("href")?.trim() || "";
      const animeId = extractAnimeId(href);

      const imgEl = $(el).find(".img-wrapper, img").first();
      const rawImg = imgEl.attr("data-original") || imgEl.attr("src") || "";
      const poster = normalizeImageUrl(rawImg);

      const remarksEl = $(el).find(".vod-item-score, .vod-item-status, .item-status, .item-label").first();
      let remarks = remarksEl.text().trim();
      const rank = category === "top" ? idx + 1 : null;
      if (category === "top" && !remarks) {
        remarks = `${rank}위`;
      }

      items.push({
        id: animeId,
        title,
        poster,
        detail_url: `/anime/${animeId}`,
        remarks,
        rank,
      });
    });

    let maxPage = page;
    $("a[href*='/page/']").each((_, a) => {
      const href = $(a).attr("href") || "";
      const m = href.match(/\/page\/(\d+)/);
      if (m) {
        const p = parseInt(m[1], 10);
        if (p > maxPage) maxPage = p;
      }
    });

    const numText = $(".ewave-page .num, .num").first().text().trim();
    const numMatch = numText.match(/\/(\d+)/);
    if (numMatch) {
      const p = parseInt(numMatch[1], 10);
      if (p > maxPage) maxPage = p;
    }

    const hasNext = maxPage > page || (items.length === 30 && category !== "top");
    return {
      items,
      page,
      has_next: hasNext,
      total_pages: maxPage,
    };
  } catch (error) {
    console.error("[Linkkf] getAnimeList error:", error);
    return { items: [], page, has_next: false, total_pages: 1 };
  }
}

export async function searchAnime(keyword: string, page = 1): Promise<AnimeListResponse> {
  const trimmed = keyword.trim();
  if (!trimmed) {
    return { items: [], page: 1, has_next: false, total_pages: 1 };
  }

  const encoded = encodeURIComponent(trimmed);
  const baseUrl = await getBaseUrl();
  const url = page > 1
    ? `${baseUrl}/view/page/${page}/wd/${encoded}/`
    : `${baseUrl}/view/wd/${encoded}/`;

  try {
    const headers = { ...LINKKF_HEADERS, Referer: `${baseUrl}/` };
    const res = await fetch(url, { headers, next: { revalidate: 60 } });
    if (!res.ok) {
      return { items: [], page, has_next: false, total_pages: 1 };
    }

    const html = await res.text();
    const $ = cheerio.load(html);
    const items: AnimeListItem[] = [];

    $("div.vod-item").each((_, el) => {
      const titleEl = $(el).find("h3.vod-item-title a, h3 a, a.search-title").first();
      if (!titleEl.length) return;

      const title = titleEl.text().trim();
      const href = titleEl.attr("href")?.trim() || "";
      const animeId = extractAnimeId(href);

      const imgEl = $(el).find(".img-wrapper, img").first();
      const rawImg = imgEl.attr("data-original") || imgEl.attr("src") || "";
      const poster = normalizeImageUrl(rawImg, baseUrl);

      const remarksEl = $(el).find(".vod-item-score, .vod-item-status, .item-status, .item-label").first();
      const remarks = remarksEl.text().trim();

      items.push({
        id: animeId,
        title,
        poster,
        detail_url: `/anime/${animeId}`,
        remarks,
      });
    });

    let maxPage = page;
    $("a[href*='/page/']").each((_, a) => {
      const href = $(a).attr("href") || "";
      const m = href.match(/\/page\/(\d+)/);
      if (m) {
        const p = parseInt(m[1], 10);
        if (p > maxPage) maxPage = p;
      }
    });

    const numText = $(".ewave-page .num, .num").first().text().trim();
    const numMatch = numText.match(/\/(\d+)/);
    if (numMatch) {
      const p = parseInt(numMatch[1], 10);
      if (p > maxPage) maxPage = p;
    }

    const hasNext = maxPage > page;
    return {
      items,
      page,
      has_next: hasNext,
      total_pages: maxPage,
    };
  } catch (error) {
    console.error("[Linkkf] searchAnime error:", error);
    return { items: [], page, has_next: false, total_pages: 1 };
  }
}

export async function getAnimeDetail(animeId: string): Promise<AnimeDetail | null> {
  const cached = detailCache[animeId];
  if (cached && Date.now() - cached.timestamp < 300_000) {
    return cached.data;
  }

  const baseUrl = await getBaseUrl();
  const url = `${baseUrl}/ani/${animeId}/`;
  try {
    const headers = { ...LINKKF_HEADERS, Referer: `${baseUrl}/` };
    const res = await fetch(url, { headers, next: { revalidate: 120 } });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    const titleEl = $(".detail-info-title, h1.title, .page-title").first();
    const title = titleEl.text().trim();

    const imgEl = $(".detail-img img, .detail-pic img, .img-wrapper img, .poster img, img.lazyload").first();
    const rawImg = imgEl.attr("data-original") || imgEl.attr("data-src") || imgEl.attr("src") || "";
    const poster = normalizeImageUrl(rawImg, baseUrl);

    const descEl = $(".detail-desc-content, .detail-desc, .desc").first();
    const description = descEl.text().trim();

    const genres: string[] = [];
    $(".detail-info-desc li, .info-list li").each((_, li) => {
      if ($(li).text().includes("장르")) {
        $(li).find("a").each((__, a) => {
          const g = $(a).text().trim();
          if (g) genres.push(g);
        });
      }
    });

    const subEpisodes: EpisodeItem[] = [];
    let epLinks1 = $(".episode-box ul#ewave-playlist-1 a.ep, #playlist1 a.ep");
    if (!epLinks1.length) {
      epLinks1 = $(".episode-box a.ep");
    }

    epLinks1.each((_, a) => {
      const epText = $(a).text().trim();
      const href = $(a).attr("href")?.trim() || "";
      const watchUrl = href.startsWith("/") ? `${baseUrl}${href}` : href;
      const m = epText.match(/\d+/);
      const epNum = m ? parseInt(m[0], 10) : 1;

      subEpisodes.push({
        number: epNum,
        title: epText.includes("화") ? epText : `${epNum}화`,
        watch_url: watchUrl,
      });
    });

    subEpisodes.sort((a, b) => a.number - b.number);

    const dubEpisodes: EpisodeItem[] = [];
    const epLinks2 = $(".episode-box ul#ewave-playlist-2 a.ep, #playlist2 a.ep");
    epLinks2.each((_, a) => {
      const epText = $(a).text().trim();
      const href = $(a).attr("href")?.trim() || "";
      const watchUrl = href.startsWith("/") ? `${baseUrl}${href}` : href;
      const m = epText.match(/\d+/);
      const epNum = m ? parseInt(m[0], 10) : 1;

      dubEpisodes.push({
        number: epNum,
        title: `${epNum}화 (더빙)`,
        watch_url: watchUrl,
      });
    });

    dubEpisodes.sort((a, b) => a.number - b.number);

    let statusText = "";
    let yearText = "";
    $(".detail-info-desc li, .info-list li, .data li").each((_, li) => {
      const txt = $(li).text().trim();
      if (txt.includes("총화수")) {
        statusText = txt.replace("총화수：", "").replace("총화수:", "").trim();
      } else if (txt.includes("년")) {
        yearText = txt.replace("년 ：", "").replace("년:", "").trim();
      }
    });

    let isFinished = false;
    const mCount = statusText.match(/(\d+)\s*(?:Rip)?\s*\/\s*(\d+)/);
    if (mCount) {
      const curC = parseInt(mCount[1], 10);
      const maxC = parseInt(mCount[2], 10);
      if (curC >= maxC) isFinished = true;
    } else if (
      title.includes("[BD]") ||
      title.toUpperCase().split(" ").includes("BD") ||
      title.includes("극장판") ||
      title.includes("Movie") ||
      title.includes("OVA")
    ) {
      isFinished = true;
    } else if (
      yearText &&
      !yearText.includes(String(CURRENT_YEAR)) &&
      !yearText.includes(String(CURRENT_YEAR - 1))
    ) {
      isFinished = true;
    }

    const detail: AnimeDetail = {
      id: animeId,
      title,
      poster,
      description,
      genres,
      sub_episodes: subEpisodes,
      dub_episodes: dubEpisodes,
      total_episodes: subEpisodes.length,
      status_text: statusText,
      year: yearText,
      is_finished: isFinished,
    };

    detailCache[animeId] = { data: detail, timestamp: Date.now() };
    return detail;
  } catch (error) {
    console.error("[Linkkf] getAnimeDetail error:", error);
    return null;
  }
}

export async function getEpisodeStream(watchUrl: string): Promise<EpisodeStreamInfo | null> {
  const cached = streamCache[watchUrl];
  if (cached && Date.now() - cached.timestamp < 1_800_000) {
    return cached.data;
  }

  try {
    const res = await fetch(watchUrl, { headers: LINKKF_HEADERS, next: { revalidate: 300 } });
    if (!res.ok) return null;

    const html = await res.text();
    const $ = cheerio.load(html);

    const serverSources: ServerSource[] = [];
    $(".btn-switch-server").each((_, b) => {
      const label = $(b).text().trim();
      const dataUrl = $(b).attr("data-url")?.trim() || "";
      if (dataUrl) serverSources.push({ label, player_url: dataUrl });
    });

    let playerData: Record<string, unknown> = {};
    $("script").each((_, s) => {
      const content = $(s).html() || "";
      if (content.includes("player_aaaa")) {
        const match = content.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\});/);
        if (match) {
          try {
            playerData = JSON.parse(match[1]);
          } catch {}
        }
      }
    });

    let actualPlayerUrl = (playerData.actual_url as string) || "";
    if (!actualPlayerUrl && serverSources.length > 0) {
      actualPlayerUrl = serverSources[0].player_url;
    }

    if (!actualPlayerUrl) return null;

    const playerHeaders = {
      "User-Agent": LINKKF_HEADERS["User-Agent"],
      Referer: watchUrl,
    };

    const pRes = await fetch(actualPlayerUrl, { headers: playerHeaders });
    const pHtml = await pRes.text();

    let m3u8Url = "";
    const m3u8Match = pHtml.match(/(?:url|videoUrl)\s*:\s*["']([^"']+\.m3u8[^"']*)["']/) || pHtml.match(/["']([^"']+\.m3u8[^"']*)["']/);

    if (m3u8Match) {
      const rawM3u8 = m3u8Match[1].trim();
      if (rawM3u8.startsWith("//")) {
        const parsed = new URL(actualPlayerUrl);
        m3u8Url = `${parsed.protocol}${rawM3u8}`;
      } else {
        m3u8Url = new URL(rawM3u8, actualPlayerUrl).toString();
      }
    }

    let vttUrl = "";
    const vttMatch = pHtml.match(/["']file["']\s*:\s*["']([^"']+\.vtt[^"']*)["']/) || pHtml.match(/["']([^"']+\.vtt[^"']*)["']/);
    if (vttMatch) {
      const rawVtt = vttMatch[1].trim();
      if (rawVtt.startsWith("//")) {
        const parsed = new URL(actualPlayerUrl);
        vttUrl = `${parsed.protocol}${rawVtt}`;
      } else {
        vttUrl = new URL(rawVtt, actualPlayerUrl).toString();
      }
    }

    const linkNext = (playerData.link_next as string) || "";
    const linkPre = (playerData.link_pre as string) || "";

    const result: EpisodeStreamInfo = {
      success: true,
      m3u8_url: m3u8Url,
      vtt_url: vttUrl,
      player_url: actualPlayerUrl,
      server_sources: serverSources,
      link_next: linkNext.startsWith("/") ? `${BASE_URL}${linkNext}` : linkNext,
      link_pre: linkPre.startsWith("/") ? `${BASE_URL}${linkPre}` : linkPre,
      vod_data: (playerData.vod_data as Record<string, unknown>) || {},
    };

    if (m3u8Url) {
      streamCache[watchUrl] = { data: result, timestamp: Date.now() };
    }

    return result;
  } catch (error) {
    console.error("[Linkkf] getEpisodeStream error:", error);
    return null;
  }
}

export const linkkfProvider: AnimeProvider = {
  name: "linkkf",
  displayName: "Linkkf",
  getBaseUrl,
  getAnimeListFiltered,
  getAnimeList,
  searchAnime,
  getAnimeDetail,
  getEpisodeStream,
};

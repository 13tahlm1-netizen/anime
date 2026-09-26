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
import { REANIME_PREFIX, stripReanimeId, toReanimeId } from "./index";
import { getReanimeBaseUrl, DEFAULT_REANIME_URL } from "@/lib/db";

export const BASE_URL = DEFAULT_REANIME_URL;

export const REANIME_GENRES: [string, string][] = [
  ["액션", "Action"],
  ["모험", "Adventure"],
  ["코미디", "Comedy"],
  ["드라마", "Drama"],
  ["판타지", "Fantasy"],
  ["이세계", "Isekai"],
  ["학원", "School"],
  ["로맨스", "Romance"],
  ["SF", "Sci-Fi"],
  ["일상", "Slice of Life"],
  ["스릴러", "Thriller"],
  ["미스터리", "Mystery"],
  ["심리", "Psychological"],
  ["초자연", "Supernatural"],
  ["스포츠", "Sports"],
  ["음악", "Music"],
  ["메카닉", "Mecha"],
  ["공포", "Horror"],
  ["마법소녀", "Mahou Shoujo"],
];

const REANIME_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://reanime.to/",
  Accept: "application/json, text/plain, */*",
};

// In-memory caches with timestamps
const detailCache: Record<string, { data: AnimeDetail; anilistId: number; timestamp: number }> = {};
const streamCache: Record<string, { data: EpisodeStreamInfo; timestamp: number }> = {};
let homeCache: { data: any; timestamp: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const HOME_CACHE_TTL = 3 * 60 * 1000; // 3 minutes

export async function getBaseUrl(): Promise<string> {
  return await getReanimeBaseUrl();
}

/**
 * SvelteKit 1/2 devalue hydration helper
 */
function unflatten(data: unknown[]): any {
  if (!Array.isArray(data) || data.length === 0) return null;
  const cache = new Map<number, any>();
  function hydrate(val: any): any {
    if (typeof val !== "number") return val;
    if (cache.has(val)) return cache.get(val);
    const raw = data[val];
    if (raw === null || typeof raw !== "object") return raw;
    if (Array.isArray(raw)) {
      const arr: any[] = [];
      cache.set(val, arr);
      for (const item of raw) arr.push(hydrate(item));
      return arr;
    }
    const obj: Record<string, any> = {};
    cache.set(val, obj);
    for (const [k, v] of Object.entries(raw)) obj[k] = hydrate(v);
    return obj;
  }
  return hydrate(0);
}

/**
 * ReAnime API JSON fetcher with Cloudflare WAF bypass fallback (via Jina Reader)
 */
async function fetchReanimeJson<T = any>(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 6000
): Promise<T | null> {
  // 1순위: 직접 fetch 시도
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (res.ok) {
      return (await res.json()) as T;
    }
  } catch {
    // 403 (Cloudflare WAF) 또는 네트워크 오류 시 2순위 우회로 이동
  }

  // 2순위: Jina Reader 프록시를 통한 Cloudflare WAF 우회
  // 주의: Jina Reader에 브라우저 User-Agent를 넘기면 Cloudflare 챌린지로 차단되므로 헤더를 최소화합니다.
  try {
    const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Accept: "application/json",
        "X-No-Cache": "true",
      },
      signal: AbortSignal.timeout(timeoutMs + 4000),
      cache: "no-store",
    });
    if (jinaRes.ok) {
      const jinaData = await jinaRes.json();
      const content = jinaData?.data?.content;
      if (content && typeof content === "string") {
        const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        try {
          return JSON.parse(cleaned) as T;
        } catch {
          const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
          if (jsonMatch) {
            return JSON.parse(jsonMatch[0]) as T;
          }
        }
      }
    }
  } catch (jinaErr) {
    console.warn(`[ReAnime] Jina bypass fetch failed for ${url}:`, jinaErr);
  }

  return null;
}

async function fetchHomeData(): Promise<any> {
  const now = Date.now();
  if (homeCache && now - homeCache.timestamp < HOME_CACHE_TTL) {
    return homeCache.data;
  }

  const baseUrl = await getBaseUrl();
  const headers = { ...REANIME_HEADERS, Referer: `${baseUrl}/` };

  // 1순위: 공식 순수 JSON REST API 시도 (/api/v1/home)
  try {
    const data = await fetchReanimeJson<any>(`${baseUrl}/api/v1/home`, headers);
    if (data && (Array.isArray(data.trending) || Array.isArray(data.latest_aired))) {
      homeCache = { data, timestamp: now };
      return data;
    }
  } catch (e) {
    console.warn("[ReAnime] /api/v1/home error, falling back to SvelteKit:", e);
  }

  // 2순위: SvelteKit __data.json 백업 엔드포인트
  try {
    const res = await fetch(`${baseUrl}/home/__data.json`, {
      headers,
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch home data: ${res.status}`);
    }
    const json = await res.json();
    const homeNode = json.nodes?.find((n: any) => n?.data?.[0] && "homeData" in n.data[0]);
    if (!homeNode || !homeNode.data) {
      throw new Error("Could not find homeData node in ReAnime response");
    }
    const unflattened = unflatten(homeNode.data);
    const homeData = unflattened?.homeData || {};
    homeCache = { data: homeData, timestamp: now };
    return homeData;
  } catch (err) {
    console.error("[ReAnime] fetchHomeData error:", err);
    return homeCache?.data || {};
  }
}

function mapRawItemToAnimeListItem(item: any): AnimeListItem {
  const animeId = item.anime_id || "";
  const title =
    item.title?.english ||
    item.title?.romaji ||
    item.title?.native ||
    item.title?.user_preferred ||
    item.title ||
    animeId;

  const poster =
    item.cover_image?.large ||
    item.cover_image?.extra_large ||
    item.cover_image?.medium ||
    item.banner_image ||
    "";

  let remarks = "";
  if (item.episode?.episode_number) {
    remarks = `${item.episode.episode_number}화 방영`;
  } else if (item.format) {
    const epCount = item.episodes ? `${item.episodes}화` : "";
    const statusKo = item.status === "Finished" ? "완결" : (item.status === "Releasing" ? "방영중" : "");
    remarks = [item.season_year, item.format, epCount, statusKo].filter(Boolean).join(" • ");
  } else if (item.status) {
    remarks = item.status === "Finished" ? "완결" : item.status;
  }

  return {
    id: toReanimeId(animeId),
    title,
    poster,
    detail_url: `/anime/${toReanimeId(animeId)}`,
    remarks,
    rank: item.average_score || null,
  };
}

export async function getAnimeList(params: {
  category?: "recent_caption" | "airing" | "top" | "movie" | "finished" | "trending" | "upcoming";
  page?: number;
  genre?: string;
  period?: "day" | "week" | "month" | "all";
  sort?: string;
}): Promise<AnimeListResponse> {
  const page = params.page || 1;
  const rawCat = params.category;
  const category = rawCat === "recent_caption" ? "trending" : rawCat;

  try {
    // 1. 장르 필터가 지정된 경우 -> 영문 장르 매핑 후 searchAnime 호출
    if (params.genre) {
      const match = REANIME_GENRES.find(
        ([k, v]) => k === params.genre || v.toLowerCase() === params.genre?.toLowerCase()
      );
      const queryGenre = match ? match[1] : params.genre;
      return await searchAnime(queryGenre, page);
    }

    // 2. 카테고리별 분기
    const homeData = await fetchHomeData();
    let rawList: any[] = [];
    let hasNext = false;
    let totalPages = 1;

    switch (params.category) {
      case "trending": {
        if (page === 1 && Array.isArray(homeData.trending) && homeData.trending.length > 0) {
          rawList = homeData.trending;
          hasNext = true;
          totalPages = 100;
        } else {
          // 2페이지 이상이거나 홈 캐시가 부족할 때는 2만편 DB 전체 페이징 API 호출
          return await searchAnime("*", page);
        }
        break;
      }
      case "upcoming": {
        const limit = 20;
        const offset = Math.max(0, (page - 1) * limit);
        const baseUrl = await getBaseUrl();
        const headers = { ...REANIME_HEADERS, Referer: `${baseUrl}/` };

        const searchJson = await fetchReanimeJson<any>(
          `${baseUrl}/api/v1/search?status=Not%20Yet%20Released&sort=popularity_desc&limit=${limit}&offset=${offset}`,
          headers
        );

        const total = Number(searchJson?.total || 0);
        totalPages = total > 0 ? Math.ceil(total / limit) : 1;
        hasNext = offset + limit < total;
        const searchResults: any[] = Array.isArray(searchJson?.results) ? searchJson.results : [];

        if (page === 1) {
          const upcomingList: any[] = Array.isArray(homeData.upcoming) ? homeData.upcoming : [];
          const seenIds = new Set(upcomingList.map((it: any) => it.anime_id));

          rawList = [...upcomingList];
          for (const item of searchResults) {
            if (!seenIds.has(item.anime_id)) {
              rawList.push(item);
              seenIds.add(item.anime_id);
            }
            if (rawList.length >= limit) break;
          }
          if (rawList.length === 0) rawList = upcomingList;
        } else {
          rawList = searchResults;
        }
        break;
      }
      case "top": {
        if (page === 1 && Array.isArray(homeData.trending) && homeData.trending.length > 0) {
          rawList = [...homeData.trending].sort((a, b) => (b.average_score || 0) - (a.average_score || 0));
          hasNext = true;
          totalPages = 50;
        } else {
          return await searchAnime("*", page);
        }
        break;
      }
      case "finished": {
        rawList = (homeData.trending || []).filter((item: any) => item.status === "Finished");
        hasNext = false;
        totalPages = 1;
        break;
      }
      case "movie": {
        return await searchAnime("Movie", page);
      }
      case "airing":
      default: {
        const limit = 20;
        const offset = Math.max(0, (page - 1) * limit);
        const baseUrl = await getBaseUrl();
        const headers = { ...REANIME_HEADERS, Referer: `${baseUrl}/` };

        // ReAnime 방영 중(status=Releasing) 최신순(sort=year_desc) API 호출
        const searchJson = await fetchReanimeJson<any>(
          `${baseUrl}/api/v1/search?status=Releasing&sort=year_desc&limit=${limit}&offset=${offset}`,
          headers
        );

        const total = Number(searchJson?.total || 0);
        totalPages = total > 0 ? Math.ceil(total / limit) : 17;
        hasNext = offset + limit < total;
        const searchResults: any[] = Array.isArray(searchJson?.results) ? searchJson.results : [];

        if (page === 1) {
          // 1페이지: 실시간 최신 방영 에피소드(latest_aired, 12편)를 최상단에 배치하고,
          // 빈자리를 방영작 검색 결과로 채워 총 20편 제공
          const latestAired: any[] = Array.isArray(homeData.latest_aired) ? homeData.latest_aired : [];
          const seenIds = new Set(latestAired.map((it: any) => it.anime_id));

          rawList = [...latestAired];
          for (const item of searchResults) {
            if (!seenIds.has(item.anime_id)) {
              rawList.push(item);
              seenIds.add(item.anime_id);
            }
            if (rawList.length >= limit) break;
          }

          if (rawList.length === 0) {
            rawList = latestAired;
          }
          if (totalPages <= 1 && total > 0) {
            totalPages = Math.ceil(total / limit);
            hasNext = total > limit;
          } else if (totalPages <= 1) {
            totalPages = 17;
            hasNext = true;
          }
        } else {
          // 2페이지 이상: 20편씩 순차 페이징 제공
          rawList = searchResults;
          if (rawList.length === 0 && page > 1) {
            return await searchAnime("*", page);
          }
        }
        break;
      }
    }

    const items = rawList.map(mapRawItemToAnimeListItem);

    return {
      items,
      page,
      has_next: hasNext,
      total_pages: totalPages,
    };
  } catch (error) {
    console.error("[ReAnime] getAnimeList error:", error);
    return { items: [], page: 1, has_next: false, total_pages: 1 };
  }
}

export async function getAnimeListFiltered(params: AnimeListFilterParams): Promise<AnimeListResponse> {
  return await getAnimeList({
    category: params.category,
    page: params.page,
    genre: params.genre,
    period: params.period,
    sort: params.sort,
  });
}

export async function searchAnime(keyword: string, page = 1): Promise<AnimeListResponse> {
  const trimmed = keyword?.trim();
  if (!trimmed) {
    return { items: [], page: 1, has_next: false, total_pages: 1 };
  }

  const limit = 20;
  const offset = Math.max(0, (page - 1) * limit);

  const searchTerms: string[] = [];

  // 한글 검색어인 경우 애니시아(Anissia)를 통해 원제(일본어)를 최우선 검색어로 배치
  if (/[가-힣]/.test(trimmed)) {
    try {
      const aniRes = await fetch(
        `https://api.anissia.net/anime/list/0?q=${encodeURIComponent(trimmed)}`,
        { signal: AbortSignal.timeout(3500) }
      );
      if (aniRes.ok) {
        const aniData = await aniRes.json();
        const content = aniData.data?.content || [];
        const exact = content.find((it: any) => it.subject?.trim() === trimmed);
        if (exact?.originalSubject) {
          const cleanExact = exact.originalSubject.replace(/[~～〜―—–\-:：].*$/, "").trim();
          if (cleanExact && !searchTerms.includes(cleanExact)) searchTerms.push(cleanExact);
          if (!searchTerms.includes(exact.originalSubject)) searchTerms.push(exact.originalSubject);
        }
        for (const item of content.slice(0, 4)) {
          if (item.originalSubject) {
            const cleanSub = item.originalSubject.replace(/[~～〜―—–\-:：].*$/, "").trim();
            if (cleanSub && !searchTerms.includes(cleanSub)) searchTerms.push(cleanSub);
            if (!searchTerms.includes(item.originalSubject)) searchTerms.push(item.originalSubject);
          }
        }
      }
    } catch {
      // Anissia 실패 시 기본 검색어 유지
    }
  }

  if (!searchTerms.includes(trimmed)) {
    searchTerms.push(trimmed);
  }

  const baseUrl = await getBaseUrl();
  const headers = { ...REANIME_HEADERS, Referer: `${baseUrl}/` };

  // 순차 검색 시도 (결과가 발견되면 페이징 메타데이터와 함께 반환)
  for (const term of searchTerms) {
    try {
      const queryParam = term === "*" ? "*" : encodeURIComponent(term);
      const json = await fetchReanimeJson<any>(
        `${baseUrl}/api/v1/search?q=${queryParam}&offset=${offset}&limit=${limit}`,
        headers
      );
      if (!json) continue;

      const results = Array.isArray(json.results) ? json.results : [];
      if (results.length > 0) {
        const items = results.map(mapRawItemToAnimeListItem);
        const total = Number(json.total || results.length || 0);
        const totalPages = total > 0 ? Math.ceil(total / limit) : 1;
        const hasNext = offset + results.length < total;

        return {
          items,
          page,
          has_next: hasNext,
          total_pages: totalPages,
        };
      }
    } catch (err) {
      console.warn(`[ReAnime] searchAnime attempt for "${term}" error:`, err);
    }
  }

  return { items: [], page, has_next: false, total_pages: 1 };
}

export async function getAnimeDetail(animeId: string): Promise<AnimeDetail | null> {
  const normalizedId = toReanimeId(animeId);
  const now = Date.now();

  if (detailCache[normalizedId] && now - detailCache[normalizedId].timestamp < CACHE_TTL) {
    return detailCache[normalizedId].data;
  }

  const slug = stripReanimeId(animeId);
  if (!slug) return null;

  const baseUrl = await getBaseUrl();
  const headers = { ...REANIME_HEADERS, Referer: `${baseUrl}/` };

  // 1순위: 공식 순수 JSON REST API 시도 (/api/v1/anime/:slug & /episodes)
  try {
    const [rawAnime, epsJson] = await Promise.all([
      fetchReanimeJson<any>(`${baseUrl}/api/v1/anime/${slug}`, headers),
      fetchReanimeJson<any>(`${baseUrl}/api/v1/anime/${slug}/episodes`, headers),
    ]);

    if (rawAnime && (rawAnime.title || rawAnime.anime_id)) {
      const rawEpisodes: any[] = Array.isArray(epsJson?.data) ? epsJson.data : [];
      const anilistId = Number(rawAnime.anilist_id || 0);

      const title =
        rawAnime.title?.english ||
        rawAnime.title?.romaji ||
        rawAnime.title?.native ||
        rawAnime.title?.user_preferred ||
        slug;

      const poster =
        rawAnime.cover_image?.extra_large ||
        rawAnime.cover_image?.large ||
        rawAnime.cover_image?.medium ||
        rawAnime.banner_image ||
        "";

      const subEpisodes: EpisodeItem[] = rawEpisodes.map((ep: any) => {
        const epNum = Number(ep.episode_number ?? ep.number ?? 1);
        return {
          number: epNum,
          title: ep.title ? `${epNum}화 - ${ep.title}` : `${epNum}화`,
          watch_url: `${baseUrl}/watch/${slug}?ep=${epNum}&anilist=${anilistId}`,
        };
      });

      const isFinished = rawAnime.status === "Finished";
      const statusText = isFinished ? "완결" : (rawAnime.status === "Releasing" ? "방영중" : (rawAnime.status || ""));

      const detail: AnimeDetail = {
        id: normalizedId,
        title,
        poster,
        description: rawAnime.description ? rawAnime.description.replace(/<br\s*[\/]?>/gi, "\n") : "",
        genres: Array.isArray(rawAnime.genres) ? rawAnime.genres : [],
        sub_episodes: subEpisodes,
        dub_episodes: [],
        total_episodes: Number(rawAnime.episodes_total || rawEpisodes.length || 0),
        status_text: statusText,
        year: String(rawAnime.season_year || ""),
        is_finished: isFinished,
      };

      detailCache[normalizedId] = { data: detail, anilistId, timestamp: now };
      return detail;
    }
  } catch (err) {
    console.warn(`[ReAnime] REST detail failed for "${slug}", trying SvelteKit fallback:`, err);
  }

  // 2순위: SvelteKit __data.json 백업 엔드포인트
  try {
    const res = await fetch(`${baseUrl}/watch/${slug}/__data.json?ep=1`, {
      headers,
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Failed to load anime detail: ${res.status}`);
    }

    const json = await res.json();
    const watchNode = json.nodes?.find(
      (n: any) => n?.data?.[0] && ("anime" in n.data[0] || "episodes" in n.data[0])
    );

    if (!watchNode || !watchNode.data) {
      throw new Error("Could not find anime data node in watch response");
    }

    const unflattened = unflatten(watchNode.data);
    const rawAnime = unflattened?.anime || {};
    const rawEpisodes: any[] = Array.isArray(unflattened?.episodes) ? unflattened.episodes : [];

    const anilistId = Number(rawAnime.anilist_id || 0);

    const title =
      rawAnime.title?.english ||
      rawAnime.title?.romaji ||
      rawAnime.title?.native ||
      rawAnime.title?.user_preferred ||
      slug;

    const poster =
      rawAnime.cover_image?.extra_large ||
      rawAnime.cover_image?.large ||
      rawAnime.cover_image?.medium ||
      rawAnime.banner_image ||
      "";

    const subEpisodes: EpisodeItem[] = rawEpisodes.map((ep: any) => {
      const epNum = Number(ep.number ?? ep.episode_number ?? 1);
      return {
        number: epNum,
        title: ep.title ? `${epNum}화 - ${ep.title}` : `${epNum}화`,
        watch_url: `${baseUrl}/watch/${slug}?ep=${epNum}&anilist=${anilistId}`,
      };
    });

    const isFinished = rawAnime.status === "Finished";
    const statusText = isFinished ? "완결" : (rawAnime.status === "Releasing" ? "방영중" : (rawAnime.status || ""));

    const detail: AnimeDetail = {
      id: normalizedId,
      title,
      poster,
      description: rawAnime.description ? rawAnime.description.replace(/<br\s*[\/]?>/gi, "\n") : "",
      genres: Array.isArray(rawAnime.genres) ? rawAnime.genres : [],
      sub_episodes: subEpisodes,
      dub_episodes: [],
      total_episodes: Number(rawAnime.episodes_total || rawEpisodes.length || 0),
      status_text: statusText,
      year: String(rawAnime.season_year || ""),
      is_finished: isFinished,
    };

    detailCache[normalizedId] = { data: detail, anilistId, timestamp: now };
    return detail;
  } catch (error) {
    console.error("[ReAnime] getAnimeDetail error:", error);
    return null;
  }
}

export async function getEpisodeStream(watchUrl: string): Promise<EpisodeStreamInfo | null> {
  const now = Date.now();
  if (streamCache[watchUrl] && now - streamCache[watchUrl].timestamp < CACHE_TTL) {
    return streamCache[watchUrl].data;
  }

  try {
    const baseUrl = await getBaseUrl();
    const url = new URL(watchUrl, baseUrl);
    const ep = url.searchParams.get("ep") || "1";
    let anilistIdStr = url.searchParams.get("anilist");

    if (!anilistIdStr) {
      // Fallback: extract slug and lookup detail
      const slug = url.pathname.replace(/^\/watch\/?/, "").split("/")[0];
      const detail = await getAnimeDetail(slug);
      const cached = detailCache[toReanimeId(slug)];
      if (cached?.anilistId) {
        anilistIdStr = String(cached.anilistId);
      }
    }

    if (!anilistIdStr) {
      throw new Error(`Unable to determine anilistId for watchUrl: ${watchUrl}`);
    }

    const headers = { ...REANIME_HEADERS, Referer: `${baseUrl}/` };
    const json = await fetchReanimeJson<any>(`${baseUrl}/api/flix/${anilistIdStr}/${ep}`, headers, 10000);

    if (!json || !json.success || !Array.isArray(json.servers) || json.servers.length === 0) {
      throw new Error(`Flix API returned no servers for ${anilistIdStr}/${ep}`);
    }

    const servers: any[] = json.servers;

    // Find preferred server: prefer HD-1 sub, or first available with dataLink
    const preferredServer =
      servers.find((s) => s.serverName === "HD-1" && s.dataType === "sub") ||
      servers.find((s) => s.dataType === "sub") ||
      servers.find((s) => s.dataType === "dub") ||
      servers[0];

    const embedUrl = preferredServer?.dataLink || "";

    if (!embedUrl) {
      throw new Error("No valid embed URL found from Flix servers");
    }

    const serverSources: ServerSource[] = servers.map((s) => ({
      label: `${s.serverName || "HD"} (${s.dataType || "sub"})`,
      player_url: s.dataLink,
    }));

    const result: EpisodeStreamInfo = {
      success: true,
      m3u8_url: embedUrl,
      embed_url: embedUrl,
      player_url: embedUrl,
      vtt_url: "",
      stream_type: "iframe",
      server_sources: serverSources,
      link_next: "",
      link_pre: "",
    };

    streamCache[watchUrl] = { data: result, timestamp: now };
    return result;
  } catch (error) {
    console.error("[ReAnime] getEpisodeStream error:", error);
    return null;
  }
}

export const reanimeProvider: AnimeProvider = {
  name: "reanime",
  displayName: "ReAnime (1080p)",
  getBaseUrl,
  getAnimeListFiltered,
  getAnimeList,
  searchAnime,
  getAnimeDetail,
  getEpisodeStream,
};

import {
  parseSeason,
  generateAnissiaSearchQueries,
  scoreAnimeMatch,
} from "./subtitles";

export const ANILIST_URL = "https://graphql.anilist.co";
export const ANISKIP_URL = "https://api.aniskip.com/v2/skip-times";

export interface SkipInterval {
  type: "op" | "ed" | "mixed-op" | "mixed-ed";
  label: "오프닝" | "엔딩";
  start: number;
  end: number;
}

const malIdCache: Record<string, number> = {};
const skipCache: Record<string, SkipInterval[]> = {};

function cleanSearchTitle(text: string): string {
  if (!text) return "";
  let t = text.replace(/\[.*?\]|\(.*?\)|【.*?】|<.*?>/g, " ");
  t = t.replace(/\bBD\b/gi, " ");
  t = t.replace(/\s+\d+화(?:\s|$)/g, " ");
  t = t.replace(/[^\w\s가-힣a-zA-Z0-9ぁ-んァ-ヶー一-龥]/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

// 일본어 원제에서 극장판, 부제(「...」, 편), 시즌 표기를 제거하여 순수 기본형 추출
export function cleanJapaneseBaseTitle(jp: string): string {
  if (!jp) return "";
  let s = jp;
  s = s.replace(/^(?:劇場版|映画)\s*/gi, "");
  s = s.replace(/「.*?」|『.*?』|〜.*?〜|~.*?~/g, " ");
  s = s.replace(/第?\d+期|Season\s*\d+|\b\d+(?:st|nd|rd|th)\b/gi, " ");
  s = s.replace(/[ⅠⅡⅢⅣⅤⅥ]|(?:\b(?:VI|IV|III|II)\b)/g, " ");
  s = s.replace(/\s*[^\s]+編(?:\s|$)/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// 애니시아에서 스마트 다단계 검색 및 가중치 매칭으로 올바른 일본어 원제 추출
export async function getJapaneseTitleFromAnissia(koreanTitle: string): Promise<string> {
  try {
    const targetSeason = parseSeason(koreanTitle);
    const queries = generateAnissiaSearchQueries(koreanTitle);

    let bestAnime: { animeNo: number; subject: string; originalSubject?: string } | null = null;
    let bestScore = 0;
    const allContent: Array<{ animeNo: number; subject: string; originalSubject?: string }> = [];

    for (const q of queries.slice(0, 4)) {
      try {
        const url = `https://api.anissia.net/anime/list/0?q=${encodeURIComponent(q)}`;
        const res = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          },
          signal: AbortSignal.timeout(3000),
        });
        if (!res.ok) continue;

        const json = await res.json();
        const content = json?.data?.content || [];
        allContent.push(...content);

        for (const item of content) {
          const sc = scoreAnimeMatch(koreanTitle, targetSeason, item);
          if (sc > bestScore) {
            bestScore = sc;
            bestAnime = item;
          }
        }
        if (bestScore >= 120) break;
      } catch {}
    }

    // 1) 최적 매칭 작품에 originalSubject가 있는 경우
    if (bestAnime && bestScore >= 50 && bestAnime.originalSubject) {
      if (targetSeason !== null) {
        return bestAnime.originalSubject;
      }
      return cleanJapaneseBaseTitle(bestAnime.originalSubject) || bestAnime.originalSubject;
    }

    // 2) 최적 매칭 작품의 originalSubject가 비어있는 구작 1기 등의 경우,
    // 검색된 같은 시리즈의 다른 항목에서 originalSubject를 가져와 순수 기본형으로 정제
    for (const item of allContent) {
      if (item.originalSubject) {
        const baseJp = cleanJapaneseBaseTitle(item.originalSubject);
        if (baseJp && baseJp.length >= 2) {
          if (targetSeason && targetSeason >= 2) {
            return `${baseJp} ${targetSeason}`;
          }
          return baseJp;
        }
      }
    }
  } catch {}
  return "";
}

// AniList 검색 결과 중 대상 시즌과 가장 일치하는 미디어 평가
function scoreAniListMedia(media: any, targetSeason: number | null): number {
  let score = 0;
  const titles = [media.title?.english, media.title?.romaji, media.title?.native].filter(Boolean);
  const titleCombined = titles.join(" ");
  const mediaSeason = parseSeason(titleCombined);

  if (targetSeason === null) {
    if (mediaSeason === null || mediaSeason === 1) {
      score += 60;
    } else {
      score -= 60;
    }
  } else {
    if (mediaSeason === targetSeason) {
      score += 80;
    } else {
      score -= 80;
    }
  }

  if (media.format === "TV") score += 20;
  if (media.format === "MOVIE") score -= 20;

  return score;
}

export async function findMalId(title: string, posterUrl = ""): Promise<number | null> {
  // 0. Poster AniList ID if present
  if (posterUrl) {
    const m = posterUrl.match(/\/anime\/(\d+)\//);
    if (m) {
      const anilistId = parseInt(m[1], 10);
      const cacheKey = `anilist_id_${anilistId}`;
      if (malIdCache[cacheKey]) return malIdCache[cacheKey];

      try {
        const query = `{ Media(id: ${anilistId}, type: ANIME) { id idMal } }`;
        const res = await fetch(ANILIST_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ query }),
          signal: AbortSignal.timeout(4000),
        });
        if (res.ok) {
          const data = await res.json();
          const malId = data?.data?.Media?.idMal;
          if (malId) {
            malIdCache[cacheKey] = malId;
            return malId;
          }
        }
      } catch {}
    }
  }

  const clean = cleanSearchTitle(title);
  if (malIdCache[clean]) return malIdCache[clean];

  const targetSeason = parseSeason(title);

  const koMatch = title.match(/[가-힣0-9\s~!?.,-]+/);
  const enMatch = title.match(/[a-zA-Z][a-zA-Z0-9\s~!?.,-]*$/);

  const koPart = koMatch ? koMatch[0].trim() : "";
  const enPart = enMatch ? enMatch[0].trim() : "";

  const searchCandidates: string[] = [];

  // 1. 일본어 원제 (스마트 애니시아 매칭)
  const jpTitle = await getJapaneseTitleFromAnissia(title);
  if (jpTitle) {
    searchCandidates.push(jpTitle);
  }

  // 2. 영문 제목 + 시즌
  if (enPart && enPart.length >= 2) {
    if (targetSeason && !enPart.includes(String(targetSeason))) {
      searchCandidates.push(`${enPart} Season ${targetSeason}`);
    }
    searchCandidates.push(enPart);
  }

  // 3. 한글 제목
  if (koPart && koPart.length >= 2) {
    searchCandidates.push(koPart);
    const words = koPart.split(/\s+/);
    if (words.length >= 2) searchCandidates.push(words.slice(0, 2).join(" "));
  }

  searchCandidates.push(clean);

  for (const candidate of searchCandidates) {
    if (!candidate || candidate.length < 2) continue;
    const safeCand = candidate.replace(/["\\]/g, "").trim();
    const query = `{ Page(page: 1, perPage: 6) { media(search: "${safeCand}", type: ANIME) { id idMal title { romaji native english } format } } }`;

    try {
      const res = await fetch(ANILIST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(4000),
      });

      if (res.ok) {
        const data = await res.json();
        const mediaList = data?.data?.Page?.media || [];
        if (mediaList.length > 0) {
          let bestMedia = null;
          let bestMediaScore = -999;
          for (const m of mediaList) {
            if (!m?.idMal) continue;
            const sc = scoreAniListMedia(m, targetSeason);
            if (sc > bestMediaScore) {
              bestMediaScore = sc;
              bestMedia = m;
            }
          }
          if (bestMedia && bestMediaScore >= 0) {
            malIdCache[clean] = bestMedia.idMal;
            return bestMedia.idMal;
          }
        }
      }
    } catch {}
  }

  return null;
}

export async function getSkipTimes(
  title: string,
  episodeNumber: number,
  episodeLength = 0,
  posterUrl = ""
): Promise<SkipInterval[]> {
  const cacheKey = `${title}_${episodeNumber}`;
  if (skipCache[cacheKey]) return skipCache[cacheKey];

  const malId = await findMalId(title, posterUrl);
  if (!malId) return [];

  try {
    const url = `${ANISKIP_URL}/${malId}/${episodeNumber}?types[]=op&types[]=ed&episodeLength=${episodeLength || 0}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];

    const data = await res.json();
    if (!data.found) return [];

    const results: SkipInterval[] = [];
    const seenIntervals = new Set<string>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const item of data.results || []) {
      const st = (item.skipType || "").toLowerCase() as "op" | "ed";
      const interval = item.interval || {};
      const startTime = parseFloat(interval.startTime || 0);
      const endTime = parseFloat(interval.endTime || 0);

      const duration = endTime - startTime;
      if (duration >= 15 && duration <= 240) {
        const intKey = `${Math.round(startTime * 10) / 10}_${Math.round(endTime * 10) / 10}`;
        if (!seenIntervals.has(intKey)) {
          seenIntervals.add(intKey);
          results.push({
            type: st,
            label: st === "op" ? "오프닝" : "엔딩",
            start: startTime,
            end: endTime,
          });
        }
      }
    }

    skipCache[cacheKey] = results;
    return results;
  } catch (e) {
    console.error("[AniSkip error]:", e);
    return [];
  }
}

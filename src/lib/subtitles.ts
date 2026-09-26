import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import AdmZip from "adm-zip";

export const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
};

export interface SubtitleResult {
  name: string;
  episode: number;
  orig_filename: string;
  format: "ASS" | "VTT";
  is_ass: boolean;
  content: string; // VTT text or raw ASS string
  url?: string;
}

export interface CreatorInfo {
  name: string;
  episode: string;
  update_date: string;
  website: string;
  is_current_ep: boolean;
}

// Common Korean anime abbreviation mapping
export const ANIME_ABBREVIATIONS: Record<string, string> = {
  전생슬: "전생했더니 슬라임이었던 건에 대하여",
  전슬라: "전생했더니 슬라임이었던 건에 대하여",
  귀칼: "귀멸의 칼날",
  주술: "주술회전",
  주회: "주술회전",
  프리렌: "장송의 프리렌",
  히로아카: "나의 히어로 아카데미아",
  나히아: "나의 히어로 아카데미아",
  봇치: "봇치 더 록",
  체인소맨: "체인소 맨",
  톱맨: "체인소 맨",
  스파패: "스파이 패밀리",
  최애: "최애의 아이",
  최애의아이: "최애의 아이",
  코노스바: "이 멋진 세계에 축복을!",
  리제로: "Re: 제로부터 시작하는 이세계 생활",
  진격거: "진격의 거인",
  문스독: "문호 스트레이독스",
  단다단: "단다단",
  약사: "약사의 혼잣말",
  괴수8호: "괴수 8호",
  무직전생: "무직 전생",
  나혼렙: "나 혼자만 레벨업",
  도련님: "도망을 잘 치는 도련님",
  도망도련님: "도망을 잘 치는 도련님",
  푸른상자: "푸른 상자",
  블리치: "블리치",
  마지루미에: "주식회사 마지루미에",
  책벌레: "책벌레의 하극상",
  유녀전기: "유녀전기",
  그랑블루: "그랑블루",
  담배고양이: "담배 고양이",

  // English / Romaji popular names
  "that time i got reincarnated as a slime": "전생했더니 슬라임이었던 건에 대하여",
  "slime": "전생했더니 슬라임이었던 건에 대하여",
  "tensei shitara slime": "전생했더니 슬라임이었던 건에 대하여",
  "re:zero": "Re: 제로부터 시작하는 이세계 생활",
  "rezero": "Re: 제로부터 시작하는 이세계 생활",
  "mushoku tensei": "무직 전생",
  "jobless reincarnation": "무직 전생",
  "frieren": "장송의 프리렌",
  "demon slayer": "귀멸의 칼날",
  "kimetsu": "귀멸의 칼날",
  "jujutsu kaisen": "주술회전",
  "solo leveling": "나 혼자만 레벨업",
  "kaiju no. 8": "괴수 8호",
  "kaiju no 8": "괴수 8호",
  "dandadan": "단다단",
  "blue box": "푸른 상자",
  "ao no hako": "푸른 상자",
  "elusive samurai": "도망을 잘 치는 도련님",
  "nigejouzu": "도망을 잘 치는 도련님",
  "chainsaw man": "체인소 맨",
  "spy x family": "스파이 패밀리",
  "bocchi the rock": "봇치 더 록",
  "my hero academia": "나의 히어로 아카데미아",
  "boku no hero": "나의 히어로 아카데미아",
  "attack on titan": "진격의 거인",
  "shingeki no kyojin": "진격의 거인",
  "oshi no ko": "최애의 아이",
  "bleach": "블리치",
  "grand blue": "그랑블루",
  "magilumiere": "주식회사 마지루미에",
  "apothecary diaries": "약사의 혼잣말",
  "kusuriya": "약사의 혼잣말",
  "wind breaker": "윈드 브레이커",
  "blue lock": "블루 록",
  "smoking behind the supermarket": "슈퍼 뒤에서 담배 피우는 두 사람",
  "super no ura": "슈퍼 뒤에서 담배 피우는 두 사람",
  "yani neko": "담배 고양이",
  "mebius dust": "뫼비우스 더스트",
  "moebius dust": "뫼비우스 더스트",
};

// Memory cache for resolved Korean titles to avoid redundant fetches
const koreanTitleCache = new Map<string, string>();

// Schedule cache to quickly match Japanese native title / animeNo from Anissia
let anissiaScheduleCache: { data: Array<{ subject: string; originalSubject: string; animeNo: number }>; timestamp: number } | null = null;

async function fetchAnissiaSchedule(): Promise<Array<{ subject: string; originalSubject: string; animeNo: number }>> {
  const now = Date.now();
  if (anissiaScheduleCache && now - anissiaScheduleCache.timestamp < 3600_000) {
    return anissiaScheduleCache.data;
  }
  try {
    const days = [0, 1, 2, 3, 4, 5, 6, 7];
    const results = await Promise.allSettled(
      days.map((d) =>
        fetch(`https://api.anissia.net/anime/schedule/${d}`, {
          headers: HEADERS,
          signal: AbortSignal.timeout(3000),
        }).then((r) => r.json())
      )
    );
    const list: Array<{ subject: string; originalSubject: string; animeNo: number }> = [];
    for (const r of results) {
      if (r.status === "fulfilled" && Array.isArray(r.value?.data)) {
        for (const item of r.value.data) {
          if (item?.subject) {
            list.push({
              subject: String(item.subject).trim(),
              originalSubject: String(item.originalSubject || "").trim(),
              animeNo: Number(item.animeNo || 0),
            });
          }
        }
      }
    }
    if (list.length > 0) {
      anissiaScheduleCache = { data: list, timestamp: now };
    }
    return list;
  } catch {
    return anissiaScheduleCache?.data || [];
  }
}

/**
 * 영문/로마자/일본어 제목이나 줄임말(전생슬, 귀칼 등)을 애니시아/블로그에서 검색 가능한
 * 정식 한국어 명칭으로 자동 변환합니다. (Wikidata & Anissia Schedule 연동)
 */
export async function resolveKoreanTitle(rawTitle: string): Promise<string> {
  if (!rawTitle) return "";
  const trimmed = rawTitle.trim();
  if (koreanTitleCache.has(trimmed)) {
    return koreanTitleCache.get(trimmed)!;
  }

  const season = parseSeason(trimmed);

  // 1. 한국어 줄임말 및 영문/로마자 별칭 사전 매칭 (0ms)
  const lower = trimmed.toLowerCase();
  for (const [abbr, full] of Object.entries(ANIME_ABBREVIATIONS)) {
    if (lower.includes(abbr.toLowerCase())) {
      const res = season && season > 1 && !full.includes(`${season}기`) ? `${full} ${season}기` : full;
      koreanTitleCache.set(trimmed, res);
      return res;
    }
  }

  // 2. 이미 2글자 이상의 한글이 포함된 경우 (단, 줄임말이 아닌 일반 한국어 제목)
  const hangulMatch = trimmed.match(/[가-힣]{2,}/g);
  if (hangulMatch && hangulMatch.join("").length >= 2) {
    koreanTitleCache.set(trimmed, trimmed);
    return trimmed;
  }

  // 3. 애니시아 방영 스케줄 캐시와 원제(일문) 대조 매칭
  try {
    const schedule = await fetchAnissiaSchedule();
    const cleanRaw = trimmed
      .replace(/[\(\[\{<~].*?[\]\)\}>~]/g, "")
      .replace(/\bseason\s*\d+\b/gi, "")
      .replace(/\b\d+(?:st|nd|rd|th)\s*season\b/gi, "")
      .replace(/\s*第?\d+期/g, "")
      .replace(/\bpart\s*\d+\b/gi, "")
      .trim();

    for (const item of schedule) {
      if (item.originalSubject) {
        const cleanOrig = item.originalSubject.replace(/\s*第?\d+期/g, "").trim();
        if (cleanOrig.length >= 2 && (cleanRaw.includes(cleanOrig) || cleanOrig.includes(cleanRaw))) {
          koreanTitleCache.set(trimmed, item.subject);
          return item.subject;
        }
      }
    }
  } catch {}

  // 4. Wikidata 공개 엔티티 검색을 통한 다국어 -> 한국어 자동 번역
  try {
    const cleanSearch = trimmed
      .replace(/[\(\[\{<~].*?[\]\)\}>~]/g, "")
      .replace(/\bseason\s*\d+\b/gi, "")
      .replace(/\b\d+(?:st|nd|rd|th)\s*season\b/gi, "")
      .replace(/\bpart\s*\d+\b/gi, "")
      .replace(/\b(tv|bd|uncensored|cour\s*\d+)\b/gi, "")
      .replace(/[^\w\s가-힣]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const searchCandidates: string[] = [];
    if (cleanSearch.length >= 2) searchCandidates.push(cleanSearch);
    const prefix = cleanSearch.split(/\s*[:\-\~\|]\s*/)[0].trim();
    if (prefix && prefix !== cleanSearch && prefix.length >= 3) {
      searchCandidates.push(prefix);
    }

    for (const cand of searchCandidates) {
      const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(cand)}&language=en&format=json&limit=5`;
      const res = await fetch(searchUrl, {
        headers: {
          "User-Agent": "NetizenAnime/1.0 (https://a-sigma-ecru.vercel.app; support@netizen.kr)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(3000),
      });

      if (res.ok) {
        const data = await res.json();
        const entities = data.search || [];
        if (entities.length > 0) {
          const ids = entities.slice(0, 4).map((e: any) => e.id).join("|");
          const getUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids}&props=labels|aliases&languages=ko&format=json`;
          const getRes = await fetch(getUrl, {
            headers: {
              "User-Agent": "NetizenAnime/1.0 (https://a-sigma-ecru.vercel.app; support@netizen.kr)",
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(3000),
          });

          if (getRes.ok) {
            const getData = await getRes.json();
            for (const ent of Object.values(getData.entities || {})) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const koLabel = (ent as any)?.labels?.ko?.value;
              if (koLabel) {
                const res = season && season > 1 && !koLabel.includes(`${season}기`)
                  ? `${koLabel} ${season}기`
                  : koLabel;
                koreanTitleCache.set(trimmed, res);
                return res;
              }
            }
          }
        }
      }
    }
  } catch {}

  koreanTitleCache.set(trimmed, trimmed);
  return trimmed;
}

// 1. Title cleaner
export function cleanTitle(text: string): string {
  if (!text) return "";
  let t = text.replace(/\[.*?\]|\(.*?\)|【.*?】|<.*?>/g, " ");
  t = t.replace(/\bBD\b/gi, " ");
  t = t.replace(/\s+\d+화(?:\s|$)/g, " ");
  t = t.replace(/[^\w\s가-힣a-zA-Z0-9~-]/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

// 2. Safe filename
export function safeFilename(text: string): string {
  return text.replace(/[^a-zA-Z0-9가-힣_-]/g, "_").replace(/^_+|_+$/g, "");
}

// 3. Season parser (로마 숫자 I~VI, 유니코드 Ⅰ~Ⅵ, Part/파트, 기수 등 완벽 지원)
export function parseSeason(text: string): number | null {
  if (!text) return null;

  // 1) 유니코드 로마 숫자 (Ⅰ~Ⅹ)
  if (/Ⅹ/i.test(text)) return 10;
  if (/Ⅸ/i.test(text)) return 9;
  if (/Ⅷ/i.test(text)) return 8;
  if (/Ⅶ/i.test(text)) return 7;
  if (/Ⅵ/i.test(text)) return 6;
  if (/Ⅴ/i.test(text)) return 5;
  if (/Ⅳ/i.test(text)) return 4;
  if (/Ⅲ/i.test(text)) return 3;
  if (/Ⅱ/i.test(text)) return 2;
  if (/Ⅰ/i.test(text)) return 1;

  // 2) 단어 단위 아스키 로마 숫자 (VI, IV, III, II)
  if (/\bVI\b/i.test(text)) return 6;
  if (/\bV\b/i.test(text)) return 5;
  if (/\bIV\b/i.test(text)) return 4;
  if (/\bIII\b/i.test(text)) return 3;
  if (/\bII\b/i.test(text)) return 2;

  // 3) 파트 / Part / 시즌 / 기
  const m = text.match(/(\d+)\s*기|\b(\d+)(?:st|nd|rd|th)\b|season\s*(\d+)|\bs(\d+)\b|파트\s*(\d+)|part\s*(\d+)/i);
  if (m) {
    for (let i = 1; i <= 6; i++) {
      if (m[i]) return parseInt(m[i], 10);
    }
  }

  // 4) 한글/영문 바로 뒤 숫자 (예: 신의탑2)
  const m2 = text.match(/(?<=[가-힣a-zA-Z])([2-9])(?=\s|$|[^\w가-힣])/);
  if (m2) {
    return parseInt(m2[1], 10);
  }
  return null;
}

// 4. Episode numbers parser
export function parseEpisodes(text: string): number[] {
  if (!text) return [];
  const base = text.split(/[\\/]/).pop() || text;
  const eps = new Set<number>();

  // Range patterns: 1-12, 1~12, 01~12화
  const rangeRegex = /(?:^|[^\d])0*(\d{1,3})\s*(?:~|-|_|\.\.|to)\s*0*(\d{1,3})\s*(?:화|편|ep|e|#)?/gi;
  let match: RegExpExecArray | null;
  while ((match = rangeRegex.exec(base)) !== null) {
    const s = parseInt(match[1], 10);
    const e = parseInt(match[2], 10);
    if (s >= 1 && s < e && e <= 150 && e - s <= 100) {
      if (![720, 1080, 480].includes(s) && ![720, 1080, 480].includes(e)) {
        for (let i = s; i <= e; i++) eps.add(i);
      }
    }
  }

  // Explicit units: 01화, 1편, ep2, #3
  const explicitRegex = /(?:^|[^\d])0*(\d{1,3})\s*(?:화|편|ep|e|#)/gi;
  while ((match = explicitRegex.exec(base)) !== null) {
    const val = parseInt(match[1], 10);
    if (val >= 1 && val <= 200) eps.add(val);
  }

  // Fallback: standalone numbers after removing season tokens
  if (eps.size === 0) {
    let clean = base.replace(/\b\d+(?:st|nd|rd|th)\b/gi, " ");
    clean = clean.replace(/\b\d+\s*기\b/g, " ");
    clean = clean.replace(/season\s*\d+/gi, " ");
    clean = clean.replace(/\bs\d+\b/gi, " ");
    clean = clean.replace(/(?<=[가-힣a-zA-Z])\d(?=\s|$|\.|\-|_)/g, " ");
    // Strip standalone season number when immediately followed by episode number: " 4 01." -> " 01."
    clean = clean.replace(/(?<=[^\d]|^)\d+\s+(?=0*\d{1,3}(?:\.|\s|$))/g, " ");

    const numRegex = /(?:^|[^\d])0*(\d{1,3})(?=[^\d]|$)/g;
    while ((match = numRegex.exec(clean)) !== null) {
      const val = parseInt(match[1], 10);
      if (
        ![720, 1080, 480, 2020, 2021, 2022, 2023, 2024, 2025, 2026].includes(val) &&
        val >= 1 &&
        val <= 200
      ) {
        eps.add(val);
      }
    }
  }

  return Array.from(eps).sort((a, b) => a - b);
}

// 5. Decode text buffer with encoding fallback (UTF-8, UTF-16, CP949, EUC-KR)
export function decodeSubtitleBuffer(buf: Buffer): string {
  // UTF-16 BOM or null-byte pattern
  if (
    (buf[0] === 0xff && buf[1] === 0xfe) ||
    (buf[0] === 0xfe && buf[1] === 0xff) ||
    buf.subarray(0, 50).includes(0x00)
  ) {
    for (const enc of ["utf-16le", "utf-16be", "utf-16"]) {
      try {
        const s = iconv.decode(buf, enc);
        if (
          s.toLowerCase().includes("<sync") ||
          s.toLowerCase().includes("<sami") ||
          s.includes("-->") ||
          s.toLowerCase().includes("[script info]")
        ) {
          return s;
        }
      } catch {}
    }
  }

  for (const enc of ["utf-8", "cp949", "euc-kr", "utf-16le", "utf-16"]) {
    try {
      const s = iconv.decode(buf, enc);
      if (
        s.toLowerCase().includes("<sync") ||
        s.toLowerCase().includes("<sami") ||
        s.includes("-->") ||
        s.toLowerCase().includes("[script info]")
      ) {
        return s;
      }
    } catch {}
  }

  // Fallback UTF-8
  return buf.toString("utf-8");
}

function msToTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const remMs = ms % 1000;
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(remMs).padStart(3, "0")}`;
}

// 6. Subtitle cleaner & SMI/SRT to WebVTT converter
export function cleanSubtitleText(raw: string): string {
  if (!raw) return "";
  return raw
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "") // <i>, </i>, <font...>, </font>, <b>, <u> 등 모든 HTML 태그 제거
    .replace(/\{[^}]*\}/g, "") // ASS 스타일 태그 {\an8} 등 제거
    .replace(/\\N/gi, "\n")
    .replace(/\\n/gi, "\n")
    .replace(/\\h/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n")
    .trim();
}

export function convertToVtt(rawText: string, origExt: string): { content: string; ext: string } {
  const lowerExt = origExt.toLowerCase();
  if (lowerExt === ".ass" || lowerExt === ".ssa") {
    return { content: rawText, ext: ".ass" };
  }

  const lowerText = rawText.toLowerCase();

  // SAMI (.smi) Parser
  if (lowerExt === ".smi" || lowerText.includes("<sync") || lowerText.includes("<sami")) {
    const syncRegex = /<SYNC\s+Start=(\d+)[^>]*>(?:<P[^>]*>)?([\s\S]*?)(?=<SYNC|\Z)/gi;
    let m: RegExpExecArray | null;

    interface CueItem {
      startMs: number;
      endMs: number;
      text: string;
    }

    const cues: CueItem[] = [];
    let currentCue: { startMs: number; text: string } | null = null;

    while ((m = syncRegex.exec(rawText)) !== null) {
      const startMs = parseInt(m[1], 10);
      if (isNaN(startMs)) continue;
      const text = cleanSubtitleText(m[2]);

      // 1. 이전 열려있는 대사가 있다면 닫아준다
      if (currentCue) {
        const diff = startMs - currentCue.startMs;
        if (diff > 0) {
          // 최대 지속시간 제한: 글자수에 따라 3초~7초, 최대 8초
          const maxDur = Math.max(3000, Math.min(currentCue.text.length * 250, 7500));
          const actualEnd = diff > maxDur ? currentCue.startMs + maxDur : startMs;
          cues.push({
            startMs: currentCue.startMs,
            endMs: actualEnd,
            text: currentCue.text,
          });
        }
        currentCue = null;
      }

      // 2. 현재 싱크에 텍스트가 있다면 새 대사 등록
      if (text.length > 0) {
        currentCue = { startMs, text };
      }
      // text가 비어있으면 (즉, &nbsp;나 빈 태그로 된 자막 지우기 싱크) 새 대사를 등록하지 않고 자막 닫힘 유지!
    }

    // 파일 마지막에 닫히지 않은 대사가 남아있다면 닫아줌
    if (currentCue) {
      const maxDur = Math.max(3000, Math.min(currentCue.text.length * 250, 6000));
      cues.push({
        startMs: currentCue.startMs,
        endMs: currentCue.startMs + maxDur,
        text: currentCue.text,
      });
    }

    if (cues.length > 0) {
      const lines = ["WEBVTT", ""];
      for (const cue of cues) {
        lines.push(`${msToTime(cue.startMs)} --> ${msToTime(cue.endMs)}`);
        lines.push(cue.text);
        lines.push("");
      }
      return { content: lines.join("\n"), ext: ".vtt" };
    }
  }

  // SRT Parser
  if (lowerExt === ".srt" || rawText.includes("-->")) {
    const rawLines = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const vttLines: string[] = ["WEBVTT", ""];
    let isHeader = true;

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (/^\s*\d+\s*$/.test(line) && rawLines[i + 1]?.includes("-->")) {
        continue;
      }
      if (line.includes("-->")) {
        isHeader = false;
        vttLines.push(line.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2").trim());
      } else if (!isHeader) {
        if (line.trim() === "") {
          vttLines.push("");
        } else {
          vttLines.push(cleanSubtitleText(line));
        }
      }
    }
    return { content: vttLines.join("\n"), ext: ".vtt" };
  }

  return { content: rawText, ext: origExt };
}

// 7. In-memory ZIP extractor & subtitle reader
export function extractSubtitleFromBuffer(
  buffer: Buffer,
  episodeNumber: number,
  urlPath: string
): { filename: string; orig_filename: string; content: string; format: "ASS" | "VTT"; is_ass: boolean } | null {
  const isZip =
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
    urlPath.toLowerCase().endsWith(".zip");

  if (isZip) {
    try {
      const zip = new AdmZip(buffer);
      const zipEntries = zip.getEntries();
      const subEntries = zipEntries.filter((entry) => {
        const name = entry.entryName.toLowerCase();
        return (
          !name.startsWith("__macosx") &&
          (name.endsWith(".ass") ||
            name.endsWith(".ssa") ||
            name.endsWith(".smi") ||
            name.endsWith(".srt") ||
            name.endsWith(".vtt"))
        );
      });

      if (subEntries.length === 0) return null;

      const extPriority: Record<string, number> = {
        ".ass": 1,
        ".ssa": 2,
        ".smi": 3,
        ".srt": 4,
        ".vtt": 5,
      };

      let matchedEntry: AdmZip.IZipEntry | null = null;
      let matchedDecName = "";

      const candidates: Array<{ priority: number; entry: AdmZip.IZipEntry; decName: string }> = [];

      for (const entry of subEntries) {
        let decName = entry.entryName;
        if (!/[가-힣]/.test(decName)) {
          try {
            const cp949 = iconv.decode(entry.rawEntryName, "cp949");
            if (/[가-힣]/.test(cp949)) {
              decName = cp949;
            }
          } catch {}
        }

        for (const nameToCheck of [decName, entry.entryName]) {
          const epNums = parseEpisodes(nameToCheck);
          if (epNums.includes(episodeNumber)) {
            const ext = "." + (entry.name.split(".").pop() || "").toLowerCase();
            candidates.push({
              priority: extPriority[ext] || 99,
              entry,
              decName,
            });
            break;
          }
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => a.priority - b.priority);
        matchedEntry = candidates[0].entry;
        matchedDecName = candidates[0].decName;
      } else if (subEntries.length === 1) {
        matchedEntry = subEntries[0];
        matchedDecName = matchedEntry.name;
      }

      if (matchedEntry) {
        const rawBuf = matchedEntry.getData();
        const rawText = decodeSubtitleBuffer(rawBuf);
        const origExt = "." + (matchedEntry.name.split(".").pop() || "").toLowerCase();
        const { content, ext } = convertToVtt(rawText, origExt);
        const isAss = ext === ".ass" || ext === ".ssa";

        return {
          filename: `sub${ext}`,
          orig_filename: matchedDecName || matchedEntry.name,
          content,
          format: isAss ? "ASS" : "VTT",
          is_ass: isAss,
        };
      }
    } catch (e) {
      console.error("[Zip Extractor error]:", e);
    }
  } else {
    const rawText = decodeSubtitleBuffer(buffer);
    const textLower = rawText.slice(0, 500).toLowerCase();

    // Reject HTML content completely (e.g. Google Drive web viewer/login pages)
    if (
      textLower.includes("<!doctype html") ||
      textLower.includes("<html") ||
      textLower.includes("<head>")
    ) {
      return null;
    }

    const isAss = textLower.includes("[script info]") || textLower.includes("dialogue:");
    const isSmi = textLower.includes("<sami") || textLower.includes("<sync");
    const isSrt = /^\s*\d+\s*[\r\n]+\d{2}:\d{2}/.test(rawText.slice(0, 100)) || rawText.includes("-->");

    if (isAss || isSmi || isSrt) {
      const origExt = isAss ? ".ass" : isSmi ? ".smi" : ".srt";
      const { content, ext } = convertToVtt(rawText, origExt);
      const isAssResult = ext === ".ass" || ext === ".ssa";
      let displayFn = urlPath.split("/").pop() || `subtitle${origExt}`;
      if (displayFn.includes("?") || displayFn.length > 60) {
        displayFn = `subtitle${origExt}`;
      }

      return {
        filename: `sub${ext}`,
        orig_filename: displayFn,
        content,
        format: isAssResult ? "ASS" : "VTT",
        is_ass: isAssResult,
      };
    }
  }

  return null;
}

export function extractGdriveId(url: string): string | null {
  if (!url) return null;
  const cleanUrl = url.replace(/&amp;/g, "&");
  const m = cleanUrl.match(/(?:\/file\/d\/|[\?&]id=)([a-zA-Z0-9_-]{25,})/i);
  return m ? m[1] : null;
}

// 8. Convert Google Drive and cloud links to direct download URLs
export function convertToDirectDownloadUrl(url: string): string {
  if (!url) return url;
  const id = extractGdriveId(url);
  if (id) {
    return `https://drive.usercontent.google.com/download?id=${id}&export=download`;
  }
  return url;
}

// 9. Download file helper with timeout & Google Drive support
export async function downloadFileWithTimeout(
  url: string,
  referer?: string,
  timeoutMs = 4500
): Promise<Buffer | null> {
  try {
    const headers: Record<string, string> = { ...HEADERS };
    if (referer) headers["Referer"] = referer;

    const directUrl = convertToDirectDownloadUrl(url);

    let res = await fetch(directUrl, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });

    // Fallback for Google Drive
    if (!res.ok && directUrl.includes("drive.usercontent.google.com")) {
      const gId = extractGdriveId(url);
      if (gId) {
        res = await fetch(
          `https://docs.google.com/uc?export=download&id=${gId}&confirm=t`,
          {
            headers,
            signal: AbortSignal.timeout(timeoutMs),
          }
        );
      }
    }

    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);

    // Reject HTML responses
    if (buf.length > 0) {
      const sample = buf.subarray(0, 300).toString("utf-8").toLowerCase();
      if (sample.includes("<!doctype html") || sample.includes("<html")) {
        return null;
      }
    }

    return buf;
  } catch {
    return null;
  }
}

// 9. Kairan blog subtitle searcher
export async function findKairanSubtitle(
  title: string,
  episodeNumber: number,
  timeoutMs = 3500
): Promise<SubtitleResult | null> {
  try {
    const resolvedTitle = await resolveKoreanTitle(title);
    const targetSeason = parseSeason(resolvedTitle) || parseSeason(title);
    const targetEp = episodeNumber;

    let cleanBase = resolvedTitle.replace(/[\(\[\{<~].*?[\]\)\}>~]/g, "").trim();
    cleanBase = cleanBase.replace(/\s+\d+기$/g, "").trim();
    cleanBase = cleanBase.replace(/\b\d+(?:st|nd|rd|th)\b/gi, "").trim();
    cleanBase = cleanBase.replace(/season\s*\d+/gi, "").trim();
    cleanBase = cleanTitle(cleanBase);

    const words = cleanBase
      .split(/\s+/)
      .filter((w) => !["시즌", "더빙", "자막", "극장판", "애니"].includes(w));
    const searchTerm = words.length >= 2 ? words.slice(0, 2).join(" ") : words[0] || cleanBase;
    if (!searchTerm) return null;

    const queries: string[] = [];
    if (targetSeason) {
      queries.push(`${searchTerm} ${targetSeason}th ${targetEp}`);
      queries.push(`${searchTerm} ${targetSeason}기 ${targetEp}`);
      queries.push(`${searchTerm} ${targetSeason}th`);
      queries.push(`${searchTerm} ${targetSeason}기`);
    }
    queries.push(`${searchTerm} ${targetEp}화`);
    queries.push(`${searchTerm} ${targetEp}`);
    queries.push(`${searchTerm}`);

    for (const q of queries) {
      const searchUrl = `https://kairan03.blogspot.com/search?q=${encodeURIComponent(q)}`;
      const res = await fetch(searchUrl, {
        headers: HEADERS,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) continue;
      const html = await res.text();
      const $ = cheerio.load(html);

      let matchedPostUrl = "";
      $(".post, .date-outer, .entry").each((_, p) => {
        if (matchedPostUrl) return;
        const titleEl = $(p).find(".post-title a, h3 a, .entry-title a").first();
        if (!titleEl.length) return;

        const postTitle = titleEl.text().trim();
        const postUrl = titleEl.attr("href")?.trim() || "";
        if (!postUrl || postUrl.includes("report-abuse")) return;
        if (!postTitle.includes(words[0])) return;

        const postSeason = parseSeason(postTitle);
        const postEps = parseEpisodes(postTitle);

        if (targetSeason !== null && postSeason !== null && targetSeason !== postSeason) {
          return;
        }

        if (postEps.includes(targetEp)) {
          matchedPostUrl = postUrl;
        }
      });

      if (matchedPostUrl) {
        // Download post page to find attachment link
        const postRes = await fetch(matchedPostUrl, {
          headers: HEADERS,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!postRes.ok) continue;

        const postHtml = await postRes.text();
        const $p = cheerio.load(postHtml);

        let subDownloadUrl = "";
        $p("a[href]").each((_, a) => {
          if (subDownloadUrl) return;
          const href = $p(a).attr("href")?.trim() || "";
          const text = $p(a).text().trim().toLowerCase();
          if (
            extractGdriveId(href) ||
            href.includes("drive.google.com") ||
            href.includes("docs.google.com") ||
            href.endsWith(".zip") ||
            href.endsWith(".ass") ||
            href.endsWith(".smi") ||
            href.endsWith(".srt") ||
            text.includes("자막") ||
            text.includes("다운로드")
          ) {
            subDownloadUrl = href;
          }
        });

        // Fallback: search postHtml for Google Drive link
        if (!subDownloadUrl) {
          const driveMatch = postHtml.match(
            /https?:\/\/(?:drive|docs)\.google\.com\/(?:file\/d\/|uc\?[^"'\s<>]*?id=|open\?id=)([a-zA-Z0-9_-]{25,})/i
          );
          if (driveMatch) {
            subDownloadUrl = driveMatch[0];
          }
        }

        if (subDownloadUrl) {
          const buf = await downloadFileWithTimeout(subDownloadUrl, matchedPostUrl, timeoutMs + 1500);
          if (buf && buf.length > 100) {
            const extracted = extractSubtitleFromBuffer(buf, targetEp, subDownloadUrl);
            if (extracted) {
              return {
                name: "카이란",
                episode: targetEp,
                orig_filename:
                  extracted.orig_filename.startsWith("view?") || extracted.orig_filename.startsWith("subtitle")
                    ? `${cleanBase} ${targetEp}화.${extracted.format.toLowerCase()}`
                    : extracted.orig_filename,
                format: extracted.format,
                is_ass: extracted.is_ass,
                content: extracted.content,
              };
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("[Kairan Subtitle] error:", e);
  }
  return null;
}

// 10. Creator blog search (Tistory, Naver Blog, Blogspot)
export async function searchBlogForEpisode(
  domain: string,
  website: string,
  animeTitle: string,
  episodeNumber: number,
  timeoutMs = 5000
): Promise<string | null> {
  const resolvedTitle = await resolveKoreanTitle(animeTitle);
  const targetSeason = parseSeason(resolvedTitle) || parseSeason(animeTitle);
  const targetEp = episodeNumber;

  let cleanBase = resolvedTitle.replace(/[\(\[\{<~].*?[\]\)\}>~]/g, "").trim();
  cleanBase = cleanBase.replace(/\s+\d+기$/g, "").trim();
  cleanBase = cleanBase.replace(/\b\d+(?:st|nd|rd|th)\b/gi, "").trim();
  cleanBase = cleanBase.replace(/season\s*\d+/gi, "").trim();
  cleanBase = cleanTitle(cleanBase);

  const words = cleanBase
    .split(/\s+/)
    .filter((w) => !["시즌", "더빙", "자막", "극장판", "애니"].includes(w));
  const searchTerm = words.length >= 2 ? words.slice(0, 2).join(" ") : words[0] || cleanBase;

  const queries: string[] = [];
  if (targetSeason) {
    queries.push(`${searchTerm} ${targetSeason}기 ${targetEp}화`);
    queries.push(`${searchTerm} ${targetSeason}기`);
  }
  queries.push(`${searchTerm} ${targetEp}화`);
  queries.push(`${searchTerm} ${String(targetEp).padStart(2, "0")}`);
  queries.push(`${searchTerm}`);

  try {
    // 1. Google Blogger (blogspot.com)
    if (domain.includes("blogspot.com")) {
      for (const q of queries) {
        const searchUrl = `https://${domain}/search?q=${encodeURIComponent(q)}`;
        const res = await fetch(searchUrl, {
          headers: HEADERS,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) continue;

        const html = await res.text();
        const $ = cheerio.load(html);

        let foundUrl = "";
        $(".post-title a, h3 a, .entry-title a").each((_, a) => {
          if (foundUrl) return;
          const title = $(a).text().trim();
          const href = $(a).attr("href")?.trim() || "";
          if (!href || href.includes("report-abuse")) return;

          const postSeason = parseSeason(title);
          const postEps = parseEpisodes(title);

          if (targetSeason !== null && postSeason !== null && targetSeason !== postSeason) {
            return;
          }

          if (postEps.includes(targetEp)) {
            foundUrl = href;
          }
        });

        if (foundUrl) return foundUrl;
      }
    }
    // 2. Tistory
    else if (domain.includes("tistory.com")) {
      for (const q of queries) {
        const searchUrl = `https://${domain}/search/${encodeURIComponent(q)}`;
        const res = await fetch(searchUrl, {
          headers: HEADERS,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) continue;

        const html = await res.text();
        const $ = cheerio.load(html);

        let foundUrl = "";
        $(".link-article, .link_article, .post-item a, .title a, a[href*='/entry/'], article a, .article-content a, .entry-content a").each((_, a) => {
          if (foundUrl) return;
          let title = $(a).text().trim();
          if (!title) {
            title = $(a).attr("title") || $(a).closest("article, .post-item, .article-content, li").text().trim();
          }
          const href = $(a).attr("href")?.trim() || "";
          if (!href || href.startsWith("#") || href.includes("category")) return;

          const postSeason = parseSeason(title);
          const postEps = parseEpisodes(title);

          if (targetSeason !== null && postSeason !== null && targetSeason !== postSeason) {
            return;
          }

          if (postEps.includes(targetEp)) {
            foundUrl = new URL(href, website).toString();
          }
        });

        if (foundUrl) return foundUrl;
      }
    }
    // 3. Naver Blog
    else if (domain.includes("blog.naver.com")) {
      const m = website.match(/blog\.naver\.com\/([^/?#]+)/);
      if (m) {
        const blogId = m[1];
        for (const q of queries.slice(0, 2)) {
          const searchUrl = `https://blog.naver.com/PostSearchList.naver?blogId=${blogId}&searchText=${encodeURIComponent(q)}`;
          const res = await fetch(searchUrl, {
            headers: HEADERS,
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!res.ok) continue;

          const html = await res.text();
          const $ = cheerio.load(html);

          let foundUrl = "";
          $("a.link, .title a, a[href*='logNo=']").each((_, a) => {
            if (foundUrl) return;
            const href = $(a).attr("href")?.trim() || "";
            const title = $(a).text().trim();
            if (!href) return;

            const postSeason = parseSeason(title);
            const postEps = parseEpisodes(title);

            if (targetSeason !== null && postSeason !== null && targetSeason !== postSeason) {
              return;
            }

            if (postEps.includes(targetEp)) {
              foundUrl = href;
            }
          });

          if (foundUrl) return foundUrl;
        }
      }
    }
  } catch (e) {
    console.warn("[searchBlogForEpisode error]:", e);
  }
  return null;
}

// 11. Fetch creator subtitle from their blog post (jcore와 100% 동일한 강력한 추출 엔진)
export async function fetchCreatorSubtitle(
  creatorName: string,
  website: string,
  animeTitle: string,
  episodeNumber: number,
  timeoutMs = 5000
): Promise<SubtitleResult | null> {
  if (!website) return null;
  try {
    const domain = new URL(website).hostname.toLowerCase();
    // Cloudflare Turnstile 보안 캡차가 적용된 독자 사이트(erulabo.com 등)는 자동 다운로드가 불가하므로 불필요한 타임아웃 방지를 위해 즉시 스킵
    if (domain.includes("erulabo.com") || creatorName.includes("에루샤")) {
      return null;
    }

    const resolvedTitle = await resolveKoreanTitle(animeTitle);
    const targetSeason = parseSeason(resolvedTitle) || parseSeason(animeTitle);

    // 단일 페이지에서 자막 파일(첨부파일/구글드라이브/다운로드링크) 추출 헬퍼 함수
    const tryExtractFromPage = async (targetUrl: string): Promise<SubtitleResult | null> => {
      try {
        let postUrl = targetUrl;
        const reqHeaders: Record<string, string> = { ...HEADERS };

        // 네이버 블로그: 프레임셋 우회용 PostView.naver URL로 자동 변환
        if (domain.includes("blog.naver.com")) {
          const m = targetUrl.match(/blog\.naver\.com\/([^/?&]+)\/(\d+)/) ||
                    targetUrl.match(/blog\.naver\.com\/([^/?&]+).*?[?&]logNo=(\d+)/);
          if (m) {
            postUrl = `https://blog.naver.com/PostView.naver?blogId=${m[1]}&logNo=${m[2]}`;
          }
          reqHeaders["Referer"] = "https://blog.naver.com/";
        }

        const res = await fetch(postUrl, {
          headers: reqHeaders,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return null;

        const html = await res.text();
        const $ = cheerio.load(html);

        // 1) 티스토리 첨부파일 (tfile, attachment, kakaocdn.net)
        if (domain.includes("tistory.com")) {
          const links: string[] = [];
          $('a[href*="tfile"], a[href*="attachment"], a[href*="kakaocdn.net"]').each((_, a) => {
            const href = $(a).attr("href")?.trim();
            if (href) links.push(new URL(href, postUrl).toString());
          });

          for (const dlUrl of links) {
            const buf = await downloadFileWithTimeout(dlUrl, postUrl, timeoutMs + 1000);
            if (buf && buf.length > 50) {
              const extracted = extractSubtitleFromBuffer(buf, episodeNumber, dlUrl);
              if (extracted) {
                return {
                  name: creatorName,
                  episode: episodeNumber,
                  orig_filename: extracted.orig_filename,
                  format: extracted.format,
                  is_ass: extracted.is_ass,
                  content: extracted.content,
                };
              }
            }
          }
        }

        // 2) 네이버 블로그 첨부파일 (download.blog.naver.com, blogfiles.naver.net, attach)
        else if (domain.includes("blog.naver.com")) {
          const links: string[] = [];
          $('a[href*="download.blog.naver.com"], a[href*="blogfiles.naver.net"], a[href*="attach"]').each((_, a) => {
            const href = $(a).attr("href")?.trim();
            if (href) links.push(href);
          });

          for (const dlUrl of links) {
            const buf = await downloadFileWithTimeout(dlUrl, "https://blog.naver.com/", timeoutMs + 1000);
            if (buf && buf.length > 50) {
              const extracted = extractSubtitleFromBuffer(buf, episodeNumber, dlUrl);
              if (extracted) {
                return {
                  name: creatorName,
                  episode: episodeNumber,
                  orig_filename: extracted.orig_filename,
                  format: extracted.format,
                  is_ass: extracted.is_ass,
                  content: extracted.content,
                };
              }
            }
          }
        }

        // 3) 구글 블로거 / 구글 드라이브 첨부 링크
        interface ScoredLink {
          url: string;
          score: number;
        }
        const gdriveMatches: ScoredLink[] = [];
        const seenGdrive = new Set<string>();
        const epStr = String(episodeNumber);
        const epPad = epStr.padStart(2, "0");

        $("a[href]").each((_, a) => {
          const href = $(a).attr("href")?.trim() || "";
          if (extractGdriveId(href) && !seenGdrive.has(href)) {
            seenGdrive.add(href);
            const text = $(a).text().trim().toLowerCase();
            let score = 0;
            if (
              text.includes(`${epStr}화`) ||
              text.includes(`${epPad}화`) ||
              text.includes(` ${epStr} `) ||
              text.includes(` ${epPad} `)
            ) {
              score += 60;
            }
            if (text.includes("~") || text.includes("전편") || text.includes("통합") || text.includes("완결")) {
              score += 20;
            }
            if (text.includes("폰트") || text.includes("font") || text.includes("op") || text.includes("ed")) {
              score -= 60;
            }
            gdriveMatches.push({ url: href, score });
          }
        });

        const bodyMatches = html.match(
          /https?:\/\/(?:drive|docs)\.google\.com\/(?:file\/d\/|uc\?[^"'\s<>]*?id=|open\?id=)([a-zA-Z0-9_-]{25,})/gi
        );
        if (bodyMatches) {
          for (const bm of bodyMatches) {
            if (!seenGdrive.has(bm)) {
              seenGdrive.add(bm);
              gdriveMatches.push({ url: bm, score: 0 });
            }
          }
        }

        // 일치도 점수가 높은 링크부터 우선 다운로드
        gdriveMatches.sort((a, b) => b.score - a.score);

        for (const item of gdriveMatches) {
          const buf = await downloadFileWithTimeout(item.url, postUrl, timeoutMs + 1500);
          if (buf && buf.length > 50) {
            const extracted = extractSubtitleFromBuffer(buf, episodeNumber, item.url);
            if (extracted) {
              return {
                name: creatorName,
                episode: episodeNumber,
                orig_filename: extracted.orig_filename,
                format: extracted.format,
                is_ass: extracted.is_ass,
                content: extracted.content,
              };
            }
          }
        }

        // 4) 일반 링크 (.zip, .smi, .srt, .ass, .vtt)
        const fileLinks: string[] = [];
        $("a[href]").each((_, a) => {
          const href = $(a).attr("href")?.trim() || "";
          const text = $(a).text().trim().toLowerCase();
          if (
            href.endsWith(".zip") ||
            href.endsWith(".smi") ||
            href.endsWith(".srt") ||
            href.endsWith(".ass") ||
            href.endsWith(".ssa") ||
            href.endsWith(".vtt") ||
            text.includes(".zip") ||
            text.includes(".smi") ||
            text.includes(".ass") ||
            text.includes(".srt") ||
            text.includes("자막 다운")
          ) {
            try {
              fileLinks.push(new URL(href, postUrl).toString());
            } catch {}
          }
        });

        for (const fUrl of fileLinks) {
          const buf = await downloadFileWithTimeout(fUrl, postUrl, timeoutMs + 1000);
          if (buf && buf.length > 50) {
            const extracted = extractSubtitleFromBuffer(buf, episodeNumber, fUrl);
            if (extracted) {
              return {
                name: creatorName,
                episode: episodeNumber,
                orig_filename: extracted.orig_filename,
                format: extracted.format,
                is_ass: extracted.is_ass,
                content: extracted.content,
              };
            }
          }
        }
      } catch (err) {
        console.warn(`[tryExtractFromPage error] ${targetUrl}:`, err);
      }
      return null;
    };

    // 🌟 1단계: 초기 등록 링크(website) 자체가 포스트/회차 글인지 확인 후 직접 추출 시도
    const isSpecificPost =
      /\.(?:html|htm)$/i.test(website) ||
      /\/(?:\d+|entry\/[^\/]+)$/i.test(website) ||
      website.includes("blog-post_");

    let isInitialUrlCurrentEp = false;
    let postSeasonMatch = true;

    try {
      const initRes = await fetch(website, {
        headers: HEADERS,
        signal: AbortSignal.timeout(4000),
      });
      if (initRes.ok) {
        const initHtml = await initRes.text();
        const $init = cheerio.load(initHtml);
        const pageTitle = $init("title").text().trim() || "";
        const pSeason = parseSeason(`${pageTitle} ${website}`);
        const pEps = parseEpisodes(`${pageTitle} ${website}`);

        if (targetSeason !== null && pSeason !== null && targetSeason !== pSeason) {
          postSeasonMatch = false;
        }

        if (postSeasonMatch && (pEps.includes(episodeNumber) || isSpecificPost)) {
          isInitialUrlCurrentEp = true;
        }
      }
    } catch {}

    if (isInitialUrlCurrentEp) {
      const initExtracted = await tryExtractFromPage(website);
      if (initExtracted) return initExtracted;
    }

    // 🌟 2단계: 초기 URL이 해당 회차가 아니거나 추출 실패 시, 블로그 전체에서 현재 회차 포스트 자동 탐색
    const matchedPostUrl = await searchBlogForEpisode(domain, website, animeTitle, episodeNumber, timeoutMs);
    if (matchedPostUrl) {
      const searchExtracted = await tryExtractFromPage(matchedPostUrl);
      if (searchExtracted) return searchExtracted;
    }
  } catch (e) {
    console.error(`[fetchCreatorSubtitle error] ${creatorName}:`, e);
  }
  return null;
}

// 12-1. Generate smart search queries for Anissia (다단계 스마트 검색어 생성)
export function generateAnissiaSearchQueries(rawTitle: string): string[] {
  const queries = new Set<string>();
  if (!rawTitle) return [];

  let t = rawTitle;
  // 1) 괄호류 태그 제거 ([BD], (더빙) 등)
  t = t.replace(/\[.*?\]|\(.*?\)|【.*?】|<.*?>/g, " ");
  // 2) 끝에 붙은 "1130화", "1화" 등 회차 제거
  t = t.replace(/\s+\d+화(?:\s|$)/g, " ");
  // 3) BD, Rip, 더빙, 자막 제거
  t = t.replace(/\b(BD|Rip|더빙|자막)\b/gi, " ");

  // 한글 부분 추출 (영문 부제 분리: 예 "뫼비우스 더스트 Mebius Dust" -> "뫼비우스 더스트")
  let korOnly = "";
  const matchKor = t.match(/[가-힣0-9\s~:-]+/g);
  if (matchKor) {
    korOnly = matchKor.join(" ").replace(/\s+/g, " ").trim();
  }

  // 시즌/기수 제거
  const removeSeason = (str: string) => {
    return str
      .replace(/\s*\d+\s*기\b/g, "")
      .replace(/season\s*\d+/gi, "")
      .replace(/\b\d+(?:st|nd|rd|th)\b/gi, "")
      .replace(/\s+[ⅠⅡⅢⅣⅤⅥII|III|IV|V|VI]\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  };

  // 구분자(~, -, :, 「, 『) 앞의 대표명사 추출
  const getMainBeforeSeparator = (str: string) => {
    for (const sep of ["~", "-", ":", "「", "『"]) {
      if (str.includes(sep) && !str.startsWith(sep)) {
        return str.split(sep)[0].trim();
      }
    }
    return "";
  };

  const addCandidates = (base: string) => {
    if (!base) return;
    const cleaned = base.replace(/[^\w\s가-힣a-zA-Z0-9]/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned.length >= 2) {
      queries.add(cleaned);

      // 띄어쓰기 변형 (공백 없는 4글자 이상 한글: 예 "무직전생" -> "무직 전생")
      if (!cleaned.includes(" ") && cleaned.length >= 4) {
        queries.add(cleaned.slice(0, 2) + " " + cleaned.slice(2));
      }

      // 첫 1~2단어 (불용어 제외)
      const words = cleaned.split(/\s+/).filter((w) => !["시즌", "더빙", "자막", "극장판", "애니", "1기", "2기", "3기", "4기", "5기"].includes(w));
      if (words.length >= 1 && words[0].length >= 2) {
        queries.add(words[0]);
      }
      if (words.length >= 2) {
        queries.add(`${words[0]} ${words[1]}`);
      }
    }
  };

  const mainSep = getMainBeforeSeparator(t);
  if (mainSep) {
    addCandidates(removeSeason(mainSep));
    addCandidates(mainSep);
  }

  if (korOnly) {
    addCandidates(removeSeason(korOnly));
    addCandidates(korOnly);
  }

  const baseCleaned = removeSeason(t);
  addCandidates(baseCleaned);
  addCandidates(t);

  return Array.from(queries).filter((q) => q.length >= 2);
}

// 12-2. Anime Match Scorer (가중치 기반 최적 작품 매칭기 - 오매칭 원천 차단)
export function scoreAnimeMatch(
  rawTitle: string,
  targetSeason: number | null,
  item: { animeNo: number; subject: string },
  resolvedTitle?: string
): number {
  const itemSubject = item.subject || "";
  const itemSeason = parseSeason(itemSubject);

  let score = 0;

  // 1) 제목 완전 일치 또는 상호 포함 여부 (영문 원제 및 번역된 한국어 제목 모두 대조)
  const cleanRaw = rawTitle.replace(/[^\w가-힣0-9]/g, "").toLowerCase();
  const cleanComp = (resolvedTitle || rawTitle).replace(/[^\w가-힣0-9]/g, "").toLowerCase();
  const cleanItem = itemSubject.replace(/[^\w가-힣0-9]/g, "").toLowerCase();

  if (cleanRaw === cleanItem || cleanComp === cleanItem) {
    score += 150;
  } else if (
    cleanItem.includes(cleanRaw) ||
    cleanRaw.includes(cleanItem) ||
    cleanItem.includes(cleanComp) ||
    cleanComp.includes(cleanItem)
  ) {
    score += 80;
  }

  // 2) 시즌 일치 점수
  if (targetSeason === null) {
    // 1기이거나 단편인 경우
    if (itemSeason === null || itemSeason === 1) {
      score += 40;
    } else {
      // 대상이 2기, 3기 등 후속작이면 큰 감점
      score -= 60;
    }
  } else {
    // 특정 시즌(2기 이상)인 경우
    if (itemSeason === targetSeason) {
      score += 60;
    } else if (itemSeason === null) {
      score -= 20;
    } else {
      // 시즌이 완전히 다른 경우 대폭 감점 (예: 2기 찾는데 5기)
      score -= 100;
    }
  }

  // 3) 극장판 / 외전 패널티
  const isTargetMovie = /극장판|movie/i.test(rawTitle) || (resolvedTitle ? /극장판|movie/i.test(resolvedTitle) : false);
  const isItemMovie = /극장판|movie/i.test(itemSubject);
  if (isTargetMovie && isItemMovie) {
    score += 40;
  } else if (!isTargetMovie && isItemMovie) {
    score -= 40; // TV 시리즈 찾는데 극장판이면 감점
  }

  const isTargetSpinOff = /외전|팬레터|스페셜|멍!/i.test(rawTitle) || (resolvedTitle ? /외전|팬레터|스페셜|멍!/i.test(resolvedTitle) : false);
  const isItemSpinOff = /외전|팬레터|스페셜|멍!/i.test(itemSubject);
  if (!isTargetSpinOff && isItemSpinOff) {
    score -= 50; // 본편 찾는데 스핀오프면 감점
  }

  // 4) 단어 오버랩 점수
  const checkWords = (resolvedTitle || rawTitle).split(/\s+/).filter((w) => w.length >= 2);
  let overlapWords = 0;
  for (const w of checkWords) {
    if (itemSubject.includes(w)) overlapWords++;
  }
  score += overlapWords * 15;

  return score;
}

// 12-3. Anissia API query for subtitle creators with smart multi-stage search
export async function getAnissiaCreators(
  title: string,
  episodeNumber: number,
  timeoutMs = 3500,
  directAnimeNo?: number | null
): Promise<CreatorInfo[]> {
  const results: CreatorInfo[] = [];
  try {
    let bestAnime: { animeNo: number; subject: string } | null = null;
    let bestScore = 0;

    // 만약 애니시아 animeNo가 직접 전달된 경우 (애니시아 허브 모드) 0.05초 직통 조회
    if (directAnimeNo && directAnimeNo > 0) {
      bestAnime = { animeNo: directAnimeNo, subject: title };
      bestScore = 150;
    } else {
      const resolvedTitle = await resolveKoreanTitle(title);
      const targetSeason = parseSeason(resolvedTitle) || parseSeason(title);
      const queries = generateAnissiaSearchQueries(resolvedTitle);
      if (resolvedTitle !== title) {
        for (const q of generateAnissiaSearchQueries(title)) {
          if (!queries.includes(q)) queries.push(q);
        }
      }

      // 최대 4개의 스마트 쿼리를 순차/조기종료 방식으로 검색
      for (const q of queries.slice(0, 4)) {
        try {
          const url = `https://api.anissia.net/anime/list/0?q=${encodeURIComponent(q)}`;
          const res = await fetch(url, {
            headers: HEADERS,
            signal: AbortSignal.timeout(timeoutMs),
          });

          if (!res.ok) continue;
          const json = await res.json();
          const content: Array<{ animeNo: number; subject: string }> = json?.data?.content || [];
          if (content.length === 0) continue;

          for (const item of content) {
            const sc = scoreAnimeMatch(title, targetSeason, item, resolvedTitle);
            if (sc > bestScore) {
              bestScore = sc;
              bestAnime = item;
            }
          }

          // 높은 신뢰도(120점 이상)인 경우 추가 쿼리 검색 생략
          if (bestScore >= 120) {
            break;
          }
        } catch {}
      }

      // 신뢰도 점수가 50점 미만이면 오매칭(다른 작품 자막) 방지를 위해 제외
      if (!bestAnime || bestScore < 50) {
        return results;
      }
    }

    const capUrl = `https://api.anissia.net/anime/caption/animeNo/${bestAnime.animeNo}`;
    const capRes = await fetch(capUrl, {
      headers: HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (capRes.ok) {
      const capJson = await capRes.json();
      const captions = capJson?.data || [];
      const seenNames = new Set<string>();

      for (const c of captions) {
        const name = (c.name || "제작자").trim();
        if (seenNames.has(name)) continue;
        seenNames.add(name);

        const epStr = String(c.episode || "");
        const isCurrent = epStr.includes(String(episodeNumber));
        results.push({
          name,
          episode: epStr,
          update_date: (c.updDt || "").replace("T", " ").slice(0, 16),
          website: (c.website || "").trim(),
          is_current_ep: isCurrent,
        });
      }
    }
  } catch (e) {
    console.error("[getAnissiaCreators error]:", e);
  }
  return results;
}

// 13. High-level parallel searcher with 13-Second Safety Guard
export async function searchAllSubtitlesParallel(
  title: string,
  episodeNumber: number,
  maxTotalTimeMs = 13000,
  directAnimeNo?: number | null
): Promise<{ subtitles: SubtitleResult[]; creators: CreatorInfo[] }> {
  // Create an overall timeout promise that resolves at 13 seconds
  let timeoutHandle: NodeJS.Timeout;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(null), maxTotalTimeMs);
  });

  const workerPromise = (async () => {
    const resolvedTitle = await resolveKoreanTitle(title);
    const targetTitle = resolvedTitle || title;

    // 1. Fetch Anissia creators and Kairan search concurrently
    const [anissiaCreators, kairanSub] = await Promise.all([
      getAnissiaCreators(targetTitle, episodeNumber, 3500, directAnimeNo),
      findKairanSubtitle(targetTitle, episodeNumber, 3500),
    ]);

    const collectedSubs: SubtitleResult[] = [];
    if (kairanSub) {
      collectedSubs.push(kairanSub);
    }

    // 2. Filter valid creators who have an active blog for this episode
    const candidateCreators = anissiaCreators.filter(
      (c) => c.website && c.website.startsWith("http")
    );

    // Limit to top 4 creators to avoid excessive concurrency
    const topCreators = candidateCreators.slice(0, 4);

    // 3. Parallel fetch creator subtitles with individual 3.5s timeouts
    const creatorSubPromises = topCreators.map((c) =>
      fetchCreatorSubtitle(c.name, c.website, targetTitle, episodeNumber, 3500)
    );

    const settled = await Promise.allSettled(creatorSubPromises);
    for (const s of settled) {
      if (s.status === "fulfilled" && s.value) {
        collectedSubs.push(s.value);
      }
    }

    return {
      subtitles: collectedSubs,
      creators: anissiaCreators,
    };
  })();

  try {
    const winner = await Promise.race([workerPromise, timeoutPromise]);
    clearTimeout(timeoutHandle!);
    if (winner) {
      return winner;
    }
    // If timed out at 13s, return whatever is empty or basic fallback safely
    return { subtitles: [], creators: [] };
  } catch {
    clearTimeout(timeoutHandle!);
    return { subtitles: [], creators: [] };
  }
}

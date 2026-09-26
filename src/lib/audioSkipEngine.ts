/**
 * 브라우저 기반 Web Audio 애니메이션 오프닝/엔딩(OP/ED) 스킵 분석 엔진
 * - 앞 4분(240초) OP 분석 -> 완료 후 뒤 2.5분(150초) ED 순차 분석
 * - CENS (Chroma Energy Normalized Statistics) 12-피치 클래스 기반
 * - 90초 크로마 지문 DB 저장 및 1:1 템플릿 매칭 캐시
 * - 4단계 파이프라인: 1) DB 스킵 -> 2) DB 크로마 매칭 -> 3) AniSkip -> 4) 브라우저 교차 분석
 */

export const SAMPLE_RATE = 11025;
export const HOP_LENGTH = 2048;
export const OP_SEARCH_SEC = 240; // 앞 4분 고정
export const ED_SEARCH_SEC = 150; // 뒤 2.5분 고정
export const SIMILARITY_THRESHOLD = 0.70; // 일치 판정 임계값 (70% 이상)
export const CORE_SEC = 60.0; // 코어 탐색 윈도우 (60초)

export interface SkipIntervalResult {
  type: "op" | "ed";
  label: "오프닝" | "엔딩";
  start: number;
  end: number;
  score?: number;
}

export interface PipelineProgress {
  step: string;
  progress: number; // 0 to 100
  detail?: string;
}

// ==========================================
// 1. MPEG-TS -> AAC ADTS Demuxer (tsDemuxer 재내보내기)
// ==========================================
import { extractAacFromTs, isTsStream, isAacStream } from "./tsDemuxer";
export { extractAacFromTs, isTsStream, isAacStream };

// ==========================================
// 2. Web Audio 디코딩 (11025Hz 모노 PCM)
// ==========================================
export async function decodeAudioSegments(
  segmentUrls: string[],
  onProgress?: (ratio: number) => void,
  fallbackUrls?: string[]
): Promise<Float32Array | null> {
  const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtxClass) {
    throw new Error("Web Audio API not supported in this browser");
  }

  const audioCtx = new AudioCtxClass();
  const buffers: (ArrayBuffer | null)[] = new Array(segmentUrls.length).fill(null);

  // 세그먼트 병렬 다운로드 (동시 6개 풀)
  // 우선순위 1: 원본 스트리밍 CDN에서 브라우저가 직접 다운로드 (Vercel 대역폭 0B 소모)
  // 우선순위 2: CORS 차단 등으로 실패 시 서버 프록시(audio=1)로 안전 폴백
  const CONCURRENCY = 6;
  let currentIndex = 0;
  let completedCount = 0;

  async function worker() {
    while (currentIndex < segmentUrls.length) {
      const idx = currentIndex++;
      try {
        const resp = await fetch(segmentUrls[idx]);
        if (resp.ok) {
          const ab = await resp.arrayBuffer();
          buffers[idx] = ab;
        } else if (fallbackUrls && fallbackUrls[idx]) {
          const fResp = await fetch(fallbackUrls[idx]);
          if (fResp.ok) {
            buffers[idx] = await fResp.arrayBuffer();
          }
        }
      } catch (e) {
        // 직접 fetch 시 CORS 등으로 실패할 경우 서버 프록시로 안전 폴백
        if (fallbackUrls && fallbackUrls[idx]) {
          try {
            const fResp = await fetch(fallbackUrls[idx]);
            if (fResp.ok) {
              buffers[idx] = await fResp.arrayBuffer();
            }
          } catch (e2) {
            console.warn("[Segment fetch error]:", segmentUrls[idx], e, e2);
          }
        } else {
          console.warn("[Segment fetch error]:", segmentUrls[idx], e);
        }
      }
      completedCount++;
      if (onProgress) {
        onProgress((completedCount / segmentUrls.length) * 0.5);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, segmentUrls.length) },
    () => worker()
  );
  await Promise.all(workers);

  const rawBuffers = buffers.filter(
    (b): b is ArrayBuffer => b !== null && b.byteLength > 0
  );

  if (rawBuffers.length === 0) {
    audioCtx.close();
    return null;
  }

  // 전체 청크 합치기 (순서 보장)
  let totalBytes = 0;
  for (const buf of rawBuffers) totalBytes += buf.byteLength;
  const joinedData = new Uint8Array(totalBytes);
  let offset = 0;
  for (const buf of rawBuffers) {
    joinedData.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  // 서버에서 순수 오디오(AAC)로 변환되었는지, 원본 TS인지 판별
  let aacData: Uint8Array;
  if (isTsStream(joinedData)) {
    // TS 스트림인 경우 클라이언트에서 AAC 추출
    aacData = extractAacFromTs(joinedData);
  } else {
    // 이미 서버에서 AAC 오디오만 추출되어 전달됨
    aacData = joinedData;
  }

  const audioArrayBuffer = aacData.buffer.slice(
    aacData.byteOffset,
    aacData.byteOffset + aacData.byteLength
  );

  let audioBuffer: AudioBuffer | null = null;
  try {
    audioBuffer = await audioCtx.decodeAudioData(audioArrayBuffer as ArrayBuffer);
  } catch (err) {
    // 디코딩 실패 시 전체 원본 버퍼로 1회 재시도
    try {
      const fallbackBuf = joinedData.buffer.slice(
        joinedData.byteOffset,
        joinedData.byteOffset + joinedData.byteLength
      );
      audioBuffer = await audioCtx.decodeAudioData(fallbackBuf as ArrayBuffer);
    } catch (e2) {
      console.error("[Audio decode failed]:", err, e2);
      audioCtx.close();
      return null;
    }
  }

  audioCtx.close();

  if (!audioBuffer) return null;

  // 11025Hz 모노로 리샘플링
  const origSr = audioBuffer.sampleRate;
  const origLen = audioBuffer.length;
  const origData = audioBuffer.getChannelData(0); // 채널 0 (모노)

  const targetLen = Math.floor(origLen * (SAMPLE_RATE / origSr));
  const pcm = new Float32Array(targetLen);

  const step = origSr / SAMPLE_RATE;
  for (let i = 0; i < targetLen; i++) {
    const srcIdx = Math.min(origLen - 1, Math.floor(i * step));
    pcm[i] = origData[srcIdx];
  }

  if (onProgress) {
    onProgress(1.0);
  }

  return pcm;
}

// ==========================================
// 3. Fast Fourier Transform (FFT) & CENS 크로마 추출
// ==========================================
function fftRadix2(re: Float32Array, im: Float32Array) {
  const n = re.length;
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      const tempR = re[i];
      re[i] = re[j];
      re[j] = tempR;
      const tempI = im[i];
      im[i] = im[j];
      im[j] = tempI;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  for (let l = 2; l <= n; l <<= 1) {
    const halfL = l >> 1;
    const angle = (-2 * Math.PI) / l;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);
    for (let i = 0; i < n; i += l) {
      let curWR = 1.0;
      let curWI = 0.0;
      for (let m = 0; m < halfL; m++) {
        const uR = re[i + m];
        const uI = im[i + m];
        const vR = re[i + m + halfL] * curWR - im[i + m + halfL] * curWI;
        const vI = re[i + m + halfL] * curWI + im[i + m + halfL] * curWR;
        re[i + m] = uR + vR;
        im[i + m] = uI + vI;
        re[i + m + halfL] = uR - vR;
        im[i + m + halfL] = uI - vI;
        const nextWR = curWR * wStepR - curWI * wStepI;
        const nextWI = curWR * wStepI + curWI * wStepR;
        curWR = nextWR;
        curWI = nextWI;
      }
    }
  }
}

export function extractCENS(pcm: Float32Array): Float32Array {
  const nFft = 2048;
  const halfFft = nFft / 2;
  const numFrames = Math.max(1, Math.floor((pcm.length - nFft) / HOP_LENGTH) + 1);

  // 12 x numFrames 크기의 크로마 행렬 (row-major: chroma[pitch * numFrames + frame])
  const chroma = new Float32Array(12 * numFrames);

  // Hann Window 미리 계산
  const hann = new Float32Array(nFft);
  for (let i = 0; i < nFft; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (nFft - 1)));
  }

  // 주파수 bin별 pitch mapping 테이블 미리 생성 (65Hz ~ 2100Hz)
  const binPitch = new Int8Array(halfFft);
  const freqStep = SAMPLE_RATE / nFft;
  for (let k = 1; k < halfFft; k++) {
    const f = k * freqStep;
    if (f >= 65 && f <= 2100) {
      const midi = Math.round(12 * Math.log2(f / 440) + 69);
      binPitch[k] = ((midi % 12) + 12) % 12;
    } else {
      binPitch[k] = -1;
    }
  }

  const re = new Float32Array(nFft);
  const im = new Float32Array(nFft);

  for (let t = 0; t < numFrames; t++) {
    const startIdx = t * HOP_LENGTH;
    for (let i = 0; i < nFft; i++) {
      re[i] = (pcm[startIdx + i] || 0) * hann[i];
      im[i] = 0;
    }

    fftRadix2(re, im);

    // 12 피치 클래스 에너지 누적
    for (let k = 1; k < halfFft; k++) {
      const pitch = binPitch[k];
      if (pitch >= 0) {
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        chroma[pitch * numFrames + t] += mag;
      }
    }
  }

  // 시간 축 이동 평균 스무딩 (윈도우 크기 11)
  const smoothed = new Float32Array(12 * numFrames);
  const winHalf = 5;
  for (let p = 0; p < 12; p++) {
    const pOffset = p * numFrames;
    for (let t = 0; t < numFrames; t++) {
      let sum = 0;
      let cnt = 0;
      const minI = Math.max(0, t - winHalf);
      const maxI = Math.min(numFrames - 1, t + winHalf);
      for (let i = minI; i <= maxI; i++) {
        sum += chroma[pOffset + i];
        cnt++;
      }
      smoothed[pOffset + t] = sum / cnt;
    }
  }

  // Zero-mean 및 단위 벡터 정규화 (피어슨 상관 최적화)
  for (let t = 0; t < numFrames; t++) {
    let mean = 0;
    for (let p = 0; p < 12; p++) {
      mean += smoothed[p * numFrames + t];
    }
    mean /= 12;

    let normSq = 0;
    for (let p = 0; p < 12; p++) {
      const centered = smoothed[p * numFrames + t] - mean;
      smoothed[p * numFrames + t] = centered;
      normSq += centered * centered;
    }

    const norm = Math.sqrt(normSq);
    if (norm > 1e-4) {
      for (let p = 0; p < 12; p++) {
        smoothed[p * numFrames + t] /= norm;
      }
    } else {
      for (let p = 0; p < 12; p++) {
        smoothed[p * numFrames + t] = 0;
      }
    }
  }

  return smoothed;
}

// ==========================================
// 4. 경계 정밀 검출 (Dynamic Drop-off & Safety Margin)
// ==========================================
export function findExactBoundaries(
  diagVals: Float32Array,
  coreStartIdx: number,
  coreFrames: number,
  fps: number,
  threshold = 0.55
): { startIdx: number; endIdx: number; durSec: number } {
  const L = diagVals.length;
  const coreEndIdx = coreStartIdx + coreFrames;

  // 1. 시작점 탐색 (Backward)
  let startIdx = coreStartIdx;
  let lowCount = 0;
  const maxBackFrames = Math.round(35.0 * fps);
  const minSearchIdx = Math.max(0, coreStartIdx - maxBackFrames);
  for (let idx = coreStartIdx - 1; idx >= minSearchIdx; idx--) {
    if (diagVals[idx] < threshold) {
      lowCount++;
      if (lowCount >= 2) {
        startIdx = idx + 2;
        break;
      }
    } else {
      lowCount = 0;
      startIdx = idx;
    }
  }

  // 2. 종료점 탐색 (Forward)
  let endIdx = coreEndIdx;
  lowCount = 0;
  const maxFwdFrames = Math.round(35.0 * fps);
  const maxSearchIdx = Math.min(L, coreEndIdx + maxFwdFrames);
  for (let idx = coreEndIdx; idx < maxSearchIdx; idx++) {
    if (diagVals[idx] < threshold) {
      lowCount++;
      if (lowCount >= 2) {
        endIdx = idx - 1;
        break;
      }
    } else {
      lowCount = 0;
      endIdx = idx + 1;
    }
  }

  // 대사/타이틀 보존을 위한 1.0초 안전 여유 적용
  const marginFrames = Math.round(1.0 * fps);
  let safeEndIdx = Math.max(coreEndIdx, endIdx - marginFrames);
  let durSec = (safeEndIdx - startIdx) / fps;

  // 일반 애니메이션 테마 길이(75초 ~ 93초) 벗어날 시 안전 보정
  if (durSec < 75.0 || durSec > 93.0) {
    safeEndIdx = Math.min(L - 1, startIdx + Math.round(88.0 * fps));
    durSec = (safeEndIdx - startIdx) / fps;
  }

  return { startIdx, endIdx: safeEndIdx, durSec };
}

// ==========================================
// 5. 1D 템플릿(지문) 고속 매칭 (2순위)
// ==========================================
export function matchTemplate(
  currChroma: Float32Array,
  currFrames: number,
  templateChroma: Float32Array,
  templateFrames: number,
  threshold = SIMILARITY_THRESHOLD
): { score: number; start: number; end: number; durationSec: number } | null {
  if (currFrames < templateFrames) return null;

  const fps = SAMPLE_RATE / HOP_LENGTH;
  const durSec = templateFrames / fps;
  const outLen = currFrames - templateFrames + 1;

  let bestScore = -1.0;
  let bestIdx = 0;

  for (let t = 0; t < outLen; t++) {
    let dotSum = 0;
    for (let p = 0; p < 12; p++) {
      const cOffset = p * currFrames + t;
      const tOffset = p * templateFrames;
      for (let k = 0; k < templateFrames; k++) {
        dotSum += currChroma[cOffset + k] * templateChroma[tOffset + k];
      }
    }
    const score = dotSum / templateFrames;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = t;
    }
  }

  if (bestScore < threshold) return null;

  const startSec = Math.round((bestIdx / fps) * 10) / 10;
  const endSec = Math.round((startSec + durSec) * 10) / 10;

  return {
    score: Math.round(bestScore * 1000) / 1000,
    start: startSec,
    end: endSec,
    durationSec: Math.round(durSec * 10) / 10,
  };
}

// ==========================================
// 6. 2D 회차 교차 매칭 (4순위)
// ==========================================
export function matrixMatch(
  c1: Float32Array,
  t1Frames: number,
  c2: Float32Array,
  t2Frames: number,
  maxSearchSec: number,
  threshold = SIMILARITY_THRESHOLD
): {
  score: number;
  t1: number;
  t1End: number;
  t2: number;
  t2End: number;
  durSec: number;
  fingerprintSlice: Float32Array;
  fingerprintFrames: number;
} | null {
  const fps = SAMPLE_RATE / HOP_LENGTH;
  const coreFrames = Math.round(CORE_SEC * fps);

  if (t1Frames < coreFrames || t2Frames < coreFrames) {
    return null;
  }

  // 유사도 행렬 S (t1Frames x t2Frames)
  const S = new Float32Array(t1Frames * t2Frames);
  for (let i = 0; i < t1Frames; i++) {
    const rowOffset = i * t2Frames;
    for (let j = 0; j < t2Frames; j++) {
      let dot = 0;
      for (let p = 0; p < 12; p++) {
        dot += c1[p * t1Frames + i] * c2[p * t2Frames + j];
      }
      S[rowOffset + j] = dot;
    }
  }

  const diagMin = -(t1Frames - coreFrames);
  const diagMax = t2Frames - coreFrames;

  let bestScore = -1.0;
  let bestD = 0;
  let bestCoreIdx = 0;

  for (let d = diagMin; d < diagMax; d++) {
    const diagLen = d >= 0 ? Math.min(t1Frames, t2Frames - d) : Math.min(t1Frames + d, t2Frames);
    if (diagLen < coreFrames) continue;

    const diagVals = new Float32Array(diagLen);
    for (let k = 0; k < diagLen; k++) {
      const i = d >= 0 ? k : k - d;
      const j = d >= 0 ? k + d : k;
      diagVals[k] = S[i * t2Frames + j];
    }

    // 60초 코어 이동 평균
    let curSum = 0;
    for (let k = 0; k < coreFrames; k++) {
      curSum += diagVals[k];
    }

    const maLen = diagLen - coreFrames + 1;
    for (let k = 0; k < maLen; k++) {
      if (k > 0) {
        curSum += diagVals[k + coreFrames - 1] - diagVals[k - 1];
      }
      const score = curSum / coreFrames;
      if (score > bestScore) {
        const curT1 = (d >= 0 ? k : k - d) / fps;
        const curT2 = (d >= 0 ? k + d : k) / fps;
        if (curT1 <= maxSearchSec && curT2 <= maxSearchSec) {
          bestScore = score;
          bestD = d;
          bestCoreIdx = k;
        }
      }
    }
  }

  if (bestScore < threshold) return null;

  // 최고 일치 대각선 추출 및 경계 정밀 검출
  const diagLen = bestD >= 0 ? Math.min(t1Frames, t2Frames - bestD) : Math.min(t1Frames + bestD, t2Frames);
  const bestDiag = new Float32Array(diagLen);
  for (let k = 0; k < diagLen; k++) {
    const i = bestD >= 0 ? k : k - bestD;
    const j = bestD >= 0 ? k + bestD : k;
    bestDiag[k] = S[i * t2Frames + j];
  }

  const { startIdx, endIdx, durSec } = findExactBoundaries(
    bestDiag,
    bestCoreIdx,
    coreFrames,
    fps,
    0.55
  );

  const realT1Idx = bestD >= 0 ? startIdx : startIdx - bestD;
  const realT1EndIdx = bestD >= 0 ? endIdx : endIdx - bestD;
  const realT2Idx = bestD >= 0 ? startIdx + bestD : startIdx;
  const realT2EndIdx = bestD >= 0 ? endIdx + bestD : endIdx;

  const realT1 = Math.round((realT1Idx / fps) * 10) / 10;
  const realT1End = Math.round((realT1EndIdx / fps) * 10) / 10;
  const realT2 = Math.round((realT2Idx / fps) * 10) / 10;
  const realT2End = Math.round((realT2EndIdx / fps) * 10) / 10;

  // 90초 크로마 지문 슬라이스 추출 (c1에서 추출)
  const fpFrames = Math.max(1, realT1EndIdx - realT1Idx);
  const fpSlice = new Float32Array(12 * fpFrames);
  for (let p = 0; p < 12; p++) {
    const srcOffset = p * t1Frames + realT1Idx;
    const dstOffset = p * fpFrames;
    for (let k = 0; k < fpFrames; k++) {
      fpSlice[dstOffset + k] = c1[srcOffset + k] || 0;
    }
  }

  return {
    score: Math.round(bestScore * 1000) / 1000,
    t1: realT1,
    t1End: realT1End,
    t2: realT2,
    t2End: realT2End,
    durSec: Math.round(durSec * 10) / 10,
    fingerprintSlice: fpSlice,
    fingerprintFrames: fpFrames,
  };
}

// ==========================================
// 7. Base64 변환 헬퍼 (Float32Array <-> Base64)
// ==========================================
export function chromaToBase64(chroma: Float32Array): string {
  const bytes = new Uint8Array(chroma.buffer, chroma.byteOffset, chroma.byteLength);
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToChroma(base64: string): Float32Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Float32Array(bytes.buffer);
}

// ==========================================
// 8. 4단계 파이프라인 총괄 오케스트레이터
// ==========================================
export async function runAudioSkipPipeline(params: {
  animeId: string;
  episodeNumber: number;
  currentM3u8Url: string;
  compareEpisodeNumber?: number;
  onProgress?: (p: PipelineProgress) => void;
}): Promise<SkipIntervalResult[]> {
  const { animeId, episodeNumber, currentM3u8Url, compareEpisodeNumber, onProgress } = params;

  // [1단계]: DB 스킵 정보 확인
  if (onProgress) onProgress({ step: "1단계: 데이터베이스 스킵 조회 중...", progress: 10 });
  try {
    const skipRes = await fetch(
      `/api/anime/skip?title=${encodeURIComponent(animeId)}&ep=${episodeNumber}`
    );
    if (skipRes.ok) {
      const skipData = await skipRes.json();
      if (skipData.found && Array.isArray(skipData.intervals) && skipData.intervals.length > 0) {
        if (onProgress) onProgress({ step: "데이터베이스 스킵 로드 완료", progress: 100 });
        return skipData.intervals;
      }
    }
  } catch (e) {
    console.warn("[Pipeline Step 1 warning]:", e);
  }

  // [2단계]: DB 크로마 지문 확인 (1:1 템플릿 고속 매칭)
  let existingThemes: any[] = [];
  try {
    const themesRes = await fetch(`/api/anime/themes?anime_id=${encodeURIComponent(animeId)}`);
    if (themesRes.ok) {
      const tData = await themesRes.json();
      if (tData.success && Array.isArray(tData.themes)) {
        existingThemes = tData.themes;
      }
    }
  } catch (e) {
    console.warn("[Pipeline Step 2 themes lookup warning]:", e);
  }

  // 현재 회차 세그먼트 정보 가져오기 (앞 4분, 뒤 2.5분)
  if (onProgress) onProgress({ step: "재생 세그먼트 정보 수집 중...", progress: 20 });
  const curSegRes = await fetch(
    `/api/anime/stream/segments_info?url=${encodeURIComponent(currentM3u8Url)}&anime_id=${encodeURIComponent(animeId)}&ep=${episodeNumber}`
  );
  if (!curSegRes.ok) {
    throw new Error("Failed to fetch current episode segments");
  }
  const curSegData = await curSegRes.json();
  if (!curSegData.success) {
    throw new Error(curSegData.message || "Invalid segment data");
  }

  const detectedIntervals: SkipIntervalResult[] = [];

  // 크로마 지문이 등록되어 있으면 1:1 고속 매칭 시도
  if (existingThemes.length > 0) {
    if (onProgress) onProgress({ step: "2단계: 등록된 크로마 지문 1:1 매칭 중...", progress: 30 });

    const opTheme = existingThemes.find((t) => t.theme_type === "op");
    const edTheme = existingThemes.find((t) => t.theme_type === "ed");

    // OP 템플릿 매칭
    if (opTheme && curSegData.op?.segments?.length > 0) {
      const pcm = await decodeAudioSegments(
        curSegData.op.segments.map((s: any) => s.url),
        undefined,
        curSegData.op.segments.map((s: any) => s.proxyUrl)
      );
      if (pcm) {
        const curChroma = extractCENS(pcm);
        const curFrames = Math.floor(curChroma.length / 12);
        const tChroma = base64ToChroma(opTheme.chroma_data);
        const tFrames = Math.floor(tChroma.length / 12);

        const match = matchTemplate(curChroma, curFrames, tChroma, tFrames);
        if (match) {
          detectedIntervals.push({
            type: "op",
            label: "오프닝",
            start: match.start,
            end: match.end,
            score: match.score,
          });
        }
      }
    }

    // ED 템플릿 매칭
    if (edTheme && curSegData.ed?.segments?.length > 0) {
      const pcm = await decodeAudioSegments(
        curSegData.ed.segments.map((s: any) => s.url),
        undefined,
        curSegData.ed.segments.map((s: any) => s.proxyUrl)
      );
      if (pcm) {
        const curChroma = extractCENS(pcm);
        const curFrames = Math.floor(curChroma.length / 12);
        const tChroma = base64ToChroma(edTheme.chroma_data);
        const tFrames = Math.floor(tChroma.length / 12);

        const match = matchTemplate(curChroma, curFrames, tChroma, tFrames);
        if (match) {
          const edOffset = curSegData.ed.startSec || 0;
          detectedIntervals.push({
            type: "ed",
            label: "엔딩",
            start: Math.round((edOffset + match.start) * 10) / 10,
            end: Math.round((edOffset + match.end) * 10) / 10,
            score: match.score,
          });
        }
      }
    }

    if (detectedIntervals.length > 0) {
      // 매칭 결과 DB 저장
      const op = detectedIntervals.find((i) => i.type === "op");
      const ed = detectedIntervals.find((i) => i.type === "ed");
      fetch("/api/anime/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          animeId,
          episodeNumber,
          opStart: op?.start ?? null,
          opEnd: op?.end ?? null,
          edStart: ed?.start ?? null,
          edEnd: ed?.end ?? null,
          source: "chroma_match",
        }),
      }).catch(() => {});

      if (onProgress) onProgress({ step: "크로마 지문 매칭 성공!", progress: 100 });
      return detectedIntervals;
    }
  }

  // [3단계]: AniSkip 조회 (위 Step 1에서 없었거나 미탐지된 경우)
  // [4단계]: 브라우저 Web Audio 교차 분석
  // 비교 회차 결정: compareEpisodeNumber 지정되었으면 그것, 없으면 다음 화(ep+1) 또는 이전 화(ep-1)
  const compEp = compareEpisodeNumber || (episodeNumber > 1 ? episodeNumber - 1 : 2);

  if (onProgress) {
    onProgress({
      step: `4단계: ${episodeNumber}화와 ${compEp}화 오디오 교차 분석 시작`,
      progress: 35,
    });
  }

  // 비교 대상 회차 세그먼트 정보 조회
  const compSegRes = await fetch(
    `/api/anime/stream/segments_info?anime_id=${encodeURIComponent(animeId)}&ep=${compEp}`
  );
  if (!compSegRes.ok) {
    throw new Error(`Failed to load comparison episode ${compEp} segments`);
  }
  const compSegData = await compSegRes.json();
  if (!compSegData.success) {
    throw new Error(compSegData.message || `No segments for ep ${compEp}`);
  }

  // =========================================================================
  // ★ 중요: 1) 오프닝(OP) 완료 후 -> 2) 엔딩(ED) 순차 작업 (앞 4분, 뒤 2.5분)
  // =========================================================================

  // --- 1) 오프닝 (OP) 분석 (앞 4분: 0 ~ 240초) ---
  if (onProgress) {
    onProgress({
      step: "1/2단계: 오프닝(앞 4분) 오디오 디코딩 및 분석 중...",
      progress: 45,
    });
  }

  let opMatchResult: any = null;
  if (curSegData.op?.segments?.length > 0 && compSegData.op?.segments?.length > 0) {
    const [pcm1, pcm2] = await Promise.all([
      decodeAudioSegments(
        curSegData.op.segments.map((s: any) => s.url),
        undefined,
        curSegData.op.segments.map((s: any) => s.proxyUrl)
      ),
      decodeAudioSegments(
        compSegData.op.segments.map((s: any) => s.url),
        undefined,
        compSegData.op.segments.map((s: any) => s.proxyUrl)
      ),
    ]);

    if (pcm1 && pcm2) {
      const c1 = extractCENS(pcm1);
      const c2 = extractCENS(pcm2);
      const t1 = Math.floor(c1.length / 12);
      const t2 = Math.floor(c2.length / 12);

      opMatchResult = matrixMatch(c1, t1, c2, t2, OP_SEARCH_SEC, SIMILARITY_THRESHOLD);
      if (opMatchResult) {
        detectedIntervals.push({
          type: "op",
          label: "오프닝",
          start: opMatchResult.t1,
          end: opMatchResult.t1End,
          score: opMatchResult.score,
        });

        // 검출된 오프닝 90초 크로마 지문 DB 저장
        const fpBase64 = chromaToBase64(opMatchResult.fingerprintSlice);
        fetch("/api/anime/themes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            animeId,
            themeType: "op",
            version: 1,
            duration: opMatchResult.durSec,
            chromaData: fpBase64,
          }),
        }).catch(() => {});
      }
    }
  }

  // --- 2) 오프닝 완료 후 즉시 엔딩 (ED) 분석 (뒤 2.5분: 150초) ---
  if (onProgress) {
    onProgress({
      step: "2/2단계: 오프닝 완료! 엔딩(뒤 2.5분) 오디오 분석 중...",
      progress: 75,
    });
  }

  let edMatchResult: any = null;
  if (curSegData.ed?.segments?.length > 0 && compSegData.ed?.segments?.length > 0) {
    const [pcm1, pcm2] = await Promise.all([
      decodeAudioSegments(
        curSegData.ed.segments.map((s: any) => s.url),
        undefined,
        curSegData.ed.segments.map((s: any) => s.proxyUrl)
      ),
      decodeAudioSegments(
        compSegData.ed.segments.map((s: any) => s.url),
        undefined,
        compSegData.ed.segments.map((s: any) => s.proxyUrl)
      ),
    ]);

    if (pcm1 && pcm2) {
      const c1 = extractCENS(pcm1);
      const c2 = extractCENS(pcm2);
      const t1 = Math.floor(c1.length / 12);
      const t2 = Math.floor(c2.length / 12);

      edMatchResult = matrixMatch(c1, t1, c2, t2, ED_SEARCH_SEC, SIMILARITY_THRESHOLD);
      if (edMatchResult) {
        const curEdOffset = curSegData.ed.startSec || 0;
        const realEdStart = Math.round((curEdOffset + edMatchResult.t1) * 10) / 10;
        const realEdEnd = Math.round((curEdOffset + edMatchResult.t1End) * 10) / 10;

        detectedIntervals.push({
          type: "ed",
          label: "엔딩",
          start: realEdStart,
          end: realEdEnd,
          score: edMatchResult.score,
        });

        // 검출된 엔딩 90초 크로마 지문 DB 저장
        const fpBase64 = chromaToBase64(edMatchResult.fingerprintSlice);
        fetch("/api/anime/themes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            animeId,
            themeType: "ed",
            version: 1,
            duration: edMatchResult.durSec,
            chromaData: fpBase64,
          }),
        }).catch(() => {});
      }
    }
  }

  // 스킵 타임스탬프 DB 저장
  if (detectedIntervals.length > 0) {
    const op = detectedIntervals.find((i) => i.type === "op");
    const ed = detectedIntervals.find((i) => i.type === "ed");
    fetch("/api/anime/skip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        animeId,
        episodeNumber,
        opStart: op?.start ?? null,
        opEnd: op?.end ?? null,
        edStart: ed?.start ?? null,
        edEnd: ed?.end ?? null,
        source: "audio_ai",
      }),
    }).catch(() => {});
  }

  if (onProgress) {
    onProgress({
      step: detectedIntervals.length > 0 ? "오디오 AI 분석 완료!" : "오디오 일치 구간 없음",
      progress: 100,
    });
  }

  return detectedIntervals;
}

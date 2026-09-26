import net from "net";
import dns from "dns";

/**
 * 서버리스 프록시 라우트용 URL 검증 가드.
 * 외부에서 ?url= 파라미터로 아무 URL이나 전달받아 서버 측에서 fetch 하는 구조이므로,
 * 내부/클라우드 메타데이터 등 비공개 주소로 요청이 향하는 것(SSRF)을 차단합니다.
 */
export class UnsafeProxyUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeProxyUrlError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
]);

function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
    if (a === 127) return true; // 127.0.0.0/8 루프백
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 링크로컬 (클라우드 메타데이터)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    return false;
  }

  if (net.isIPv6(ip)) {
    const v6 = ip.toLowerCase();
    if (v6 === "::" || v6 === "::1") return true; // unspecified / 루프백
    if (v6.startsWith("fc") || v6.startsWith("fd")) return true; // ULA fc00::/7
    if (v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb")) {
      return true; // 링크로컬 fe80::/10
    }
    // IPv4-mapped IPv6: ::ffff:a.b.c.d (점분리) 또는 ::ffff:XXYY:ZZWW (16진수, URL이 정규화한 형태)
    const dotted = v6.match(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (dotted) {
      return isBlockedIp(
        `${dotted[1]}.${dotted[2]}.${dotted[3]}.${dotted[4]}`
      );
    }
    const hex = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isBlockedIp(
        `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
      );
    }
    return false;
  }

  return true; // IP가 아닌 이상한 리터럴은 기본 차단
}

/**
 * net.isIP()를 우회하는 비표준 IPv4 표기를 점분리 형식으로 정규화합니다.
 * - 순수 10진수 32비트: 2130706433 → 127.0.0.1
 * - 8진수/16진수 각 부: 0177.0.0.1, 0x7f.0.0.1
 * - 축약형: 127.1 → 127.0.0.1
 * 이러한 표기법들은 net.isIP()가 0을 반환해 기존 가드를 통과하지만,
 * OS 레이어(getaddrinfo)는 그대로 IP로 해석하므로 정규화 후 차단 여부를 판정해야 합니다.
 * 도메인(숫자가 아닌 호스트)이면 null을 반환합니다.
 */
function normalizeIpLiteral(host: string): string | null {
  if (net.isIP(host) !== 0) return host; // 이미 정규 IPv4/IPv6 리터럴

  // 순수 10진수 32비트 표기
  if (/^\d{1,10}$/.test(host)) {
    const n = Number(host);
    if (!Number.isSafeInteger(n) || n > 0xffffffff) return null;
    return [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join(".");
  }

  // 점분리 표기: 각 부가 10진수 / 0x 16진수 / 0-접두 8진수 (inet_aton 호환)
  const parts = host.split(".");
  if (parts.length < 2 || parts.length > 4) return null;
  const partRe = /^(0[xX][0-9a-fA-F]{1,8}|[0-7]{1,3}|\d{1,3})$/;
  if (!parts.every((p) => partRe.test(p))) return null;

  const nums = parts.map((p) =>
    /^0[xX]/.test(p) ? parseInt(p, 16) : /^0[0-7]+$/.test(p) ? parseInt(p, 8) : parseInt(p, 10)
  );
  if (nums.some((n) => Number.isNaN(n) || n > 0xffffffff)) return null;

  const octets = [0, 0, 0, 0];
  for (let i = 0; i < nums.length; i++) {
    if (i < nums.length - 1) {
      if (nums[i] > 0xff) return null;
      octets[i] = nums[i];
    } else {
      // 마지막 부분은 남은 바이트를 채운다 (예: 127.1 → 마지막 '1'이 마지막 3바이트를 채움)
      const width = 4 - nums.length + 1;
      for (let b = 0; b < width; b++) {
        octets[nums.length - 1 + b] = (nums[i] >>> (8 * (width - 1 - b))) & 0xff;
      }
    }
  }
  return octets.join(".");
}

// DNS 해석 결과 캐시 (호스트명 → IP 목록).
// 캐시 유효기간 동안 해석 결과가 고정되어 DNS rebinding(TTL 조작) 공격 창이 축소됩니다.
const DNS_CACHE_TTL_MS = 60_000;
const dnsCache = new Map<string, { ips: string[]; ts: number }>();

function lookupAll(host: string, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("DNS lookup timeout")), timeoutMs);
    Promise.allSettled([
      dns.promises.lookup(host, { all: true, family: 4 }),
      dns.promises.lookup(host, { all: true, family: 6 }),
    ]).then(
      (results) => {
        clearTimeout(timer);
        const ips: string[] = [];
        for (const r of results) {
          if (r.status === "fulfilled") {
            ips.push(...(r.value as dns.LookupAddress[]).map((a) => a.address));
          }
        }
        resolve(ips);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function resolveHost(host: string): Promise<string[]> {
  const cached = dnsCache.get(host);
  if (cached && Date.now() - cached.ts < DNS_CACHE_TTL_MS) return cached.ips;
  try {
    const ips = await lookupAll(host, 2000);
    dnsCache.set(host, { ips, ts: Date.now() });
    if (dnsCache.size > 1000) {
      const oldest = dnsCache.keys().next().value;
      if (oldest !== undefined) dnsCache.delete(oldest);
    }
    return ips;
  } catch {
    // 해석 실패(NXDOMAIN, 타임아웃 등)는 실제 fetch 단계에서 자연스럽게 실패하게 둠
    return [];
  }
}

export async function assertSafeProxyUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new UnsafeProxyUrlError("Invalid proxy URL");
  }

  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new UnsafeProxyUrlError("Only http(s) URLs are allowed");
  }

  // IPv6 리터럴은 "[::1]" 형태로 괄호가 붙어 있으므로 제거
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) {
    throw new UnsafeProxyUrlError("Missing hostname");
  }
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new UnsafeProxyUrlError("Blocked hostname");
  }

  // IP 리터럴: 비표준 표기(10진수/8진수/16진수/축약형)를 정규화 후 차단 판정
  const ip = normalizeIpLiteral(host);
  if (ip) {
    if (isBlockedIp(ip)) {
      throw new UnsafeProxyUrlError("Blocked IP address");
    }
    return u;
  }

  // 도메인: 해석된 IP 중 하나라도 비공개/내부 주소면 차단
  // (내부 IP를 가리키는 도메인, DNS rebinding 등 우회 시도 차단)
  const ips = await resolveHost(host);
  if (ips.some((resolved) => isBlockedIp(resolved))) {
    throw new UnsafeProxyUrlError("Blocked IP address");
  }

  return u;
}

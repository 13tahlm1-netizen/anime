import crypto from "crypto";
import { cookies } from "next/headers";

// 보안: AUTH_SECRET 미설정 시 DATABASE_URL / POSTGRES_URL을 기반으로 고유한 시크릿 키를 자동 파생합니다.
// 둘 다 없으면 토큰 발급/검증이 fail-closed 처리됩니다.
function resolveSecretKey(): string | undefined {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.SECRET_KEY) return process.env.SECRET_KEY;
  const dbUrl =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL;
  if (dbUrl) {
    return crypto
      .createHash("sha256")
      .update(`anime_auth_secret_seed:${dbUrl}`)
      .digest("hex");
  }
  return undefined;
}

const SECRET_KEY = resolveSecretKey();

export const AUTH_COOKIE_NAME = "anime_auth_token";

export interface AuthUser {
  id: number;
  username: string;
  nickname: string;
  isAdmin: boolean;
  isFirstLogin?: boolean;
}

/**
 * 비밀번호를 Salt + scrypt를 이용해 안전하게 해싱합니다.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * 평문 비밀번호와 저장된 해시(salt:hash)를 비교 검증합니다.
 */
export function verifyPassword(password: string, combinedHash: string): boolean {
  if (!password || !combinedHash || !combinedHash.includes(":")) return false;
  try {
    const [salt, originalHash] = combinedHash.split(":");
    const testHash = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(
      Buffer.from(originalHash, "hex"),
      Buffer.from(testHash, "hex")
    );
  } catch (error) {
    console.error("[verifyPassword error]:", error);
    return false;
  }
}

/**
 * 사용자의 세션 토큰을 HMAC-SHA256 기반으로 서명하여 생성합니다.
 */
export function createAuthToken(user: AuthUser, expiresInDays = 30): string {
  if (!SECRET_KEY) {
    throw new Error(
      "AUTH_SECRET or DATABASE_URL environment variable is not set. Please set DATABASE_URL or AUTH_SECRET in Vercel project settings or .env.local."
    );
  }
  const exp = Math.floor(Date.now() / 1000) + expiresInDays * 86400;
  const payload = JSON.stringify({
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    isAdmin: user.isAdmin,
    isFirstLogin: Boolean(user.isFirstLogin),
    exp,
  });
  const payloadBase64 = Buffer.from(payload).toString("base64url");
  const signature = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(payloadBase64)
    .digest("base64url");
  return `${payloadBase64}.${signature}`;
}

/**
 * 서명된 토큰을 검증하고 유저 정보를 반환합니다. 만료되었거나 위조된 경우 null을 반환합니다.
 */
export function verifyAuthToken(token: string): AuthUser | null {
  if (!token || !token.includes(".")) return null;
  if (!SECRET_KEY) return null; // fail-closed: 시크릿 미설정 시 어떤 토큰도 유효하지 않음
  try {
    const [payloadBase64, signature] = token.split(".");
    const expectedSig = crypto
      .createHmac("sha256", SECRET_KEY)
      .update(payloadBase64)
      .digest("base64url");

    // 보안: 하드코딩 legacy 키 검증 로직 제거 (기존 토큰은 전부 무효)
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const json = Buffer.from(payloadBase64, "base64url").toString("utf-8");
    const data = JSON.parse(json);

    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) {
      return null; // 만료된 토큰
    }

    return {
      id: data.id,
      username: data.username,
      nickname: data.nickname,
      isAdmin: Boolean(data.isAdmin),
      isFirstLogin: Boolean(data.isFirstLogin),
    };
  } catch {
    return null;
  }
}

/**
 * 서버 컴포넌트 또는 서버 액션/라우트 핸들러에서 현재 로그인된 유저 세션을 가져옵니다.
 */
export async function getSessionUser(): Promise<AuthUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    if (!token) return null;
    return verifyAuthToken(token);
  } catch {
    return null;
  }
}

import { getUserCount } from "./db";
import { redirect } from "next/navigation";

/**
 * 로그인된 유저의 username을 반환하며, 비로그인 시 "default"를 반환합니다.
 */
export async function getCurrentUserId(): Promise<string> {
  const user = await getSessionUser();
  return user?.username || "default";
}

/**
 * 사이트 내 모든 보호 페이지 접근 시 인증을 강제합니다.
 * 1. 계정이 전혀 없을 때: 무조건 /setup 으로 강제 리디렉션
 * 2. 미로그인 상태일 때: 무조건 /login 으로 강제 리디렉션
 * 3. 정상 로그인 상태: 인증된 AuthUser 반환
 */
export async function requireAuth(): Promise<AuthUser> {
  const user = await getSessionUser();
  if (user) {
    if (user.isFirstLogin) {
      redirect("/profile?change_password=1");
    }
    return user;
  }

  const count = await getUserCount();
  if (count === 0) {
    redirect("/setup");
  }

  redirect("/login");
}

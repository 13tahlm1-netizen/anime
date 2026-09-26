import { AnimeProvider } from "./types";
import { linkkfProvider } from "./linkkf";
import { ohli24Provider } from "./ohli24";
import { reanimeProvider } from "./reanime";
import { anissiaProvider } from "./anissia";

export * from "./types";
export * from "./linkkf";
export { ohli24Provider } from "./ohli24";
export { reanimeProvider, REANIME_GENRES } from "./reanime";
export { anissiaProvider, ANISSIA_PRIMARY_GENRES, ANISSIA_ALL_GENRES } from "./anissia";

// Anissia 접두사 상수
export const ANISSIA_PREFIX = "ani_";

export function isAnissiaId(id: string): boolean {
  return typeof id === "string" && id.startsWith(ANISSIA_PREFIX);
}

export function toAnissiaId(rawId: string | number): string {
  const str = String(rawId);
  return str.startsWith(ANISSIA_PREFIX) ? str : `${ANISSIA_PREFIX}${str}`;
}

export function stripAnissiaId(id: string): string {
  return id.replace(new RegExp(`^${ANISSIA_PREFIX}`), "");
}

// Ohli24 접두사 상수
export const OHLI24_PREFIX = "ol_";

export function isOhli24Id(id: string): boolean {
  return typeof id === "string" && id.startsWith(OHLI24_PREFIX);
}

export function toOhli24Id(rawId: string | number): string {
  const str = String(rawId);
  return str.startsWith(OHLI24_PREFIX) ? str : `${OHLI24_PREFIX}${str}`;
}

export function stripOhli24Id(id: string): string {
  return id.replace(new RegExp(`^${OHLI24_PREFIX}`), "");
}

// ReAnime 접두사 상수
export const REANIME_PREFIX = "re_";

export function isReanimeId(id: string): boolean {
  return typeof id === "string" && id.startsWith(REANIME_PREFIX);
}

export function toReanimeId(rawId: string | number): string {
  const str = String(rawId);
  return str.startsWith(REANIME_PREFIX) ? str : `${REANIME_PREFIX}${str}`;
}

export function stripReanimeId(id: string): string {
  return id.replace(new RegExp(`^${REANIME_PREFIX}`), "");
}

export function getProvider(sourceName?: string | null): AnimeProvider {
  if (sourceName === "linkkf") {
    return linkkfProvider;
  }
  if (sourceName === "ohli24") {
    return ohli24Provider;
  }
  if (sourceName === "reanime") {
    return reanimeProvider;
  }
  return anissiaProvider;
}

export function getProviderByAnimeId(animeId: string): AnimeProvider {
  if (isAnissiaId(animeId)) {
    return anissiaProvider;
  }
  if (isReanimeId(animeId)) {
    return reanimeProvider;
  }
  if (isOhli24Id(animeId)) {
    return ohli24Provider;
  }
  return linkkfProvider;
}

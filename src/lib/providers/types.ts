export interface AnimeListItem {
  id: string;
  title: string;
  poster: string;
  detail_url: string;
  remarks: string;
  rank?: number | null;
  // 부가 메타데이터 필드 (애니시아 허브 및 통합 뷰 지원)
  rating?: number | null;
  time?: string | null;
  caption_count?: number | null;
  genres?: string[];
  latest_ep?: string | null;
  creator_name?: string | null;
  caption_url?: string | null;
  status?: string | null;
}

export interface AnimeListResponse {
  items: AnimeListItem[];
  page: number;
  has_next: boolean;
  total_pages: number;
}

export interface EpisodeItem {
  number: number;
  title: string;
  watch_url: string;
  caption_url?: string;
  creator_name?: string;
}

export interface AnimeDetail {
  id: string;
  title: string;
  poster: string;
  description: string;
  genres: string[];
  sub_episodes: EpisodeItem[];
  dub_episodes: EpisodeItem[];
  total_episodes: number;
  status_text: string;
  year: string;
  is_finished: boolean;
  banner?: string;
  rating?: number | null;
  caption_count?: number;
  original_title?: string;
}

export interface ServerSource {
  label: string;
  player_url: string;
}

export interface EpisodeStreamInfo {
  success: boolean;
  m3u8_url: string;
  vtt_url: string;
  player_url: string;
  embed_url?: string;
  stream_type?: "m3u8" | "iframe";
  server_sources: ServerSource[];
  link_next: string;
  link_pre: string;
  vod_data?: Record<string, unknown>;
  max_available_ep?: number;
  unsupported_reason?: string;
}

export interface AnimeListFilterParams {
  section?: string;
  genre?: string;
  year?: string;
  typeLang?: string;
  page?: number;
  period?: "day" | "week" | "month" | "all";
  category?: "recent_caption" | "airing" | "top" | "movie" | "finished" | "trending" | "upcoming";
  sort?: string;
  day?: number | string;
}

export interface AnimeProvider {
  readonly name: "linkkf" | "ohli24" | "reanime" | "anissia";
  readonly displayName: string;
  getBaseUrl(): Promise<string>;
  getAnimeListFiltered(params: AnimeListFilterParams): Promise<AnimeListResponse>;
  getAnimeList(params: {
    category?: "recent_caption" | "airing" | "top" | "movie" | "finished" | "trending" | "upcoming";
    page?: number;
    genre?: string;
    period?: "day" | "week" | "month" | "all";
    sort?: string;
    day?: number | string;
  }): Promise<AnimeListResponse>;
  searchAnime(keyword: string, page?: number): Promise<AnimeListResponse>;
  getAnimeDetail(animeId: string): Promise<AnimeDetail | null>;
  getEpisodeStream(watchUrl: string): Promise<EpisodeStreamInfo | null>;
}

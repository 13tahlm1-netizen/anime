import Navbar from "@/components/Navbar";
import FavoriteButton from "@/components/FavoriteButton";
import EpisodeListSection from "@/components/EpisodeListSection";
import ReanimeDetailFallback from "@/components/ReanimeDetailFallback";
import { getProviderByAnimeId } from "@/lib/providers";
import { requireAuth, getCurrentUserId } from "@/lib/auth";
import { getAnimeHistoryMap } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Play, Film, Calendar, CheckCircle2 } from "lucide-react";

export default async function AnimeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ dub?: string }>;
}) {
  await requireAuth();
  const currentUserId = await getCurrentUserId();

  const { id } = await params;
  const { dub } = await searchParams;
  const isDub = dub === "1";

  const provider = getProviderByAnimeId(id);
  const anime = await provider.getAnimeDetail(id);
  if (!anime) {
    if (id.startsWith("re_")) {
      return (
        <div className="min-h-screen bg-[#0b0f19]">
          <Navbar />
          <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <ReanimeDetailFallback id={id} initialIsDub={isDub} />
          </main>
        </div>
      );
    }
    notFound();
  }

  const initialHistoryMap = await getAnimeHistoryMap(currentUserId, anime.id);
  const episodes = isDub ? anime.dub_episodes : anime.sub_episodes;

  return (
    <div className="min-h-screen bg-[#0b0f19]">
      <Navbar />

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Banner Card */}
        <div className="overflow-hidden rounded-3xl border border-purple-500/20 bg-slate-900/60 p-6 backdrop-blur-md sm:p-8">
          <div className="flex flex-col gap-8 md:flex-row">
            {/* Poster */}
            <div className="mx-auto w-48 flex-shrink-0 sm:w-60 md:mx-0">
              <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-purple-500/30 shadow-2xl shadow-purple-900/30 bg-slate-950">
                {anime.poster && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={anime.poster}
                    alt={anime.title}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
            </div>

            {/* Info */}
            <div className="flex flex-1 flex-col justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {anime.is_finished ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-300 border border-emerald-500/30">
                      <CheckCircle2 className="h-3 w-3" /> 완결
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/20 px-3 py-1 text-xs font-semibold text-purple-300 border border-purple-500/30">
                      방영중
                    </span>
                  )}
                  {anime.year && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                      <Calendar className="h-3 w-3" /> {anime.year}
                    </span>
                  )}
                </div>

                <h1 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-3xl lg:text-4xl">
                  {anime.title}
                </h1>

                {anime.genres.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {anime.genres.map((g) => (
                      <span
                        key={g}
                        className="rounded-lg bg-slate-800/80 px-2.5 py-1 text-xs font-medium text-slate-300"
                      >
                        {g}
                      </span>
                    ))}
                  </div>
                )}

                {anime.description && (
                  <p className="mt-5 text-sm leading-relaxed text-slate-300 whitespace-pre-line line-clamp-4">
                    {anime.description}
                  </p>
                )}
              </div>

              {/* Action */}
              <div className="mt-6 flex flex-wrap items-center gap-3">
                {episodes.length > 0 && (
                  <Link
                    href={`/watch/${anime.id}/1${isDub ? "?dub=1" : ""}`}
                    className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 px-6 py-3 font-bold text-white shadow-xl shadow-purple-600/30 transition hover:scale-105 active:scale-95 text-sm"
                  >
                    <Play className="h-4 w-4 fill-white" />
                    1화 바로 시청
                  </Link>
                )}
                <FavoriteButton
                  animeId={anime.id}
                  animeTitle={anime.title}
                  animePoster={anime.poster}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Episodes Section (50-chunk ranges, sorting, jump search, watched badges) */}
        <EpisodeListSection
          animeId={anime.id}
          subEpisodes={anime.sub_episodes}
          dubEpisodes={anime.dub_episodes}
          initialIsDub={isDub}
          initialHistoryMap={initialHistoryMap}
        />
      </main>
    </div>
  );
}

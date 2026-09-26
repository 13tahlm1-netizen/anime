"use client";

import { useEffect, useState } from "react";
import { Star } from "lucide-react";

export default function FavoriteButton({
  animeId,
  animeTitle,
  animePoster,
}: {
  animeId: string;
  animeTitle: string;
  animePoster?: string;
}) {
  const [isFavorited, setIsFavorited] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/anime/favorite?id=${animeId}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setIsFavorited(d.is_favorited);
      })
      .catch(() => {});
  }, [animeId]);

  const toggleFavorite = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/anime/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ animeId, animeTitle, animePoster: animePoster || "" }),
      });
      const data = await res.json();
      if (data.success) {
        setIsFavorited(data.is_favorited);
      }
    } catch {}
    setLoading(false);
  };

  return (
    <button
      type="button"
      onClick={toggleFavorite}
      disabled={loading}
      className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition border cursor-pointer active:scale-95 ${
        isFavorited
          ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/50 shadow-lg shadow-yellow-500/10"
          : "bg-slate-800/80 text-slate-300 border-slate-700 hover:border-purple-500"
      }`}
    >
      <Star className={`h-4 w-4 ${isFavorited ? "fill-yellow-400 text-yellow-400" : ""}`} />
      <span>{isFavorited ? "즐겨찾기 중" : "즐겨찾기 추가"}</span>
    </button>
  );
}

"use client";

import { useEffect, useState } from "react";
import type { Clip, AudioIdentification } from "@/lib/db";

type Filter = "all" | "birds" | "non-birds";

type FeedItem =
  | { type: "video"; timestamp: string; clip: Clip }
  | { type: "audio"; timestamp: string; audio: AudioIdentification };

export function ClipGrid({
  clips,
  clipTimes,
  audioIdentifications,
  audioTimes,
}: {
  clips: Clip[];
  clipTimes: Record<string, string>;
  audioIdentifications: AudioIdentification[];
  audioTimes: Record<string, string>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [showVideo, setShowVideo] = useState(true);
  const [showAudio, setShowAudio] = useState(true);
  const [selectedImage, setSelectedImage] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    if (!selectedImage) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedImage(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedImage]);

  const filteredClips = clips.filter((clip) => {
    if (filter === "all") return true;
    if (filter === "birds") return clip.identifications.some((id) => id.isBird);
    return clip.identifications.some((id) => !id.isBird);
  });

  const items: FeedItem[] = [
    ...(showVideo
      ? filteredClips.map((clip): FeedItem => ({ type: "video", timestamp: clip.createdAt, clip }))
      : []),
    ...(showAudio
      ? audioIdentifications.map((audio): FeedItem => ({ type: "audio", timestamp: audio.detectedAt, audio }))
      : []),
  ].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={showVideo}
            onClick={() => setShowVideo((v) => !v)}
            className={`px-3 py-1 rounded-full text-sm border ${
              showVideo
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-transparent border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400"
            }`}
          >
            Video
          </button>
          <button
            type="button"
            aria-pressed={showAudio}
            onClick={() => setShowAudio((v) => !v)}
            className={`px-3 py-1 rounded-full text-sm border ${
              showAudio
                ? "bg-blue-600 border-blue-600 text-white"
                : "bg-transparent border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400"
            }`}
          >
            Audio
          </button>
        </div>
        {showVideo && (
          <div className="flex gap-4">
            {(["all", "birds", "non-birds"] as const).map((value) => (
              <label key={value} className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
                <input
                  type="radio"
                  name="clip-filter"
                  value={value}
                  checked={filter === value}
                  onChange={() => setFilter(value)}
                  className="accent-blue-600"
                />
                {value === "all" ? "All" : value === "birds" ? "Birds only" : "Non-birds only"}
              </label>
            ))}
          </div>
        )}
      </div>
      <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
        {items.length} {items.length === 1 ? "item" : "items"}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {items.map((item) =>
          item.type === "video" ? (
            <div
              key={`video-${item.clip.id}`}
              className="rounded-lg overflow-hidden bg-white dark:bg-zinc-900 shadow-sm"
            >
              <p className="px-2 pt-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
                {clipTimes[item.clip.id]}
              </p>
              <img
                src={`/${item.clip.thumbnailPath}`}
                alt={item.clip.identifications[0]?.species ?? "Unidentified clip"}
                className="w-full aspect-video object-cover cursor-pointer"
                onClick={() =>
                  setSelectedImage({
                    src: `/${item.clip.thumbnailPath}`,
                    alt: item.clip.identifications[0]?.species ?? "Unidentified clip",
                  })
                }
              />
              <div className="p-2">
                {item.clip.identifications.length === 0 && (
                  <p className="text-sm text-zinc-400">No identification</p>
                )}
                <div className="space-y-2">
                  {item.clip.identifications.map((ident, i) =>
                    ident.isBird ? (
                      <div key={i} className="text-sm text-zinc-700 dark:text-zinc-300">
                        <p>
                          {ident.species}
                          {ident.gender && ident.gender !== "unknown" ? ` (${ident.gender})` : ""}
                          {ident.count && ident.count > 1 ? ` ×${ident.count}` : ""}
                        </p>
                        {ident.confidence != null && (
                          <p className="text-xs text-zinc-400">
                            {Math.round(parseFloat(ident.confidence) * 100)}% confidence
                          </p>
                        )}
                      </div>
                    ) : (
                      <div key={i} className="text-sm text-red-500">
                        <p>{ident.nonBirdSpecies ?? "Not a bird"}</p>
                        {ident.confidence != null && (
                          <p className="text-xs text-zinc-400">
                            {Math.round(parseFloat(ident.confidence) * 100)}% confidence
                          </p>
                        )}
                      </div>
                    )
                  )}
                </div>
                {item.clip.identifications[0]?.model && (
                  <p className="mt-2 text-xs text-zinc-400">AI model: {item.clip.identifications[0].model}</p>
                )}
              </div>
            </div>
          ) : (
            <div
              key={`audio-${item.audio.id}`}
              className="rounded-lg overflow-hidden bg-white dark:bg-zinc-900 shadow-sm"
            >
              <div className="flex items-center justify-between px-2 pt-2">
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  {audioTimes[String(item.audio.id)]}
                </p>
                <span className="text-xs text-zinc-400" aria-label="Audio detection" title="Audio detection">
                  🔊
                </span>
              </div>
              {item.audio.speciesImagePath ? (
                <img
                  src={`/${item.audio.speciesImagePath}`}
                  alt={item.audio.species ?? "Unidentified species"}
                  className="w-full aspect-video object-cover cursor-pointer"
                  onClick={() =>
                    setSelectedImage({
                      src: `/${item.audio.speciesImagePath}`,
                      alt: item.audio.species ?? "Unidentified species",
                    })
                  }
                />
              ) : (
                <div className="w-full aspect-video bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-4xl">
                  🐦
                </div>
              )}
              <div className="p-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{item.audio.species ?? "Unidentified species"}</p>
                {item.audio.confidence != null && (
                  <p className="text-xs text-zinc-400">{Math.round(item.audio.confidence * 100)}% confidence</p>
                )}
                {item.audio.audioPath && (
                  <audio controls className="w-full mt-2 h-8" src={`/${item.audio.audioPath}`} />
                )}
              </div>
            </div>
          )
        )}
      </div>
      {selectedImage && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setSelectedImage(null)}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 text-white text-3xl leading-none"
          >
            &times;
          </button>
          <img
            src={selectedImage.src}
            alt={selectedImage.alt}
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

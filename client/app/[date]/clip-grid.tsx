"use client";

import { useEffect, useState } from "react";
import type { Clip } from "@/lib/db";

type Filter = "all" | "birds" | "non-birds";

export function ClipGrid({
  clips,
  clipTimes,
}: {
  clips: Clip[];
  clipTimes: Record<string, string>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);

  useEffect(() => {
    if (!selectedClip) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedClip(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedClip]);

  const filtered = clips.filter((clip) => {
    if (filter === "all") return true;
    if (filter === "birds")
      return clip.identifications.some((id) => id.isBird);
    return clip.identifications.some((id) => !id.isBird);
  });

  return (
    <>
      <div className="flex gap-4 mb-4">
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
      <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
        {filtered.length} {filtered.length === 1 ? "clip" : "clips"}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {filtered.map((clip) => (
          <div
            key={clip.id}
            className="rounded-lg overflow-hidden bg-white dark:bg-zinc-900 shadow-sm"
          >
            <p className="px-2 pt-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">
              {clipTimes[clip.id]}
            </p>
            <img
              src={`/${clip.thumbnailPath}`}
              alt={
                clip.identifications[0]?.species ?? "Unidentified clip"
              }
              className="w-full aspect-video object-cover cursor-pointer"
              onClick={() => setSelectedClip(clip)}
            />
            <div className="p-2">
              {clip.identifications.length === 0 && (
                <p className="text-sm text-zinc-400">No identification</p>
              )}
              <div className="space-y-2">
                {clip.identifications.map((ident, i) =>
                  ident.isBird ? (
                    <div
                      key={i}
                      className="text-sm text-zinc-700 dark:text-zinc-300"
                    >
                      <p>
                        {ident.species}
                        {ident.gender && ident.gender !== "unknown"
                          ? ` (${ident.gender})`
                          : ""}
                        {ident.count && ident.count > 1
                          ? ` ×${ident.count}`
                          : ""}
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
              {clip.identifications[0]?.model && (
                <p className="mt-2 text-xs text-zinc-400">
                  AI model: {clip.identifications[0].model}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
      {selectedClip && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setSelectedClip(null)}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => setSelectedClip(null)}
            className="absolute top-4 right-4 text-white text-3xl leading-none"
          >
            &times;
          </button>
          <img
            src={`/${selectedClip.thumbnailPath}`}
            alt={
              selectedClip.identifications[0]?.species ?? "Unidentified clip"
            }
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import type { Clip, AudioIdentification } from "@/lib/db";
import { isKnownSpecies, toTitleCase } from "@/lib/species";
import { Lightbox, type LightboxImage } from "@/components/lightbox";

type FeedItem =
  | { type: "video"; timestamp: string; clip: Clip }
  | { type: "audio"; timestamp: string; audio: AudioIdentification };

type SortOrder = "time" | "species";

/** A clip is worth showing by default only if the AI named at least one bird species. */
function hasKnownBird(clip: Clip): boolean {
  return clip.identifications.some((ident) => ident.isBird && isKnownSpecies(ident.species));
}

/** Thumbnail alt text: the first identification's species, title-cased like the rest of the card. */
function clipAlt(clip: Clip): string {
  const species = clip.identifications[0]?.species;
  return species ? toTitleCase(species) : "Unidentified clip";
}

/** Audio species, title-cased (BirdNET-Go names usually already are). */
function audioSpeciesLabel(audio: AudioIdentification): string {
  return audio.species ? toTitleCase(audio.species) : "Unidentified species";
}

/**
 * The species a feed item sorts under: the first known bird identification for a video clip, or the
 * audio detection's species. Lowercased because the AI stores lowercase names and BirdNET-Go doesn't.
 * Null when there's no known bird species (those items sort last).
 */
function sortSpecies(item: FeedItem): string | null {
  const species =
    item.type === "video"
      ? item.clip.identifications.find((ident) => ident.isBird && isKnownSpecies(ident.species))?.species ?? null
      : item.audio.species;
  return isKnownSpecies(species) ? species.trim().toLowerCase() : null;
}

const newestFirst = (a: FeedItem, b: FeedItem) =>
  new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();

/** Alphabetical by species, items without a known species last, newest first within a species. */
function bySpecies(a: FeedItem, b: FeedItem): number {
  const sa = sortSpecies(a);
  const sb = sortSpecies(b);
  if (sa !== sb) {
    if (sa === null) return 1;
    if (sb === null) return -1;
    return sa.localeCompare(sb);
  }
  return newestFirst(a, b);
}

function ToggleChip({ label, pressed, onToggle }: { label: string; pressed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onToggle}
      className={`inline-flex items-center gap-1.5 pl-2.5 pr-3 py-1 rounded-full text-sm border transition-colors ${
        pressed
          ? "bg-blue-600 border-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:border-blue-500 dark:hover:bg-blue-600"
          : "bg-transparent border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:border-zinc-400 dark:hover:border-zinc-500"
      }`}
    >
      <span
        aria-hidden="true"
        className={`flex h-4 w-4 items-center justify-center rounded-full border ${
          pressed ? "border-white bg-white text-blue-600" : "border-zinc-400 dark:border-zinc-500"
        }`}
      >
        {pressed && (
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {label}
    </button>
  );
}

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
  const [showVideo, setShowVideo] = useState(true);
  const [showAudio, setShowAudio] = useState(true);
  const [includeNonBirds, setIncludeNonBirds] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>("time");
  const [selectedImage, setSelectedImage] = useState<LightboxImage | null>(null);

  const visibleClips = includeNonBirds ? clips : clips.filter(hasKnownBird);
  const visibleAudio = includeNonBirds
    ? audioIdentifications
    : audioIdentifications.filter((audio) => isKnownSpecies(audio.species));
  const hiddenCount =
    (showVideo ? clips.length - visibleClips.length : 0) +
    (showAudio ? audioIdentifications.length - visibleAudio.length : 0);

  const items: FeedItem[] = [
    ...(showVideo
      ? visibleClips.map((clip): FeedItem => ({ type: "video", timestamp: clip.createdAt, clip }))
      : []),
    ...(showAudio
      ? visibleAudio.map((audio): FeedItem => ({ type: "audio", timestamp: audio.detectedAt, audio }))
      : []),
  ].sort(sortOrder === "species" ? bySpecies : newestFirst);

  return (
    <>
      <div className="mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Detection types to show">
          <span className="text-sm text-zinc-500 dark:text-zinc-400 mr-1">Show:</span>
          <ToggleChip label="Video" pressed={showVideo} onToggle={() => setShowVideo((v) => !v)} />
          <ToggleChip label="Audio" pressed={showAudio} onToggle={() => setShowAudio((v) => !v)} />
        </div>
        <label className="inline-flex items-center gap-2 cursor-pointer select-none text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={includeNonBirds}
            onChange={(e) => setIncludeNonBirds(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 accent-blue-600 dark:accent-blue-500 cursor-pointer"
          />
          Include non-birds &amp; unidentified birds
        </label>
        <div>
          <label className="inline-flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            Sort by:
            {/* Native select arrows ignore padding (they hug the border), so hide it and draw our own chevron */}
            <span className="relative inline-flex items-center">
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                className="appearance-none rounded-md border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1 pl-2.5 pr-8 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer"
              >
                <option value="time">Time (newest first)</option>
                <option value="species">Species (A–Z)</option>
              </select>
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </label>
        </div>
      </div>
      <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
        <span>
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
        {hiddenCount > 0 && (
          <span>
            {" "}
            · {hiddenCount} without an identified bird hidden
          </span>
        )}
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
                alt={clipAlt(item.clip)}
                className="w-full aspect-video object-cover cursor-pointer"
                onClick={() =>
                  setSelectedImage({
                    src: `/${item.clip.thumbnailPath}`,
                    alt: clipAlt(item.clip),
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
                          {ident.species && toTitleCase(ident.species)}
                          {ident.gender && ident.gender !== "unknown" ? ` (${ident.gender})` : ""}
                          {ident.count != null && ident.count > 1 ? ` ×${ident.count}` : ""}
                        </p>
                        {ident.confidence != null && (
                          <p className="text-xs text-zinc-400">
                            {Math.round(ident.confidence * 100)}% confidence
                          </p>
                        )}
                      </div>
                    ) : (
                      <div key={i} className="text-sm text-red-500">
                        <p>{ident.nonBirdSpecies ?? "Not a bird"}</p>
                        {ident.confidence != null && (
                          <p className="text-xs text-zinc-400">
                            {Math.round(ident.confidence * 100)}% confidence
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
                  alt={audioSpeciesLabel(item.audio)}
                  className="w-full aspect-video object-cover cursor-pointer"
                  onClick={() =>
                    setSelectedImage({
                      src: `/${item.audio.speciesImagePath}`,
                      alt: audioSpeciesLabel(item.audio),
                    })
                  }
                />
              ) : (
                <div className="w-full aspect-video bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-4xl">
                  🐦
                </div>
              )}
              <div className="p-2">
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{audioSpeciesLabel(item.audio)}</p>
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
      <Lightbox image={selectedImage} onClose={() => setSelectedImage(null)} />
    </>
  );
}

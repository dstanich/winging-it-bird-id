"use client";

import { useEffect, useRef, useState } from "react";
import type { Clip, AudioIdentification } from "@/lib/db";
import { isKnownSpecies, toTitleCase } from "@/lib/species";
import { Lightbox, type LightboxImage } from "@/components/lightbox";

type FeedItem =
  | { type: "video"; timestamp: string; clip: Clip }
  | { type: "audio"; timestamp: string; audio: AudioIdentification };

type MediaFilter = "all" | "video" | "audio";
type SortOrder = "time" | "species";

/** Normalized lowercase key for a known species. */
function normalizeSpecies(species: string): string {
  return species.trim().toLowerCase();
}

/** All unique known bird species across video clips and audio detections, sorted A–Z with item counts. */
function collectAvailableSpecies(
  clips: Clip[],
  audioIdentifications: AudioIdentification[]
): { key: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const clip of clips) {
    const seenInClip = new Set<string>();
    for (const ident of clip.identifications) {
      if (ident.isBird && isKnownSpecies(ident.species)) {
        seenInClip.add(normalizeSpecies(ident.species));
      }
    }
    for (const key of seenInClip) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const audio of audioIdentifications) {
    if (isKnownSpecies(audio.species)) {
      const key = normalizeSpecies(audio.species);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => ({ key, label: toTitleCase(key), count }));
}

/** A clip is worth showing by default only if the AI named at least one bird species. */
function hasKnownBird(clip: Clip): boolean {
  return clip.identifications.some((ident) => ident.isBird && isKnownSpecies(ident.species));
}

/** True when the clip has at least one known bird identification matching the selected species set. */
function clipMatchesSpecies(clip: Clip, selected: Set<string>): boolean {
  return clip.identifications.some(
    (ident) => ident.isBird && isKnownSpecies(ident.species) && selected.has(normalizeSpecies(ident.species))
  );
}

/** True when the audio detection has a known species matching the selected species set. */
function audioMatchesSpecies(audio: AudioIdentification, selected: Set<string>): boolean {
  return isKnownSpecies(audio.species) && selected.has(normalizeSpecies(audio.species));
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
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [includeNonBirds, setIncludeNonBirds] = useState(false);
  const [selectedSpecies, setSelectedSpecies] = useState<string[]>([]);
  const [speciesMenuOpen, setSpeciesMenuOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>("time");
  const [selectedImage, setSelectedImage] = useState<LightboxImage | null>(null);
  const speciesMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!speciesMenuOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (speciesMenuRef.current && !speciesMenuRef.current.contains(e.target as Node)) {
        setSpeciesMenuOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSpeciesMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [speciesMenuOpen]);

  const availableSpecies = collectAvailableSpecies(clips, audioIdentifications);
  const speciesLabelByKey = new Map(availableSpecies.map((s) => [s.key, s.label]));
  const selectedSpeciesSet = new Set(selectedSpecies);
  const hasSpeciesFilter = selectedSpeciesSet.size > 0;

  function toggleSpecies(key: string) {
    setSelectedSpecies((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function resetFilters() {
    setMediaFilter("all");
    setIncludeNonBirds(false);
    setSelectedSpecies([]);
    setSpeciesMenuOpen(false);
  }

  const showVideo = mediaFilter === "all" || mediaFilter === "video";
  const showAudio = mediaFilter === "all" || mediaFilter === "audio";

  const nonBirdClipCount = clips.filter((clip) => !hasKnownBird(clip)).length;
  const nonBirdAudioCount = audioIdentifications.filter((audio) => !isKnownSpecies(audio.species)).length;
  const totalNonBirdCount = nonBirdClipCount + nonBirdAudioCount;

  const visibleClips = clips.filter((clip) => {
    const isBirdClip = hasKnownBird(clip);
    if (!isBirdClip) return includeNonBirds;
    return hasSpeciesFilter ? clipMatchesSpecies(clip, selectedSpeciesSet) : true;
  });

  const visibleAudio = audioIdentifications.filter((audio) => {
    const isBirdAudio = isKnownSpecies(audio.species);
    if (!isBirdAudio) return includeNonBirds;
    return hasSpeciesFilter ? audioMatchesSpecies(audio, selectedSpeciesSet) : true;
  });

  const hiddenCount = includeNonBirds
    ? 0
    : (showVideo ? nonBirdClipCount : 0) + (showAudio ? nonBirdAudioCount : 0);

  const speciesButtonLabel =
    selectedSpecies.length === 0 ? "All species" : `${selectedSpecies.length} selected`;

  const hasActiveFilters = mediaFilter !== "all" || includeNonBirds || hasSpeciesFilter;

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
      {/* Unified Filter & Sort Toolbar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-2 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Segmented Media Filter */}
          <div
            role="group"
            aria-label="Detection types to show"
            className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 p-0.5"
          >
            {(
              [
                { id: "all", label: "All", count: clips.length + audioIdentifications.length },
                { id: "video", label: "Video", count: clips.length },
                { id: "audio", label: "Audio", count: audioIdentifications.length },
              ] as const
            ).map((option) => {
              const active = mediaFilter === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setMediaFilter(option.id)}
                  className={`inline-flex items-center gap-1 rounded px-2.5 py-1 text-sm font-medium transition-colors cursor-pointer ${
                    active
                      ? "bg-blue-600 text-white shadow-xs dark:bg-blue-500"
                      : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
                  }`}
                >
                  <span>{option.label}</span>{" "}
                  <span
                    className={`text-xs ${
                      active ? "text-blue-100" : "text-zinc-400 dark:text-zinc-500"
                    }`}
                  >
                    ({option.count})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Species Multiselect Dropdown */}
          <div
            ref={speciesMenuRef}
            className="relative inline-flex items-center text-sm"
          >
            <button
              type="button"
              aria-label={`Species: ${speciesButtonLabel}`}
              aria-expanded={speciesMenuOpen}
              disabled={availableSpecies.length === 0}
              onClick={() => setSpeciesMenuOpen((open) => !open)}
              className={`relative inline-flex items-center gap-1.5 rounded-md border py-1 pl-2.5 pr-7 text-sm font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                hasSpeciesFilter
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-300"
                  : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:border-zinc-400 dark:hover:border-zinc-600"
              }`}
            >
              <span className="text-zinc-500 dark:text-zinc-400 font-normal">Species:</span>
              <span>{speciesButtonLabel}</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {speciesMenuOpen && (
              <div
                role="group"
                aria-label="Filter by species"
                className="absolute left-0 top-full z-30 mt-1 min-w-60 max-h-64 overflow-y-auto rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 py-1 shadow-lg"
              >
                {availableSpecies.map(({ key, label, count }) => (
                  <label
                    key={key}
                    className="flex items-center justify-between gap-3 px-3 py-1.5 cursor-pointer select-none text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedSpeciesSet.has(key)}
                        onChange={() => toggleSpecies(key)}
                        className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 accent-blue-600 dark:accent-blue-500 cursor-pointer"
                      />
                      <span>{label}</span>
                    </span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-500">{count}</span>
                  </label>
                ))}
                {selectedSpecies.length > 0 && (
                  <div className="border-t border-zinc-200 dark:border-zinc-800 mt-1 pt-1 px-3 py-1">
                    <button
                      type="button"
                      onClick={() => setSelectedSpecies([])}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                    >
                      Clear selection
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Non-birds & Unidentified Toggle Button */}
          <button
            type="button"
            aria-pressed={includeNonBirds}
            onClick={() => setIncludeNonBirds((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium transition-colors cursor-pointer ${
              includeNonBirds
                ? "border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-300"
                : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 hover:border-zinc-400 dark:hover:border-zinc-600"
            }`}
          >
            <span aria-hidden="true" className="text-xs">
              {includeNonBirds ? "✓" : "+"}
            </span>
            <span>Include non-birds &amp; unidentified</span>{" "}
            <span
              className={`text-xs ${
                includeNonBirds ? "text-blue-600 dark:text-blue-300" : "text-zinc-400 dark:text-zinc-500"
              }`}
            >
              ({totalNonBirdCount})
            </span>
          </button>
        </div>

        {/* Sort Control */}
        <div className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
          <span>Sort:</span>
          <div
            role="group"
            aria-label="Sort order"
            className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 p-0.5"
          >
            <button
              type="button"
              aria-pressed={sortOrder === "time"}
              onClick={() => setSortOrder("time")}
              className={`rounded px-2.5 py-1 text-sm font-medium transition-colors cursor-pointer ${
                sortOrder === "time"
                  ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              Newest
            </button>
            <button
              type="button"
              aria-pressed={sortOrder === "species"}
              onClick={() => setSortOrder("species")}
              className={`rounded px-2.5 py-1 text-sm font-medium transition-colors cursor-pointer ${
                sortOrder === "species"
                  ? "bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-xs"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              }`}
            >
              Species A–Z
            </button>
          </div>
        </div>
      </div>

      {/* Active Filter Pills */}
      {(hasSpeciesFilter || includeNonBirds) && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 mr-0.5">
            Active filters:
          </span>
          {selectedSpecies.map((key) => {
            const label = speciesLabelByKey.get(key) ?? toTitleCase(key);
            return (
              <button
                key={key}
                type="button"
                aria-label={`Remove ${label} filter`}
                onClick={() => toggleSpecies(key)}
                className="inline-flex items-center gap-1 rounded-full bg-blue-600 dark:bg-blue-500 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-blue-700 dark:hover:bg-blue-600 cursor-pointer"
              >
                <span>{label}</span>
                <span aria-hidden="true">&times;</span>
              </button>
            );
          })}
          {includeNonBirds && (
            <button
              type="button"
              aria-label="Remove non-birds and unidentified filter"
              onClick={() => setIncludeNonBirds(false)}
              className="inline-flex items-center gap-1 rounded-full bg-zinc-700 dark:bg-zinc-600 px-2.5 py-0.5 text-xs font-medium text-white hover:bg-zinc-800 dark:hover:bg-zinc-500 cursor-pointer"
            >
              <span>Non-birds &amp; unidentified</span>
              <span aria-hidden="true">&times;</span>
            </button>
          )}
        </div>
      )}

      {/* Result Count & Reset Bar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        <p>
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
        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
          >
            Reset filters
          </button>
        )}
      </div>

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

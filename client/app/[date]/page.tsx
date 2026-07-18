import {
  getAvailableDates,
  getClipsForDate,
  getAudioIdentificationsForDate,
  getDateSummary,
  formatDateHeading,
  formatClipTime,
} from "@/lib/db";
import { ClipGrid } from "./clip-grid";

export function generateStaticParams() {
  return getAvailableDates().map((date) => ({ date }));
}

export default async function DatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const clips = getClipsForDate(date);
  const audioIdentifications = getAudioIdentificationsForDate(date);
  const summary = getDateSummary(clips, audioIdentifications);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 px-4 py-8">
      <main className="max-w-6xl mx-auto">
        <a
          href="/"
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          &larr; Home
        </a>
        <h1 className="text-3xl font-bold mt-2 mb-6 text-zinc-900 dark:text-zinc-100">
          {formatDateHeading(date)}
        </h1>

        <h2 className="text-xl font-semibold mb-3 text-zinc-800 dark:text-zinc-200">
          Summary
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-2 mb-8">
          <div className="flex">
            <span className="w-36 shrink-0 text-sm font-medium text-zinc-500 dark:text-zinc-400">Clips</span>
            <span className="text-sm text-zinc-900 dark:text-zinc-100">{summary.clipCount}</span>
          </div>
          {summary.busiestHour && (
            <div className="flex">
              <span className="w-36 shrink-0 text-sm font-medium text-zinc-500 dark:text-zinc-400">Busiest hour</span>
              <span className="text-sm text-zinc-900 dark:text-zinc-100">{summary.busiestHour}</span>
            </div>
          )}
          <div className="flex">
            <span className="w-36 shrink-0 text-sm font-medium text-zinc-500 dark:text-zinc-400">Birds</span>
            <span className="text-sm text-zinc-900 dark:text-zinc-100">{summary.birdCount}</span>
          </div>
          {summary.mostCommonBirds.length > 0 && (
            <div className="flex">
              <span className="w-36 shrink-0 text-sm font-medium text-zinc-500 dark:text-zinc-400">Most common</span>
              <span className="text-sm text-zinc-900 dark:text-zinc-100">{summary.mostCommonBirds.join(", ")}</span>
            </div>
          )}
          <div className="flex">
            <span className="w-36 shrink-0 text-sm font-medium text-zinc-500 dark:text-zinc-400">Non-birds</span>
            <span className="text-sm text-zinc-900 dark:text-zinc-100">{summary.nonBirdCount}</span>
          </div>
          <div className="flex">
            <span className="w-36 shrink-0 text-sm font-medium text-zinc-500 dark:text-zinc-400">Squirrel visits</span>
            <span className="text-sm text-zinc-900 dark:text-zinc-100">{summary.squirrelVisits}</span>
          </div>
          <div className="flex">
            <span className="w-36 shrink-0 text-sm font-medium text-zinc-500 dark:text-zinc-400">Songs heard</span>
            <span className="text-sm text-zinc-900 dark:text-zinc-100">{summary.audioDetectionCount}</span>
          </div>
          {summary.uniqueSpeciesHeard > 0 && (
            <div className="flex">
              <span className="w-36 shrink-0 text-sm font-medium text-zinc-500 dark:text-zinc-400">Species heard</span>
              <span className="text-sm text-zinc-900 dark:text-zinc-100">{summary.uniqueSpeciesHeard}</span>
            </div>
          )}
        </div>

        <h2 className="text-xl font-semibold mb-3 text-zinc-800 dark:text-zinc-200">
          Feeder Activity
        </h2>
        <ClipGrid
          clips={clips}
          clipTimes={Object.fromEntries(clips.map((c) => [c.id, formatClipTime(c.createdAt)]))}
          audioIdentifications={audioIdentifications}
          audioTimes={Object.fromEntries(
            audioIdentifications.map((a) => [String(a.id), formatClipTime(a.detectedAt)])
          )}
        />
      </main>
    </div>
  );
}

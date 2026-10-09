import {
  getClipsForDate,
  getAudioIdentificationsForDate,
  getDateSummary,
  getDailyImage,
  formatDateHeading,
} from "@/lib/db";
import { pageHref } from "@/lib/links";
import { DailyImagePlaceholder } from "./daily-image-placeholder";

/** Responsive grid of date cards (daily image + quick stats), each linking to its date page. */
export function DateCardGrid({ dates }: { dates: string[] }) {
  return (
    <>
      <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
        Each image is an AI-generated representation of the birds that visited that day.
        Click a date to see the real camera images and audio clips.
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {dates.map((date) => (
          <li key={date}>
            <DateCard date={date} />
          </li>
        ))}
      </ul>
    </>
  );
}

function DateCard({ date }: { date: string }) {
  const summary = getDateSummary(getClipsForDate(date), getAudioIdentificationsForDate(date));
  const dailyImage = getDailyImage(date);
  const stats = [
    { label: "Clips", value: summary.video.clipCount },
    { label: "Species seen", value: summary.video.uniqueSpeciesCount },
    { label: "Songs heard", value: summary.audio.detectionCount },
  ];

  return (
    <a
      href={pageHref(`/${date}`)}
      className="group block h-full rounded-lg overflow-hidden bg-white dark:bg-zinc-900 shadow-sm hover:shadow-md transition-shadow"
    >
      <div className="p-2">
        {!dailyImage ? (
          <DailyImagePlaceholder status="pending" className="aspect-square w-full" />
        ) : !dailyImage.imagePath ? (
          <DailyImagePlaceholder status="no-birds" className="aspect-square w-full" />
        ) : (
          <img
            src={`/${dailyImage.imagePath}`}
            alt={`Cartoon illustration of ${dailyImage.species.join(", ")}`}
            title={dailyImage.species.join(", ")}
            className="aspect-square w-full rounded-lg object-cover"
          />
        )}
      </div>
      <div className="px-3 pb-3">
        <h3 className="font-semibold text-blue-600 dark:text-blue-400 group-hover:underline">
          {formatDateHeading(date)}
        </h3>
        <dl className="mt-1 space-y-0.5">
          {stats.map(({ label, value }) => (
            <div key={label} className="flex text-sm">
              <dt className="w-28 shrink-0 text-zinc-500 dark:text-zinc-400">{label}</dt>
              <dd className="text-zinc-900 dark:text-zinc-100">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </a>
  );
}

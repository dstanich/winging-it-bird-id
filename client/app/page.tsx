import { getAvailableDates } from "@/lib/db";
import { pageHref } from "@/lib/links";
import { LightboxLink } from "@/components/lightbox";
import { DateCardGrid } from "@/components/date-card-grid";

export default function Home() {
  const dates = getAvailableDates();

  return (
    <div className="px-4 py-8">
      <main className="max-w-6xl mx-auto">
        <p className="max-w-2xl mb-8 text-zinc-600 dark:text-zinc-400">
          AI powered bird identifications (<a href={pageHref("/settings")} className="text-blue-600 dark:text-blue-400 hover:underline">current AI settings</a>) written in collaboration with GitHub Copilot and Claude Code
          {' '}(<a href="https://github.com/dstanich/winging-it-bird-id" target="_blank" className="text-blue-600 dark:text-blue-400 hover:underline">GitHub Repo</a>). Location of camera is in the
          {' '}midwest USA using a <a href="https://reolink.com/product/argus-3-pro" target="_blank" className="text-blue-600 dark:text-blue-400 hover:underline">Reolink camera</a> mounted inside a
          {' '}<LightboxLink
            src="/images/feeder-20260704.jpg"
            alt="Bird feeder camera setup"
            className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
          >
            3D printed bird feeder
          </LightboxLink>
          {' '}(<a href="https://makerworld.com/en/models/1239253-smart-bird-feeder-with-integrated-wifi-camera" target="_blank" className="text-blue-600 dark:text-blue-400 hover:underline">MakerWorld model</a>).
        </p>
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">Recent Dates</h2>
        <DateCardGrid dates={dates.slice(0, 8)} />
        {dates.length > 8 && (
          <a
            href={pageHref("/all-dates")}
            className="inline-block mt-6 text-lg text-blue-600 dark:text-blue-400 hover:underline"
          >
            View all dates &rarr;
          </a>
        )}
      </main>
    </div>
  );
}

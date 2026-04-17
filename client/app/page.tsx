import { getAvailableDates, formatDateHeading } from "@/lib/db";

export default function Home() {
  const dates = getAvailableDates();

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 px-4 py-8">
      <main className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-3">
            <img src="/images/winging-it-512x512.png" alt="Logo" width={40} height={40} />
            Winging-It Bird ID
          </h1>
          <a href="https://github.com/dstanich/blink-bird-id" target="_blank">
            <img src="/images/github-mark.svg" alt="GitHub" width={40} height={40} className="dark:invert" />
          </a>
        </div>
        <p className="max-w-2xl mb-8 text-zinc-600 dark:text-zinc-400">
          AI powered bird identifications (<a href="/settings/index.html" className="text-blue-600 dark:text-blue-400 hover:underline">current AI settings</a>) written in collaboration with GitHub Copilot and Claude Code
          {' '}(<a href="https://github.com/dstanich/blink-bird-id" target="_blank" className="text-blue-600 dark:text-blue-400 hover:underline">GitHub Repo</a>). Location of camera is in the
          {' '}midwest USA using a Blink camera mounted inside a
          {' '}<a href="https://makerworld.com/en/models/1239253-smart-bird-feeder-with-integrated-wifi-camera" target="_blank" className="text-blue-600 dark:text-blue-400 hover:underline">3D printed bird feeder</a>.
        </p>
        <div className="flex flex-col md:flex-row md:gap-12">
          <div>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-4">Date</h2>
            <ul className="space-y-2">
              {dates.slice(0, 8).map((date) => (
                <li key={date}>
                  <a
                    href={`/${date}/index.html`}
                    className="text-lg text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {formatDateHeading(date)}
                  </a>
                </li>
              ))}
            </ul>
            {dates.length > 8 && (
              <a
                href="/all-dates/index.html"
                className="inline-block mt-4 text-lg text-blue-600 dark:text-blue-400 hover:underline"
              >
                View all dates &rarr;
              </a>
            )}
          </div>
          <div className="mt-6 md:mt-0">
            <img
              src="/images/feeder-20260326.jpg"
              alt="Bird feeder camera setup"
              className="w-full max-w-sm rounded-lg"
            />
          </div>
        </div>
      </main>
    </div>
  );
}

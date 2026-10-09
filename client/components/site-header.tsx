/**
 * Site-wide header bar rendered by the root layout on every page: the logo +
 * title (links home) and the GitHub repo icon. Sticky with a translucent,
 * blurred background so it stays readable over page content while scrolling.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/85 shadow-sm backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/85">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        {/* Plain <a> on purpose: static export, see the "Key Conventions" in AGENTS.md */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="flex items-center gap-3 text-zinc-900 dark:text-zinc-100"
        >
          <img
            src="/images/winging-it-512x512.png"
            alt=""
            width={40}
            height={40}
            className="rounded-full ring-1 ring-zinc-200 dark:ring-zinc-700"
          />
          <span className="text-xl font-bold tracking-tight sm:text-2xl">
            Winging-It Bird ID
          </span>
        </a>
        <a
          href="https://github.com/dstanich/winging-it-bird-id"
          target="_blank"
          aria-label="GitHub repository"
          className="shrink-0 rounded-full p-1.5 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <img src="/images/github-mark.svg" alt="" width={28} height={28} className="dark:invert" />
        </a>
      </div>
    </header>
  );
}

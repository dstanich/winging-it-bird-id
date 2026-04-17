import { getAvailableDates, formatDateHeading } from "@/lib/db";

export default function AllDatesPage() {
  const dates = getAvailableDates();

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
          All Dates
        </h1>
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {dates.map((date) => (
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
      </main>
    </div>
  );
}

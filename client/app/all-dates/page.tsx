import { getAvailableDates } from "@/lib/db";
import { DateCardGrid } from "@/components/date-card-grid";

export default function AllDatesPage() {
  const dates = getAvailableDates();

  return (
    <div className="px-4 py-8">
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
        <DateCardGrid dates={dates} />
      </main>
    </div>
  );
}

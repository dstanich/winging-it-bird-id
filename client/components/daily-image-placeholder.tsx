const baseClass =
  "flex flex-col items-center justify-center gap-1.5 p-2 text-center rounded-lg border-2 border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-400 dark:text-zinc-500";

/**
 * Dashed stand-in for a daily species image: PENDING (with a clock icon) before the
 * day's image exists, or "No birds identified" for a completed day with no image.
 * `className` sets the size, so it can match a thumbnail or fill a card.
 */
export function DailyImagePlaceholder({
  status,
  className,
}: {
  status: "pending" | "no-birds";
  className: string;
}) {
  return (
    <div className={`${baseClass} ${className}`}>
      {status === "pending" ? (
        <>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-7 w-7"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span className="text-xs font-semibold tracking-widest">PENDING</span>
        </>
      ) : (
        <span className="text-xs font-medium">No birds identified</span>
      )}
    </div>
  );
}

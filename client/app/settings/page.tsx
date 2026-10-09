import { getActiveSettings } from "@/lib/db";

export default function SettingsPage() {
  const settings = getActiveSettings();

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
          Current AI Settings
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SettingsCard
            title="Bird Identification"
            description="Identifies the birds in each camera clip."
            rows={[
              ["Identification model", settings.aiModel],
              ["Identification prompt", settings.aiPrompt],
            ]}
          />
          <SettingsCard
            title="Species of the Day Image"
            description="Generates an illustration of each completed day's birds."
            rows={[
              ["Daily image model", settings.aiImageModel],
              ["Daily image prompt", settings.aiImagePrompt],
            ]}
          />
        </div>
      </main>
    </div>
  );
}

function SettingsCard({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: [label: string, value: string | null][];
}) {
  return (
    <section className="rounded-lg bg-white dark:bg-zinc-900 shadow-sm p-4">
      <h2 className="text-xl font-semibold text-zinc-800 dark:text-zinc-200">{title}</h2>
      <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>
      <div className="space-y-2 text-zinc-700 dark:text-zinc-300">
        {rows.map(([label, value]) => (
          <p key={label}><span className="font-medium">{label}:</span> {value ?? "Not set"}</p>
        ))}
      </div>
    </section>
  );
}

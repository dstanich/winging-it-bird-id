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

        <h2 className="text-xl font-semibold mb-3 text-zinc-800 dark:text-zinc-200">
          AI Configuration
        </h2>
        <div className="space-y-2 text-zinc-700 dark:text-zinc-300">
          <p><span className="font-medium">AI model:</span> {settings.aiModel ?? "Not set"}</p>
          <p><span className="font-medium">AI prompt:</span> {settings.aiPrompt ?? "Not set"}</p>
        </div>
      </main>
    </div>
  );
}

/**
 * Daily image generation - once a local day is complete (7 AM the following
 * day), asks the AI provider for a cartoon illustration of every known bird
 * species seen (video) or heard (BirdNET-Go audio) that day, and records it
 * in storage. Days with no known species get a row with no image, so they're
 * marked done and the client can show "No birds identified".
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AIProvider } from './ai-provider.ts';
import type { Storage } from './storage.ts';
import type { BirdSpecies } from './types.ts';

export interface DailyImageOptions {
  /** Images are written to downloadDir/YYYY/M/D/. */
  downloadDir: string;
  /** How many days back (before today) to consider. */
  lookbackDays: number;
  /** Delay after each AI call (successful or not), to avoid rate limits. */
  delayMs: number;
}

/** Local hour on the following day at which a day counts as complete. */
export const DAY_COMPLETE_HOUR = 7;

const MIME_EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Species names the AI uses when it can't identify the bird, e.g. "unknown" or "unknown bird". */
function isKnownSpecies(species: string | null | undefined): species is string {
  return species != null && species.trim() !== '' && !/\b(unknown|unidentified)\b/i.test(species);
}

function toTitleCase(name: string): string {
  return name.replace(/(^|\s)(\S)/g, (_, space: string, ch: string) => space + ch.toUpperCase());
}

/**
 * Formats a local date as YYYY-MM-DD.
 */
export function localDateString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Merges video and audio species into one de-duplicated, title-cased,
 * alphabetical list of known species. Matching ignores case, since the AI
 * stores lowercase names and BirdNET-Go doesn't.
 */
export function mergeSpecies({ video, audio }: BirdSpecies): string[] {
  const byKey = new Map<string, string>();
  for (const name of [...video, ...audio]) {
    if (!isKnownSpecies(name)) continue;
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, toTitleCase(trimmed));
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
}

/**
 * Returns the local start-of-day Dates for the completed days in the lookback
 * window, oldest first. Yesterday is complete only from DAY_COMPLETE_HOUR today.
 */
export function completedDays(now: Date, lookbackDays: number): Date[] {
  const days: Date[] = [];
  for (let i = lookbackDays; i >= 1; i--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const completeAt = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, DAY_COMPLETE_HOUR);
    if (now >= completeAt) days.push(day);
  }
  return days;
}

/**
 * Generates and stores a daily image for each completed day in the lookback
 * window that doesn't have one yet. Failed generations store nothing, so the
 * next tick retries them.
 *
 * @returns Number of images generated.
 */
export async function generateDailyImages(storage: Storage, aiProvider: AIProvider, { downloadDir, lookbackDays, delayMs }: DailyImageOptions): Promise<number> {
  let generated = 0;

  for (const day of completedDays(new Date(), lookbackDays)) {
    const date = localDateString(day);
    if (storage.getDailyImage(date)) continue;

    const nextDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    const species = mergeSpecies(storage.getBirdSpeciesBetween(day.toISOString(), nextDay.toISOString()));

    if (species.length === 0) {
      storage.addDailyImage({ date, species, local_path: null });
      console.log(`✓ No known bird species on ${date}; skipping daily image`);
      continue;
    }

    try {
      console.log(`Generating daily image for ${date}: ${species.join(', ')}`);
      const image = await aiProvider.generateImage(species.join(', '));

      const ext = MIME_EXTENSIONS[image.mimeType] ?? 'png';
      const dayDir = path.join(downloadDir, `${day.getFullYear()}`, `${day.getMonth() + 1}`, `${day.getDate()}`);
      fs.mkdirSync(dayDir, { recursive: true });
      const localPath = path.join(dayDir, `daily-${date}.${ext}`);
      fs.writeFileSync(localPath, image.data);

      storage.addDailyImage({
        date,
        species,
        local_path: localPath,
        ai_model_id: image.ai_model_id,
        ai_prompt_id: image.ai_prompt_id,
      });
      generated++;
      console.log(`✓ Saved daily image for ${date} to ${localPath}`);
    } catch (error) {
      console.error(`Error generating daily image for ${date}:`, error);
    }

    // Delay after every AI call, including failed ones (often rate limits)
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  return generated;
}

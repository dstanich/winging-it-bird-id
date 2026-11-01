/**
 * Clip processing steps used by the main loop: the cooldown filter that
 * discards near-duplicate clips, and the AI identification pass.
 */

import * as fs from 'fs';
import type { AIProvider } from './ai-provider.ts';
import type { BirdIdentification, Clip } from './types.ts';

const HUMAN_OBJECT_PATTERN = new RegExp(
  '\\b(' +
    [
      'humans?',
      'persons?',
      'people',
      'adults?',
      'child',
      'children',
      'kids?',
      'bab(?:y|ies)',
      'infants?',
      'toddlers?',
      'teens?',
      'teenagers?',
      'man',
      'men',
      'woman',
      'women',
      'boys?',
      'girls?',
      'guys?',
      'pedestrians?',
      'hands?',
      'fists?',
      'knuckles?',
      'fingers?',
      'thumbs?',
      'fingertips?',
      'fingernails?',
      'arms?',
      'forearms?',
      'wrists?',
      'elbows?',
      'shoulders?',
      'faces?',
      'torsos?',
      'legs?',
      'foot',
      'feet',
      'ankles?',
    ].join('|') +
    ')\\b',
  'i',
);

function isHumanLabel(value: string | null | undefined): boolean {
  if (!value) return false;
  return HUMAN_OBJECT_PATTERN.test(value.replaceAll('_', ' '));
}

/**
 * Returns true if any identification in the AI response describes a human or
 * human body part (e.g. human, person, hand, arm, child, adult).
 */
export function isHumanIdentification(
  identification: BirdIdentification | BirdIdentification[] | null | undefined,
): boolean {
  if (!identification) return false;
  const list = Array.isArray(identification) ? identification : [identification];
  return list.some(ident => isHumanLabel(ident.non_bird_species) || isHumanLabel(ident.species));
}

/**
 * Remove a discarded clip's video and thumbnail files from disk, logging on failure.
 */
function discardClipFiles(clip: Clip): void {
  for (const filePath of [clip.localVideoPath, clip.localThumbnailPath]) {
    if (!filePath) continue;
    try {
      fs.rmSync(filePath, { force: true });
    } catch (error) {
      console.error(`Error removing discarded file ${filePath}:`, error);
    }
  }
}

/**
 * Discards clips whose timestamp falls within cooldownSeconds after the
 * previously processed clip's timestamp, to avoid burning AI calls on bursts
 * of near-duplicate clips. Discarded clips have their video and thumbnail
 * deleted immediately and are never sent to the AI or stored.
 *
 * Each clip is measured against the later of: an earlier clip kept in this
 * batch, and lastProcessedMs (the newest stored clip) if it is at or before
 * the clip. Clips older than lastProcessedMs (a retry of a clip whose AI call
 * failed, or a late backlog upload) aren't measured against it, so they aren't
 * discarded - nor checked against older stored clips, which aren't known here.
 *
 * @param clips - Newly discovered clips (unsorted).
 * @param lastProcessedMs - Epoch ms of the last processed clip, seeded from storage, or null if none yet.
 * @param cooldownSeconds - Cooldown window; 0 disables the filter.
 * @returns Clips to actually process (chronological order when the filter is enabled).
 */
export function applyCooldown(clips: Clip[], lastProcessedMs: number | null, cooldownSeconds: number): Clip[] {
  if (!cooldownSeconds) return clips;

  const sorted = [...clips].sort((a, b) => a.id - b.id);
  const kept: Clip[] = [];
  let lastKeptMs: number | null = null;

  for (const clip of sorted) {
    const clipMs = clip.id * 1000;
    const earlier = [lastKeptMs, lastProcessedMs].filter((ms): ms is number => ms !== null && ms <= clipMs);
    const lastMs = earlier.length ? Math.max(...earlier) : null;
    if (lastMs !== null && clipMs - lastMs < cooldownSeconds * 1000) {
      const diffSeconds = ((clipMs - lastMs) / 1000).toFixed(1);
      console.log(`Discarding clip ${clip.id} (${clip.media}): ${diffSeconds}s since last processed clip, within ${cooldownSeconds}s cooldown`);
      discardClipFiles(clip);
      continue;
    }
    lastKeptMs = clipMs;
    kept.push(clip);
  }

  return kept;
}

/**
 * Process clips: identify birds using AI. Each successful clip gets its
 * birdIdentification set; clips identified as human-related objects are
 * discarded (their video and thumbnail are deleted immediately and they are
 * not returned for storage); failed clips are logged and left out of the
 * result so they can be retried on the next tick.
 *
 * @param delayMs - Delay after each AI call (successful, discarded, or failed), to avoid rate limits.
 * @returns Successfully processed non-human clips.
 */
export async function processClips(clips: Clip[], aiProvider: AIProvider, delayMs: number): Promise<Clip[]> {
  const successfulClips: Clip[] = [];
  for (const clip of clips) {
    try {
      // Bird ID processing
      const { id, localThumbnailPath } = clip;
      console.log(`\nProcessing clip ${id} with thumbnail at ${localThumbnailPath}`);
      const aiResponse = await aiProvider.identifyBird(clip, localThumbnailPath!);
      if (isHumanIdentification(aiResponse)) {
        console.log(`Discarding clip ${id} (${clip.media}): identified as human-related object`);
        discardClipFiles(clip);
      } else {
        clip.birdIdentification = aiResponse;
        successfulClips.push(clip);
        console.log(`✓ Processed clip ${id} successfully`);
      }
    } catch (error) {
      console.error(`Error processing clip ${clip.id}:`, error);
    }

    // Delay for delayMs milliseconds after every AI call, including failed
    // ones (often rate limits), to avoid hammering the API
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return successfulClips;
}

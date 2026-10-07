/**
 * Clip processing steps used by the main loop: the cooldown filter that
 * discards near-duplicate clips, and the AI identification pass.
 */

import * as fs from 'fs';

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
 * @param {Array} clips - Newly discovered clips (unsorted).
 * @param {number|null} lastProcessedMs - Epoch ms of the last processed clip, seeded from storage, or null if none yet.
 * @param {number} cooldownSeconds - Cooldown window; 0 disables the filter.
 * @returns {Array} Clips to actually process (chronological order when the filter is enabled).
 */
export function applyCooldown(clips, lastProcessedMs, cooldownSeconds) {
  if (!cooldownSeconds) return clips;

  const sorted = [...clips].sort((a, b) => a.id - b.id);
  const kept = [];
  let lastKeptMs = null;

  for (const clip of sorted) {
    const clipMs = clip.id * 1000;
    const earlier = [lastKeptMs, lastProcessedMs].filter(ms => ms !== null && ms <= clipMs);
    const lastMs = earlier.length ? Math.max(...earlier) : null;
    if (lastMs !== null && clipMs - lastMs < cooldownSeconds * 1000) {
      const diffSeconds = ((clipMs - lastMs) / 1000).toFixed(1);
      console.log(`Discarding clip ${clip.id} (${clip.media}): ${diffSeconds}s since last processed clip, within ${cooldownSeconds}s cooldown`);
      for (const filePath of [clip.localVideoPath, clip.localThumbnailPath]) {
        if (!filePath) continue;
        try {
          fs.rmSync(filePath, { force: true });
        } catch (error) {
          console.error(`Error removing discarded file ${filePath}:`, error);
        }
      }
      continue;
    }
    lastKeptMs = clipMs;
    kept.push(clip);
  }

  return kept;
}

/**
 * Process clips: identify birds using AI. Each successful clip gets its
 * birdIdentification set; failed clips are logged and left out of the result.
 *
 * @param {Array} clips
 * @param {import('./ai-provider.js').AIProvider} aiProvider
 * @param {number|string} delayMs - Delay after each AI call (successful or not), to avoid rate limits.
 * @returns {Promise<Array>} Successfully processed clips.
 */
export async function processClips(clips, aiProvider, delayMs) {
  const successfulClips = [];
  for (const clip of clips) {
    try {
      // Bird ID processing
      const { id, localThumbnailPath } = clip;
      console.log(`\nProcessing clip ${id} with thumbnail at ${localThumbnailPath}`);
      const aiResponse = await aiProvider.identifyBird(clip, localThumbnailPath);
      clip.birdIdentification = aiResponse;
      successfulClips.push(clip);
      console.log(`✓ Processed clip ${id} successfully`);
    } catch (error) {
      console.error(`Error processing clip ${clip.id}:`, error);
    }

    // Delay for delayMs milliseconds after every AI call, including failed
    // ones (often rate limits), to avoid hammering the API
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return successfulClips;
}

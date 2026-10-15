/**
 * Local-testing helper: turns still bird photos into short Reolink-named
 * videos in the upload directory, so the main loop has real clips to
 * discover and identify without the camera. Used by scripts/seed-uploads.js.
 */

import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { FFMPEG_PATH } from './ffmpeg-path.ts';

ffmpeg.setFfmpegPath(FFMPEG_PATH);

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);

// Non-bird photos (squirrels, empty feeder, ...) are told apart by filename, e.g. nonbird.jpg.
const NON_BIRD_PATTERN = /^non/i;

// Thumbnails are extracted at the 1-second mark, so videos must run past it.
const VIDEO_DURATION_SECONDS = 3;

// Gap between generated clip timestamps when no larger cooldown requires more.
const MIN_SPACING_SECONDS = 300;

export interface SeedUploadsOptions {
  imageDir: string;
  uploadDir: string;
  /** Bird clips; non-bird clips are added on top. */
  count: number;
  cameraName: string;
  cooldownSeconds?: number;
  now?: Date;
  random?: () => number;
}

export interface SeededClip {
  imagePath: string;
  videoPath: string;
  isBird: boolean;
}

/**
 * List image files directly inside imageDir, sorted by name.
 * @returns Absolute or imageDir-relative paths.
 */
export function listImages(imageDir: string): string[] {
  return fs.readdirSync(imageDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).slice(1).toLowerCase()))
    .map(entry => path.join(imageDir, entry.name))
    .sort();
}

/**
 * Whether an image is a non-bird photo, judged by its filename.
 */
export function isNonBirdImage(imagePath: string): boolean {
  return NON_BIRD_PATTERN.test(path.basename(imagePath));
}

/**
 * Number of non-bird clips to add alongside birdCount bird clips: a third, at least 1.
 */
export function nonBirdCount(birdCount: number): number {
  return Math.max(1, Math.floor(birdCount / 3));
}

/**
 * Randomly pick count items. No item repeats until every item has been used
 * once; when count exceeds the pool, further rounds reshuffle the full pool.
 *
 * @param random - Math.random-compatible source.
 */
export function pickRandom<T>(items: T[], count: number, random: () => number = Math.random): T[] {
  if (!items.length) throw new Error('No items to pick from');
  const picked: T[] = [];
  while (picked.length < count) {
    const round = [...items];
    // Fisher-Yates shuffle
    for (let i = round.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [round[i], round[j]] = [round[j], round[i]];
    }
    picked.push(...round.slice(0, count - picked.length));
  }
  return picked;
}

/**
 * Seconds between generated clips: wide enough that VIDEO_COOLDOWN_SECONDS
 * never discards one of them.
 */
export function clipSpacingSeconds(cooldownSeconds: number): number {
  return Math.max(MIN_SPACING_SECONDS, cooldownSeconds + 60);
}

/**
 * Recording times for count clips, newest at `now` and each earlier one
 * spacingSeconds before the next. Whole seconds, since clip IDs are Unix seconds.
 *
 * @returns Oldest first.
 */
export function clipTimestamps(count: number, now: Date, spacingSeconds: number): Date[] {
  const newestMs = Math.floor(now.getTime() / 1000) * 1000;
  return Array.from({ length: count }, (_, i) => new Date(newestMs - (count - 1 - i) * spacingSeconds * 1000));
}

/**
 * Formats a Date as the YYYYMMDDHHMMSS local-time string Reolink uses in FTP filenames.
 */
export function reolinkTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Encode a still image as a short H.264 MP4. Writes to a temp name first and
 * renames, so a server running concurrently never picks up a partial file.
 *
 */
export function imageToVideo(imagePath: string, outputPath: string): Promise<void> {
  const tempPath = `${outputPath}.partial`;
  return new Promise<void>((resolve, reject) => {
    ffmpeg(imagePath)
      .inputOptions(['-loop 1'])
      .outputOptions([
        `-t ${VIDEO_DURATION_SECONDS}`,
        '-r 1',
        '-c:v libx264',
        '-tune stillimage',
        '-pix_fmt yuv420p',
        // libx264 + yuv420p needs even dimensions
        '-vf scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-f mp4',
      ])
      .on('end', () => {
        fs.renameSync(tempPath, outputPath);
        resolve();
      })
      .on('error', (err) => {
        fs.rmSync(tempPath, { force: true });
        reject(err);
      })
      .save(tempPath);
  });
}

/**
 * Generate count bird videos plus nonBirdCount(count) non-bird videos in
 * uploadDir from randomly chosen images in imageDir, shuffled together and
 * named [cameraName]_00_[YYYYMMDDHHMMSS].mp4 with recent, cooldown-safe timestamps.
 * If imageDir has no non-bird images, only bird videos are generated.
 *
 * @returns Oldest first.
 */
export async function seedUploads({ imageDir, uploadDir, count, cameraName, cooldownSeconds = 0, now = new Date(), random = Math.random }: SeedUploadsOptions): Promise<SeededClip[]> {
  const images = listImages(imageDir);
  const birdImages = images.filter(image => !isNonBirdImage(image));
  const nonBirdImages = images.filter(isNonBirdImage);
  if (!birdImages.length) throw new Error(`No bird images found in ${imageDir}`);

  const picks = pickRandom(birdImages, count, random).map(imagePath => ({ imagePath, isBird: true }));
  if (nonBirdImages.length) {
    picks.push(...pickRandom(nonBirdImages, nonBirdCount(count), random).map(imagePath => ({ imagePath, isBird: false })));
  } else {
    console.warn(`No non-bird images (non*.jpg) found in ${imageDir}; seeding bird clips only`);
  }
  // A single full-pool round of pickRandom is a shuffle: mixes non-birds into the timeline.
  const clips = pickRandom(picks, picks.length, random);

  fs.mkdirSync(uploadDir, { recursive: true });
  const timestamps = clipTimestamps(clips.length, now, clipSpacingSeconds(cooldownSeconds));

  const results: SeededClip[] = [];
  for (let i = 0; i < clips.length; i++) {
    const { imagePath, isBird } = clips[i];
    const videoPath = path.join(uploadDir, `${cameraName}_00_${reolinkTimestamp(timestamps[i])}.mp4`);
    await imageToVideo(imagePath, videoPath);
    console.log(`✓ ${path.basename(imagePath)}${isBird ? '' : ' (non-bird)'} → ${videoPath}`);
    results.push({ imagePath, videoPath, isBird });
  }
  return results;
}

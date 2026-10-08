/**
 * Local-testing helper: turns still bird photos into short Reolink-named
 * videos in the upload directory, so the main loop has real clips to
 * discover and identify without the camera. Used by scripts/seed-uploads.js.
 */

import * as fs from 'fs';
import * as path from 'path';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';

ffmpeg.setFfmpegPath(ffmpegPath);

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);

// Thumbnails are extracted at the 1-second mark, so videos must run past it.
const VIDEO_DURATION_SECONDS = 3;

// Gap between generated clip timestamps when no larger cooldown requires more.
const MIN_SPACING_SECONDS = 300;

/**
 * List image files directly inside imageDir, sorted by name.
 * @param {string} imageDir
 * @returns {string[]} Absolute or imageDir-relative paths.
 */
export function listImages(imageDir) {
  return fs.readdirSync(imageDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).slice(1).toLowerCase()))
    .map(entry => path.join(imageDir, entry.name))
    .sort();
}

/**
 * Randomly pick count items. No item repeats until every item has been used
 * once; when count exceeds the pool, further rounds reshuffle the full pool.
 *
 * @template T
 * @param {T[]} items
 * @param {number} count
 * @param {() => number} [random] - Math.random-compatible source.
 * @returns {T[]}
 */
export function pickRandom(items, count, random = Math.random) {
  if (!items.length) throw new Error('No items to pick from');
  const picked = [];
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
 * @param {number} cooldownSeconds
 * @returns {number}
 */
export function clipSpacingSeconds(cooldownSeconds) {
  return Math.max(MIN_SPACING_SECONDS, cooldownSeconds + 60);
}

/**
 * Recording times for count clips, newest at `now` and each earlier one
 * spacingSeconds before the next. Whole seconds, since clip IDs are Unix seconds.
 *
 * @param {number} count
 * @param {Date} now
 * @param {number} spacingSeconds
 * @returns {Date[]} Oldest first.
 */
export function clipTimestamps(count, now, spacingSeconds) {
  const newestMs = Math.floor(now.getTime() / 1000) * 1000;
  return Array.from({ length: count }, (_, i) => new Date(newestMs - (count - 1 - i) * spacingSeconds * 1000));
}

/**
 * Formats a Date as the YYYYMMDDHHMMSS local-time string Reolink uses in FTP filenames.
 * @param {Date} date
 * @returns {string}
 */
export function reolinkTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Encode a still image as a short H.264 MP4. Writes to a temp name first and
 * renames, so a server running concurrently never picks up a partial file.
 *
 * @param {string} imagePath
 * @param {string} outputPath
 * @returns {Promise<void>}
 */
export function imageToVideo(imagePath, outputPath) {
  const tempPath = `${outputPath}.partial`;
  return new Promise((resolve, reject) => {
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
 * Generate count videos in uploadDir from randomly chosen images in imageDir,
 * named [cameraName]_00_[YYYYMMDDHHMMSS].mp4 with recent, cooldown-safe timestamps.
 *
 * @param {object} options
 * @param {string} options.imageDir
 * @param {string} options.uploadDir
 * @param {number} options.count
 * @param {string} options.cameraName
 * @param {number} [options.cooldownSeconds]
 * @param {Date} [options.now]
 * @param {() => number} [options.random]
 * @returns {Promise<Array<{ imagePath: string, videoPath: string }>>}
 */
export async function seedUploads({ imageDir, uploadDir, count, cameraName, cooldownSeconds = 0, now = new Date(), random = Math.random }) {
  const images = listImages(imageDir);
  if (!images.length) throw new Error(`No images found in ${imageDir}`);

  fs.mkdirSync(uploadDir, { recursive: true });
  const picks = pickRandom(images, count, random);
  const timestamps = clipTimestamps(count, now, clipSpacingSeconds(cooldownSeconds));

  const results = [];
  for (let i = 0; i < count; i++) {
    const videoPath = path.join(uploadDir, `${cameraName}_00_${reolinkTimestamp(timestamps[i])}.mp4`);
    await imageToVideo(picks[i], videoPath);
    console.log(`✓ ${path.basename(picks[i])} → ${videoPath}`);
    results.push({ imagePath: picks[i], videoPath });
  }
  return results;
}

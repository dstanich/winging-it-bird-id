/**
 * Seed the local SQLite database and downloads directory with multiple days of
 * test video clips, BirdNET-Go audio detections, species images, and daily
 * images drawn from ../test-birds/, for offline local testing without the
 * camera, BirdNET-Go, or Gemini API calls.
 *
 * Usage: npm run seed:db [-- <days>] [--force]   (default 15 days)
 *
 * Writes <DATA_DIR>/bird-data.db (default ./data/bird-data.db) and copies
 * media into <DOWNLOAD_DIR> (default ./downloads). Refuses to overwrite an
 * existing database unless --force is passed.
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { seedDb } from '../lib/seed-db.ts';
import type { SQLiteStorage } from '../lib/sqlite-storage.ts';
import { Storage } from '../lib/storage.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_DAYS = 15;
const IMAGE_DIR = path.resolve(__dirname, '../../test-birds/images');
const AUDIO_DIR = path.resolve(__dirname, '../../test-birds/audio');

const args = process.argv.slice(2);
const force = args.includes('--force');
const positional = args.filter(arg => arg !== '--force');

const daysArg = positional[0];
const days = daysArg === undefined ? DEFAULT_DAYS : Number(daysArg);
if (!Number.isInteger(days) || days < 1) {
  console.error(`Invalid day count "${daysArg}": expected a positive integer`);
  process.exit(1);
}

const dataDir = process.env.DATA_DIR || './data';
const downloadDir = process.env.DOWNLOAD_DIR || './downloads';
const dbPath = path.join(dataDir, 'bird-data.db');

if (fs.existsSync(dbPath)) {
  if (!force) {
    console.error(`${dbPath} already exists; pass --force to overwrite it`);
    process.exit(1);
  }
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${dbPath}${suffix}`, { force: true });
  }
}

const storage = new Storage();
try {
  const result = seedDb(storage, {
    imageDir: IMAGE_DIR,
    audioDir: AUDIO_DIR,
    downloadDir,
    days,
    cameraName: process.env.CAMERA_NAME || 'Bird',
  });
  console.log(
    `✓ Seeded ${result.days.length} day(s) in ${dbPath}: `
    + `${result.totalClips} clips (${result.totalBirdClips} bird, ${result.totalNonBirdClips} non-bird), `
    + `${result.totalAudioDetections} audio detections, `
    + `${result.totalDailyImages} daily images`,
  );
} catch (err) {
  console.error('Failed to seed database:', err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  (storage.provider as SQLiteStorage).db.close();
}

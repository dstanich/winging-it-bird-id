/**
 * Create a small SQLite database with the real server schema and a few rows of
 * fake data, so the client can be built without a real camera/database (CI).
 *
 * Usage: DATA_DIR=<dir> node scripts/seed-ci-db.js
 *
 * Writes <DATA_DIR>/bird-data.db. Refuses to run without DATA_DIR or when the
 * database already exists, so it can never add fake rows to real data.
 * Media paths point at files that don't exist; the static build doesn't need them.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Storage } from '../lib/storage.js';

const dataDir = process.env.DATA_DIR;
if (!dataDir) {
  console.error('DATA_DIR must be set explicitly');
  process.exit(1);
}
const dbPath = path.join(dataDir, 'bird-data.db');
if (fs.existsSync(dbPath)) {
  console.error(`${dbPath} already exists; refusing to add fake data to it`);
  process.exit(1);
}

const storage = new Storage();
const model = storage.getSettingWithId('ai_model');
const prompt = storage.getSettingWithId('ai_prompt');
const imageModel = storage.getSettingWithId('ai_image_model');
const imagePrompt = storage.getSettingWithId('ai_image_prompt');

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.now();

// Two recent days at 17:00 UTC (midday in America/Chicago, so both land on the same local date)
const days = [2, 1].map((daysAgo) => {
  const date = new Date(now - daysAgo * DAY_MS);
  date.setUTCHours(17, 0, 0, 0);
  return date;
});

days.forEach((day, i) => {
  const birdTime = day;
  const nonBirdTime = new Date(day.getTime() + 15 * 60 * 1000);
  const ymd = `${day.getUTCFullYear()}/${day.getUTCMonth() + 1}/${day.getUTCDate()}`;

  for (const [time, identification] of [
    [birdTime, { is_bird: true, species: 'northern cardinal', gender: 'male', count: 1, confidence: 0.92 }],
    [nonBirdTime, { is_bird: false, non_bird_species: 'squirrel', confidence: 0.88 }],
  ]) {
    const id = Math.floor(time.getTime() / 1000);
    storage.addClip({
      id,
      created_at: time.toISOString(),
      updated_at: time.toISOString(),
      device_name: 'CI Camera',
      network_name: 'Reolink FTP',
      type: 'recording',
      source: 'ftp',
      media: `CI_00_${id}.mp4`,
      time_zone: 'America/Chicago',
      localThumbnailPath: `downloads/${ymd}/${id}.jpg`,
      birdIdentification: { ...identification, ai_model_id: model?.id, ai_prompt_id: prompt?.id },
    });
  }

  const detectedAt = new Date(day.getTime() + 30 * 60 * 1000);
  storage.addAudioIdentification({
    birdnet_detection_id: 1000 + i,
    species: 'Blue Jay',
    scientific_name: 'Cyanocitta cristata',
    species_code: 'blujay',
    confidence: 0.81,
    source: 'ci',
    detected_at: detectedAt.toISOString(),
    local_audio_path: `downloads/${ymd}/audio-${1000 + i}.wav`,
  });
});

// First day has a "no birds" daily image row; the second has none (PENDING)
const firstDate = days[0].toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
storage.addDailyImage({ date: firstDate, species: [], local_path: null, ai_model_id: imageModel?.id, ai_prompt_id: imagePrompt?.id });

console.log(`✓ Seeded CI database at ${dbPath}`);

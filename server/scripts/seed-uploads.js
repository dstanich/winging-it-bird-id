/**
 * Seed the upload directory with short videos made from the test bird photos
 * in ../test-birds/images, for local testing without the camera.
 *
 * Usage: npm run seed:uploads [-- <count>]   (default 5)
 *
 * <count> is the number of bird clips; a third as many non-bird clips (at
 * least 1, from non*.jpg images) are added on top.
 */

import 'dotenv/config';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { seedUploads } from '../lib/seed-uploads.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_COUNT = 5;
const IMAGE_DIR = path.resolve(__dirname, '../../test-birds/images');

const arg = process.argv[2];
const count = arg === undefined ? DEFAULT_COUNT : Number(arg);
if (!Number.isInteger(count) || count < 1) {
  console.error(`Invalid clip count "${arg}": expected a positive integer`);
  process.exit(1);
}

try {
  const results = await seedUploads({
    imageDir: IMAGE_DIR,
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    count,
    cameraName: process.env.CAMERA_NAME || 'Bird',
    cooldownSeconds: parseInt(process.env.VIDEO_COOLDOWN_SECONDS || 0),
  });
  const nonBirds = results.filter(r => !r.isBird).length;
  console.log(`✓ Seeded ${results.length} clip(s): ${results.length - nonBirds} bird, ${nonBirds} non-bird`);
} catch (err) {
  console.error('Failed to seed uploads:', err.message);
  process.exit(1);
}

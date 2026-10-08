import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import {
  listImages, isNonBirdImage, nonBirdCount, pickRandom, clipSpacingSeconds, clipTimestamps, reolinkTimestamp, seedUploads,
} from '../lib/seed-uploads.js';
import { discoverNewClips } from '../lib/ftp-clips.js';
import { useTempDirs } from './helpers.js';

const tempDir = useTempDirs();

/** Writes a small real JPEG with the bundled ffmpeg binary. */
function writeImage(dir, name) {
  const filePath = path.join(dir, name);
  execFileSync(ffmpegPath, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=63x47',
    '-frames:v', '1', filePath,
  ]);
  return filePath;
}

describe('listImages', () => {
  it('returns image files only, sorted', () => {
    const dir = tempDir();
    for (const name of ['b.jpg', 'a.JPEG', 'c.png', 'notes.txt']) fs.writeFileSync(path.join(dir, name), '');
    fs.mkdirSync(path.join(dir, 'nested.jpg'));

    expect(listImages(dir).map(p => path.basename(p))).toEqual(['a.JPEG', 'b.jpg', 'c.png']);
  });
});

describe('isNonBirdImage', () => {
  it('matches filenames starting with "non"', () => {
    expect(isNonBirdImage('/x/nonbird.jpg')).toBe(true);
    expect(isNonBirdImage('/x/NoneBird2.JPG')).toBe(true);
    expect(isNonBirdImage('/x/cardinal.jpg')).toBe(false);
    expect(isNonBirdImage('/nonbird/cardinal.jpg')).toBe(false);
  });
});

describe('nonBirdCount', () => {
  it('is a third of the bird count, rounded down, at least 1', () => {
    expect([1, 2, 3, 5, 6, 12, 13].map(nonBirdCount)).toEqual([1, 1, 1, 1, 2, 4, 4]);
  });
});

describe('pickRandom', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];

  it('never repeats when count is within the pool', () => {
    for (let count = 1; count <= items.length; count++) {
      const picked = pickRandom(items, count);
      expect(picked).toHaveLength(count);
      expect(new Set(picked).size).toBe(count);
    }
  });

  it('uses every item once per round when count exceeds the pool', () => {
    const picked = pickRandom(items, 12);
    expect(picked).toHaveLength(12);
    expect([...picked.slice(0, 5)].sort()).toEqual(items);
    expect([...picked.slice(5, 10)].sort()).toEqual(items);
    expect(new Set(picked.slice(10)).size).toBe(2);
  });

  it('is driven by the random source', () => {
    expect(pickRandom(items, 5, () => 0.999)).toEqual(items);
    expect(pickRandom(items, 5, () => 0)).toEqual(['b', 'c', 'd', 'e', 'a']);
  });

  it('throws on an empty pool', () => {
    expect(() => pickRandom([], 1)).toThrow();
  });
});

describe('clipSpacingSeconds', () => {
  it('uses the minimum spacing unless the cooldown needs more', () => {
    expect(clipSpacingSeconds(0)).toBe(300);
    expect(clipSpacingSeconds(600)).toBe(660);
  });
});

describe('clipTimestamps', () => {
  it('ends at now (whole seconds) and steps back by the spacing, oldest first', () => {
    const now = new Date('2026-10-07T12:00:00.750Z');
    expect(clipTimestamps(3, now, 300).map(d => d.toISOString())).toEqual([
      '2026-10-07T11:50:00.000Z',
      '2026-10-07T11:55:00.000Z',
      '2026-10-07T12:00:00.000Z',
    ]);
  });
});

describe('reolinkTimestamp', () => {
  it('formats local time as YYYYMMDDHHMMSS', () => {
    expect(reolinkTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102030405');
  });
});

describe('seedUploads', () => {
  const now = new Date(2026, 9, 7, 8, 30, 0);

  it('writes Reolink-named videos that clip discovery accepts', async () => {
    const imageDir = tempDir();
    const uploadDir = path.join(tempDir(), 'uploads');
    const downloadDir = tempDir();
    writeImage(imageDir, 'cardinal.jpg');
    writeImage(imageDir, 'bluejay.jpg');
    writeImage(imageDir, 'nonbird.jpg');

    const results = await seedUploads({ imageDir, uploadDir, count: 2, cameraName: 'Feeder', now });

    expect(fs.readdirSync(uploadDir).sort()).toEqual([
      'Feeder_00_20261007082000.mp4',
      'Feeder_00_20261007082500.mp4',
      'Feeder_00_20261007083000.mp4',
    ]);
    expect(new Set(results.map(r => path.basename(r.imagePath)))).toEqual(new Set(['cardinal.jpg', 'bluejay.jpg', 'nonbird.jpg']));

    const storage = { data: () => ({}) };
    const clips = await discoverNewClips(storage, uploadDir, downloadDir, 'Bird');
    expect(clips).toHaveLength(3);
    for (const clip of clips) {
      expect(clip.device_name).toBe('Feeder');
      expect(fs.existsSync(clip.localThumbnailPath)).toBe(true);
    }
  });

  it('adds a third as many non-bird clips on top of count, never mixing the pools', async () => {
    const imageDir = tempDir();
    const uploadDir = tempDir();
    for (const name of ['cardinal.jpg', 'bluejay.jpg', 'nonbird.jpg', 'nonebird2.jpg']) writeImage(imageDir, name);

    const results = await seedUploads({ imageDir, uploadDir, count: 6, cameraName: 'Feeder', now });

    expect(results).toHaveLength(8);
    const birds = results.filter(r => r.isBird).map(r => path.basename(r.imagePath));
    const nonBirds = results.filter(r => !r.isBird).map(r => path.basename(r.imagePath));
    expect(birds).toHaveLength(6);
    expect(birds.every(name => !name.startsWith('non'))).toBe(true);
    expect(nonBirds.sort()).toEqual(['nonbird.jpg', 'nonebird2.jpg']);
    expect(fs.readdirSync(uploadDir)).toHaveLength(8);
  });

  it('seeds bird clips only, with a warning, when there are no non-bird images', async () => {
    const imageDir = tempDir();
    writeImage(imageDir, 'cardinal.jpg');

    const results = await seedUploads({ imageDir, uploadDir: tempDir(), count: 2, cameraName: 'Feeder', now });

    expect(results.map(r => r.isBird)).toEqual([true, true]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/No non-bird images/));
  });

  it('throws when the image dir has no bird images', async () => {
    const imageDir = tempDir();
    writeImage(imageDir, 'nonbird.jpg');
    await expect(seedUploads({ imageDir, uploadDir: tempDir(), count: 1, cameraName: 'Feeder' }))
      .rejects.toThrow(/No bird images/);
  });
});

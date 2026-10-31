import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  listAudio,
  fileStem,
  randomInt,
  imageToIdentification,
  audioToSpeciesInfo,
  seedDb,
} from '../lib/seed-db.ts';
import type { SQLiteStorage } from '../lib/sqlite-storage.ts';
import { Storage } from '../lib/storage.ts';
import { useTempDirs } from './helpers.ts';

const tempDir = useTempDirs();

describe('listAudio', () => {
  it('returns wav files only, sorted', () => {
    const dir = tempDir();
    for (const name of ['b.wav', 'a.WAV', 'notes.txt', 'c.mp3']) {
      fs.writeFileSync(path.join(dir, name), 'audio');
    }
    fs.mkdirSync(path.join(dir, 'nested.wav'));

    expect(listAudio(dir).map(p => path.basename(p))).toEqual(['a.WAV', 'b.wav']);
  });
});

describe('fileStem', () => {
  it('lowercases the filename and strips trailing digits', () => {
    expect(fileStem('/x/BlueJay23.JPG')).toBe('bluejay');
    expect(fileStem('/x/cardinal.jpg')).toBe('cardinal');
    expect(fileStem('/x/nonbird2.jpg')).toBe('nonbird');
  });
});

describe('randomInt', () => {
  it('returns min at 0 and max near 1', () => {
    expect(randomInt(10, 30, () => 0)).toBe(10);
    expect(randomInt(10, 30, () => 0.9999)).toBe(30);
    expect(randomInt(10, 30, () => 0.5)).toBe(20);
  });
});

describe('imageToIdentification', () => {
  it('maps known bird image stems to species and marks is_bird true', () => {
    const id = imageToIdentification('/x/cardinal3.jpg', () => 0.5);
    expect(id).toMatchObject({
      is_bird: true,
      species: 'northern cardinal',
      gender: 'female',
      count: 1,
    });
    expect(id.confidence).toBeGreaterThanOrEqual(0.8);
    expect(id.confidence).toBeLessThanOrEqual(0.99);
  });

  it('falls back to a readable stem for unknown bird filenames', () => {
    const id = imageToIdentification('/x/tufted_titmouse2.jpg', () => 0);
    expect(id).toMatchObject({
      is_bird: true,
      species: 'tufted titmouse',
      gender: 'male',
      count: 1,
    });
  });

  it('marks non*.jpg filenames as non-bird squirrel identifications', () => {
    const id = imageToIdentification('/x/nonbird2.jpg', () => 0.5);
    expect(id).toMatchObject({
      is_bird: false,
      non_bird_species: 'squirrel',
    });
    expect(id.species).toBeUndefined();
  });
});

describe('audioToSpeciesInfo', () => {
  it('maps known audio filenames to common name, scientific name, and code', () => {
    expect(audioToSpeciesInfo('/x/canadagoose.wav')).toEqual({
      species: 'Canada Goose',
      scientificName: 'Branta canadensis',
      speciesCode: 'cangoo',
    });
  });

  it('falls back to title-cased stem for unknown audio filenames', () => {
    expect(audioToSpeciesInfo('/x/red_hawk2.wav')).toEqual({
      species: 'Red Hawk',
      scientificName: 'Red Hawk sp.',
      speciesCode: 'red_ha',
    });
  });
});

describe('seedDb', () => {
  const now = new Date('2026-10-31T15:00:00.000Z');

  function setupMediaDirs() {
    const imageDir = tempDir();
    const audioDir = tempDir();
    for (const name of ['cardinal.jpg', 'bluejay2.jpg', 'goldfinch.jpg', 'nonbird.jpg']) {
      fs.writeFileSync(path.join(imageDir, name), `img:${name}`);
    }
    for (const name of ['bluejay.wav', 'crow.wav', 'goldfinch.wav']) {
      fs.writeFileSync(path.join(audioDir, name), `wav:${name}`);
    }
    return { imageDir, audioDir };
  }

  it('seeds 15 days by default with 10-30 bird clips (+ 1/3 non-bird) and 10-30 audio detections per day, copying files and leaving the newest day daily image pending', () => {
    const { imageDir, audioDir } = setupMediaDirs();
    const downloadDir = path.join(tempDir(), 'downloads');
    vi.stubEnv('DATA_DIR', path.join(tempDir(), 'data'));

    const storage = new Storage();
    const db = (storage.provider as SQLiteStorage).db;
    try {
      const result = seedDb(storage, {
        imageDir,
        audioDir,
        downloadDir,
        cameraName: 'Feeder',
        now,
        random: () => 0.5, // randomInt(10, 30) -> 20
      });

      expect(result.days).toHaveLength(15);
      expect(result.totalDailyImages).toBe(14);

      for (let i = 0; i < result.days.length; i++) {
        const day = result.days[i];
        expect(day.birdClips).toBe(20);
        expect(day.nonBirdClips).toBe(6); // floor(20 / 3)
        expect(day.audioDetections).toBe(20);

        if (i < 14) {
          expect(day.dailyImagePath).not.toBeNull();
          expect(fs.existsSync(day.dailyImagePath!)).toBe(true);
          expect(storage.getDailyImage(day.date)).toMatchObject({
            date: day.date,
            local_path: day.dailyImagePath,
          });
        } else {
          expect(day.dailyImagePath).toBeNull();
          expect(storage.getDailyImage(day.date)).toBeNull();
        }
      }

      const clipCount = (db.prepare('SELECT COUNT(*) as c FROM clips').get() as { c: number }).c;
      const birdIdCount = (db.prepare('SELECT COUNT(*) as c FROM identifications WHERE is_bird = 1').get() as { c: number }).c;
      const nonBirdIdCount = (db.prepare('SELECT COUNT(*) as c FROM identifications WHERE is_bird = 0').get() as { c: number }).c;
      const audioIdCount = (db.prepare('SELECT COUNT(*) as c FROM audio_identifications').get() as { c: number }).c;
      const speciesImgCount = (db.prepare('SELECT COUNT(*) as c FROM species_images').get() as { c: number }).c;

      expect(clipCount).toBe(result.totalClips);
      expect(birdIdCount).toBe(result.totalBirdClips);
      expect(nonBirdIdCount).toBe(result.totalNonBirdClips);
      expect(audioIdCount).toBe(result.totalAudioDetections);
      // bluejay and goldfinch have matching bird images; crow does not
      expect(speciesImgCount).toBe(2);
      expect(fs.existsSync(path.join(downloadDir, 'species', 'cyanocitta_cristata.jpg'))).toBe(true);
      expect(fs.existsSync(path.join(downloadDir, 'species', 'spinus_tristis.jpg'))).toBe(true);

      const sampleClip = db.prepare('SELECT local_thumbnail_path FROM clips LIMIT 1').get() as { local_thumbnail_path: string };
      expect(fs.existsSync(sampleClip.local_thumbnail_path)).toBe(true);

      const sampleAudio = db.prepare('SELECT local_audio_path FROM audio_identifications LIMIT 1').get() as { local_audio_path: string };
      expect(fs.existsSync(sampleAudio.local_audio_path)).toBe(true);
    } finally {
      db.close();
    }
  });

  it('validates days and count ranges and required media files', () => {
    const { imageDir, audioDir } = setupMediaDirs();
    const emptyDir = tempDir();
    vi.stubEnv('DATA_DIR', path.join(tempDir(), 'data'));
    const storage = new Storage();
    try {
      expect(() => seedDb(storage, { imageDir, audioDir, downloadDir: tempDir(), days: 0 }))
        .toThrow(/Invalid days/);
      expect(() => seedDb(storage, { imageDir, audioDir, downloadDir: tempDir(), minCount: 20, maxCount: 10 }))
        .toThrow(/Invalid count range/);
      expect(() => seedDb(storage, { imageDir: emptyDir, audioDir, downloadDir: tempDir() }))
        .toThrow(/No bird images/);
      expect(() => seedDb(storage, { imageDir, audioDir: emptyDir, downloadDir: tempDir() }))
        .toThrow(/No audio files/);
    } finally {
      (storage.provider as SQLiteStorage).db.close();
    }
  });
});

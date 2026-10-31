/**
 * Local-testing helper: seeds a SQLite database and downloads directory with
 * multiple days of realistic video clips, BirdNET-Go audio detections, species
 * images, and daily images drawn from ../test-birds/, for offline development
 * and UI testing without the camera, BirdNET-Go, or Gemini API calls.
 */

import * as fs from 'fs';
import * as path from 'path';
import { mergeSpecies } from './daily-image.ts';
import {
  isNonBirdImage,
  listImages,
  nonBirdCount,
  pickRandom,
  reolinkTimestamp,
} from './seed-local-uploads.ts';
import type { Storage } from './storage.ts';
import type { BirdIdentification } from './types.ts';

const AUDIO_EXTENSIONS = new Set(['wav']);

const DAY_MS = 24 * 60 * 60 * 1000;
const CLIP_SPACING_MS = 8 * 60 * 1000;
const AUDIO_SPACING_MS = 10 * 60 * 1000;

const GENDERS = ['male', 'female', 'unknown'] as const;

const IMAGE_SPECIES_MAP: Record<string, string> = {
  bluejay: 'blue jay',
  cardinal: 'northern cardinal',
  chickadee: 'black-capped chickadee',
  downywoodpecker: 'downy woodpecker',
  finch: 'house finch',
  goldfinch: 'american goldfinch',
  mourningdove: 'mourning dove',
  sparrow: 'house sparrow',
  canadagoose: 'canada goose',
  crow: 'american crow',
};

export interface AudioSpeciesInfo {
  species: string;
  scientificName: string;
  speciesCode: string;
}

const AUDIO_SPECIES_MAP: Record<string, AudioSpeciesInfo> = {
  bluejay: { species: 'Blue Jay', scientificName: 'Cyanocitta cristata', speciesCode: 'blujay' },
  canadagoose: { species: 'Canada Goose', scientificName: 'Branta canadensis', speciesCode: 'cangoo' },
  crow: { species: 'American Crow', scientificName: 'Corvus brachyrhynchos', speciesCode: 'amecro' },
  goldfinch: { species: 'American Goldfinch', scientificName: 'Spinus tristis', speciesCode: 'amegfi' },
  sparrow: { species: 'House Sparrow', scientificName: 'Passer domesticus', speciesCode: 'houspa' },
  cardinal: { species: 'Northern Cardinal', scientificName: 'Cardinalis cardinalis', speciesCode: 'norcar' },
  chickadee: { species: 'Black-capped Chickadee', scientificName: 'Poecile atricapillus', speciesCode: 'bkcchi' },
  downywoodpecker: { species: 'Downy Woodpecker', scientificName: 'Dryobates pubescens', speciesCode: 'dowwoo' },
  finch: { species: 'House Finch', scientificName: 'Haemorhous mexicanus', speciesCode: 'houfin' },
  mourningdove: { species: 'Mourning Dove', scientificName: 'Zenaida macroura', speciesCode: 'moudov' },
};

export interface SeedLocalDbOptions {
  imageDir: string;
  audioDir: string;
  dailyImageDir: string;
  downloadDir: string;
  days?: number;
  minCount?: number;
  maxCount?: number;
  cameraName?: string;
  now?: Date;
  random?: () => number;
}

export interface SeedLocalDbDaySummary {
  date: string;
  birdClips: number;
  nonBirdClips: number;
  audioDetections: number;
  dailyImagePath: string | null;
}

export interface SeedLocalDbResult {
  days: SeedLocalDbDaySummary[];
  totalClips: number;
  totalBirdClips: number;
  totalNonBirdClips: number;
  totalAudioDetections: number;
  totalDailyImages: number;
}

/**
 * List WAV audio files directly inside audioDir, sorted by name.
 */
export function listAudio(audioDir: string): string[] {
  return fs.readdirSync(audioDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).slice(1).toLowerCase()))
    .map(entry => path.join(audioDir, entry.name))
    .sort();
}

/**
 * Normalize a media filename to a lowercase key with trailing digits stripped
 * (e.g. "bluejay2.jpg" → "bluejay").
 */
export function fileStem(filePath: string): string {
  return path.basename(filePath, path.extname(filePath)).replace(/\d+$/, '').toLowerCase();
}

/**
 * Random integer in [min, max] inclusive.
 */
export function randomInt(min: number, max: number, random: () => number = Math.random): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

function randomConfidence(min: number, max: number, random: () => number): number {
  return Number((min + random() * (max - min)).toFixed(2));
}

function toTitleCase(name: string): string {
  return name.replace(/(^|\s)(\S)/g, (_, space: string, ch: string) => space + ch.toUpperCase());
}

function slugifyScientificName(scientificName: string): string {
  return scientificName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Build a BirdIdentification payload from a test-birds image filename.
 */
export function imageToIdentification(imagePath: string, random: () => number = Math.random): BirdIdentification {
  if (isNonBirdImage(imagePath)) {
    return {
      is_bird: false,
      non_bird_species: 'squirrel',
      confidence: randomConfidence(0.80, 0.98, random),
    };
  }
  const stem = fileStem(imagePath);
  const species = IMAGE_SPECIES_MAP[stem] ?? stem.replace(/[_-]+/g, ' ');
  const gender = GENDERS[Math.floor(random() * GENDERS.length)];
  return {
    is_bird: true,
    species,
    gender,
    count: 1,
    confidence: randomConfidence(0.80, 0.99, random),
  };
}

/**
 * Resolve common name, scientific name, and species code from a test-birds audio filename.
 */
export function audioToSpeciesInfo(audioPath: string): AudioSpeciesInfo {
  const stem = fileStem(audioPath);
  if (AUDIO_SPECIES_MAP[stem]) return AUDIO_SPECIES_MAP[stem];
  const readable = toTitleCase(stem.replace(/[_-]+/g, ' '));
  return {
    species: readable,
    scientificName: `${readable} sp.`,
    speciesCode: stem.slice(0, 6) || 'unkbrd',
  };
}

/**
 * Seed storage and downloadDir with `days` recent days of video clips,
 * BirdNET-Go audio detections, species images, and daily images (leaving the
 * most recent day's daily image unset so it appears as PENDING).
 */
export function seedLocalDb(
  storage: Storage,
  {
    imageDir,
    audioDir,
    dailyImageDir,
    downloadDir,
    days = 15,
    minCount = 10,
    maxCount = 30,
    cameraName = 'Bird',
    now = new Date(),
    random = Math.random,
  }: SeedLocalDbOptions,
): SeedLocalDbResult {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error(`Invalid days "${days}": expected a positive integer`);
  }
  if (!Number.isInteger(minCount) || !Number.isInteger(maxCount) || minCount < 1 || maxCount < minCount) {
    throw new Error(`Invalid count range [${minCount}, ${maxCount}]`);
  }

  const images = listImages(imageDir);
  const birdImages = images.filter(img => !isNonBirdImage(img));
  const nonBirdImages = images.filter(isNonBirdImage);
  if (!birdImages.length) throw new Error(`No bird images found in ${imageDir}`);

  const audioFiles = listAudio(audioDir);
  if (!audioFiles.length) throw new Error(`No audio files found in ${audioDir}`);

  const dailyImages = listImages(dailyImageDir);
  if (!dailyImages.length) throw new Error(`No daily images found in ${dailyImageDir}`);
  const dailyPicks = pickRandom(dailyImages, days - 1, random);

  const birdImageByStem = new Map<string, string>();
  for (const img of birdImages) {
    const stem = fileStem(img);
    if (!birdImageByStem.has(stem)) birdImageByStem.set(stem, img);
  }

  const model = storage.getSettingWithId('ai_model');
  const prompt = storage.getSettingWithId('ai_prompt');
  const imageModel = storage.getSettingWithId('ai_image_model');
  const imagePrompt = storage.getSettingWithId('ai_image_prompt');

  const daySummaries: SeedLocalDbDaySummary[] = [];
  let totalClips = 0;
  let totalBirdClips = 0;
  let totalNonBirdClips = 0;
  let totalAudioDetections = 0;
  let totalDailyImages = 0;
  let nextDetectionId = 1000;

  for (let i = 0; i < days; i++) {
    const daysAgo = days - i;
    // Anchor at 14:00 UTC (08:00 CST / 09:00 CDT in America/Chicago) so all
    // spaced clips and detections stay within the same Chicago and UTC date.
    const dayStart = new Date(now.getTime() - daysAgo * DAY_MS);
    dayStart.setUTCHours(14, 0, 0, 0);

    const dateStr = dayStart.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const [yearStr, monthStr, dayStr] = dateStr.split('-');
    const dayDir = path.join(downloadDir, yearStr, String(Number(monthStr)), String(Number(dayStr)));
    fs.mkdirSync(dayDir, { recursive: true });

    const birdClipCount = randomInt(minCount, maxCount, random);
    const nonBirdClipCount = nonBirdImages.length ? nonBirdCount(birdClipCount) : 0;

    const birdPicks = pickRandom(birdImages, birdClipCount, random).map(imagePath => ({ imagePath, isBird: true }));
    const picks = [...birdPicks];
    if (nonBirdClipCount > 0) {
      picks.push(...pickRandom(nonBirdImages, nonBirdClipCount, random).map(imagePath => ({ imagePath, isBird: false })));
    }
    const shuffledClips = pickRandom(picks, picks.length, random);

    const dayVideoSpecies: string[] = [];
    for (let j = 0; j < shuffledClips.length; j++) {
      const { imagePath } = shuffledClips[j];
      const clipTime = new Date(dayStart.getTime() + j * CLIP_SPACING_MS);
      const id = Math.floor(clipTime.getTime() / 1000);
      const thumbnailPath = path.join(dayDir, `${id}.jpg`);
      fs.copyFileSync(imagePath, thumbnailPath);

      const identification = imageToIdentification(imagePath, random);
      if (identification.is_bird && identification.species) {
        dayVideoSpecies.push(identification.species);
      }

      storage.addClip({
        id,
        created_at: clipTime.toISOString(),
        updated_at: clipTime.toISOString(),
        device_name: cameraName,
        network_name: 'Reolink FTP',
        type: 'recording',
        source: 'ftp',
        thumbnail: 'ftp-frame',
        media: `${cameraName}_00_${reolinkTimestamp(clipTime)}.mp4`,
        time_zone: 'America/Chicago',
        localThumbnailPath: thumbnailPath,
        birdIdentification: {
          ...identification,
          ai_model_id: model?.id,
          ai_prompt_id: prompt?.id,
        },
      });
    }

    const audioCount = randomInt(minCount, maxCount, random);
    const audioPicks = pickRandom(audioFiles, audioCount, random);
    const dayAudioSpecies: string[] = [];

    for (let k = 0; k < audioPicks.length; k++) {
      const sourceAudioPath = audioPicks[k];
      const detectionId = nextDetectionId++;
      const detectedAt = new Date(dayStart.getTime() + k * AUDIO_SPACING_MS + 30_000);
      const localAudioPath = path.join(dayDir, `audio-${detectionId}.wav`);
      fs.copyFileSync(sourceAudioPath, localAudioPath);

      const info = audioToSpeciesInfo(sourceAudioPath);
      dayAudioSpecies.push(info.species);

      let speciesImageId: number | null = null;
      const existingSpeciesImage = storage.getSpeciesImage(info.scientificName);
      if (existingSpeciesImage) {
        speciesImageId = existingSpeciesImage.id;
      } else {
        const matchingImage = birdImageByStem.get(fileStem(sourceAudioPath));
        if (matchingImage) {
          const slug = slugifyScientificName(info.scientificName);
          const speciesDir = path.join(downloadDir, 'species');
          fs.mkdirSync(speciesDir, { recursive: true });
          const speciesImagePath = path.join(speciesDir, `${slug}.jpg`);
          fs.copyFileSync(matchingImage, speciesImagePath);
          speciesImageId = storage.addSpeciesImage({
            scientific_name: info.scientificName,
            common_name: info.species,
            local_path: speciesImagePath,
          });
        }
      }

      storage.addAudioIdentification({
        birdnet_detection_id: detectionId,
        species: info.species,
        scientific_name: info.scientificName,
        species_code: info.speciesCode,
        confidence: randomConfidence(0.75, 0.99, random),
        verified: 'unverified',
        source: 'Seed BirdNET-Go',
        detected_at: detectedAt.toISOString(),
        begin_time: detectedAt.toISOString(),
        end_time: new Date(detectedAt.getTime() + 3000).toISOString(),
        local_audio_path: localAudioPath,
        species_image_id: speciesImageId,
      });
    }

    let dailyImagePath: string | null = null;
    const isMostRecentDay = i === days - 1;
    if (!isMostRecentDay) {
      const species = mergeSpecies({ video: dayVideoSpecies, audio: dayAudioSpecies });
      dailyImagePath = path.join(dayDir, `daily-${dateStr}.jpg`);
      fs.copyFileSync(dailyPicks[i], dailyImagePath);
      storage.addDailyImage({
        date: dateStr,
        species,
        local_path: dailyImagePath,
        ai_model_id: imageModel?.id,
        ai_prompt_id: imagePrompt?.id,
      });
      totalDailyImages++;
    }

    daySummaries.push({
      date: dateStr,
      birdClips: birdClipCount,
      nonBirdClips: nonBirdClipCount,
      audioDetections: audioCount,
      dailyImagePath,
    });
    totalClips += shuffledClips.length;
    totalBirdClips += birdClipCount;
    totalNonBirdClips += nonBirdClipCount;
    totalAudioDetections += audioCount;
  }

  return {
    days: daySummaries,
    totalClips,
    totalBirdClips,
    totalNonBirdClips,
    totalAudioDetections,
    totalDailyImages,
  };
}

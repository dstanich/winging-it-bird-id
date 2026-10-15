/**
 * BirdNET-Go audio identification - polls a local BirdNET-Go instance's REST
 * API for new audio detections, keeps the ones above a confidence threshold,
 * and downloads each detection's audio clip plus a per-species clipart image
 * (fetched once per species and reused across detections).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Storage } from './storage.ts';

/** A detection as returned by BirdNET-Go's /api/v2/detections (only the fields used here). */
export interface BirdNetDetection {
  id: number;
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** ISO 8601 with a UTC offset. */
  timestamp: string;
  commonName: string;
  scientificName: string;
  speciesCode?: string;
  confidence: number;
  verified?: string;
  source?: { id?: string; displayName?: string };
  beginTime?: string;
  endTime?: string;
}

interface DetectionsPage {
  data: BirdNetDetection[];
  total_pages?: number;
}

export interface BirdNetOptions {
  /** BirdNET-Go base URL, e.g. http://192.168.1.225:8080 */
  baseUrl: string;
  /** Minimum confidence (0-1) required to persist a detection. */
  minConfidence: number;
  /** How far back to look on first sync / to catch missed detections. */
  lookbackHours: number;
  /** Location to store species images and audio clips. */
  downloadDir: string;
}

const PAGE_SIZE = 100;

function slugifyScientificName(scientificName: string): string {
  return scientificName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export class BirdNetProvider {
  storage: Storage;
  baseUrl: string;
  minConfidence: number;
  lookbackHours: number;
  downloadDir: string;

  constructor(storage: Storage, { baseUrl, minConfidence, lookbackHours, downloadDir }: BirdNetOptions) {
    this.storage = storage;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.minConfidence = minConfidence;
    this.lookbackHours = lookbackHours;
    this.downloadDir = downloadDir;
  }

  async _fetchJson<T>(urlPath: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${urlPath}`);
    if (!response.ok) {
      throw new Error(`BirdNET-Go request failed: ${urlPath} (${response.status})`);
    }
    return response.json() as Promise<T>;
  }

  async _downloadFile(urlPath: string, destPath: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}${urlPath}`);
    if (!response.ok) {
      throw new Error(`BirdNET-Go download failed: ${urlPath} (${response.status})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, buffer);
  }

  /**
   * Ensures a species clipart image exists locally for the given scientific name,
   * downloading and caching it in storage the first time it's seen.
   * @returns The species_images row ID.
   */
  async _ensureSpeciesImage(scientificName: string, commonName: string): Promise<number> {
    const existing = this.storage.getSpeciesImage(scientificName);
    if (existing) return existing.id;

    const slug = slugifyScientificName(scientificName);
    const localPath = path.join(this.downloadDir, 'species', `${slug}.jpg`);
    await this._downloadFile(`/api/v2/media/species-image?name=${encodeURIComponent(scientificName)}`, localPath);

    return this.storage.addSpeciesImage({
      scientific_name: scientificName,
      common_name: commonName,
      local_path: localPath,
    });
  }

  async _downloadAudioClip(detection: BirdNetDetection): Promise<string> {
    const [year, month, day] = detection.date.split('-');
    const clipDir = path.join(this.downloadDir, year, String(Number(month)), String(Number(day)));
    const destPath = path.join(clipDir, `audio-${detection.id}.wav`);
    await this._downloadFile(`/api/v2/audio/${detection.id}`, destPath);
    return destPath;
  }

  /**
   * Fetches new BirdNET-Go detections since the last sync, persists the ones
   * meeting the confidence threshold, and downloads their audio + species clipart.
   * @returns Number of detections persisted.
   */
  async syncDetections(): Promise<number> {
    const lastId = this.storage.getLatestAudioDetectionId();
    const cutoffMs = Date.now() - this.lookbackHours * 60 * 60 * 1000;

    const newDetections: BirdNetDetection[] = [];
    let offset = 0;
    let totalPages = 1;

    do {
      const page = await this._fetchJson<DetectionsPage>(`/api/v2/detections?limit=${PAGE_SIZE}&offset=${offset}`);
      totalPages = page.total_pages ?? 1;

      for (const detection of page.data) {
        if (detection.id <= lastId) {
          totalPages = 0; // seen everything newer than our cursor; stop paging
          break;
        }
        if (new Date(detection.timestamp).getTime() < cutoffMs) {
          totalPages = 0; // outside the lookback window; stop paging
          break;
        }
        newDetections.push(detection);
      }

      offset += PAGE_SIZE;
    } while (offset < totalPages * PAGE_SIZE);

    let persisted = 0;
    for (const detection of newDetections) {
      if (detection.confidence < this.minConfidence) continue;

      try {
        const localAudioPath = await this._downloadAudioClip(detection);
        const speciesImageId = await this._ensureSpeciesImage(detection.scientificName, detection.commonName);

        this.storage.addAudioIdentification({
          birdnet_detection_id: detection.id,
          species: detection.commonName,
          scientific_name: detection.scientificName,
          species_code: detection.speciesCode,
          confidence: detection.confidence,
          verified: detection.verified,
          source: detection.source?.displayName || detection.source?.id,
          detected_at: detection.timestamp,
          begin_time: detection.beginTime,
          end_time: detection.endTime,
          local_audio_path: localAudioPath,
          species_image_id: speciesImageId,
        });
        persisted++;
      } catch (error) {
        console.error(`Error syncing BirdNET-Go detection ${detection.id}:`, error);
      }
    }

    if (persisted > 0) {
      console.log(`✓ Synced ${persisted} new BirdNET-Go audio detection(s)`);
    }

    return persisted;
  }
}

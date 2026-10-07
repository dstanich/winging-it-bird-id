/**
 * Shared test helpers.
 */
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach } from "vitest";

/**
 * Creates a temp directory per call and registers an afterEach hook that
 * removes every directory it created. Call at the top level of a test file.
 */
export function createTempDirFactory(): () => string {
  const created: string[] = [];
  afterEach(() => {
    for (const dir of created.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  return () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "winging-it-client-test-"));
    created.push(dir);
    return dir;
  };
}

// Mirrors the tables/columns created by server/lib/sqlite-storage.js _createSchema().
const SCHEMA = `
  CREATE TABLE clips (
    id INTEGER PRIMARY KEY,
    created_at TEXT,
    updated_at TEXT,
    device_name TEXT,
    network_name TEXT,
    type TEXT,
    source TEXT,
    thumbnail TEXT,
    media TEXT,
    time_zone TEXT,
    local_thumbnail_path TEXT
  );
  CREATE TABLE settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    value TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT 0
  );
  CREATE TABLE identifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clip_id INTEGER NOT NULL REFERENCES clips(id),
    is_bird BOOLEAN NOT NULL,
    species TEXT,
    gender TEXT,
    count INTEGER,
    confidence REAL,
    non_bird_species TEXT,
    ai_model_id INTEGER REFERENCES settings(id),
    ai_prompt_id INTEGER REFERENCES settings(id)
  );
  CREATE TABLE species_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scientific_name TEXT NOT NULL UNIQUE,
    common_name TEXT,
    local_path TEXT NOT NULL,
    created_at TEXT
  );
  CREATE TABLE audio_identifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    birdnet_detection_id INTEGER NOT NULL UNIQUE,
    species TEXT,
    scientific_name TEXT,
    species_code TEXT,
    confidence REAL,
    verified TEXT,
    source TEXT,
    detected_at TEXT,
    begin_time TEXT,
    end_time TEXT,
    local_audio_path TEXT,
    species_image_id INTEGER REFERENCES species_images(id),
    created_at TEXT
  );
`;

export interface ClipInput {
  id: number;
  createdAt: string;
  thumbnailPath?: string;
}

export interface IdentificationInput {
  clipId: number;
  isBird: boolean;
  species?: string | null;
  gender?: string | null;
  count?: number | null;
  confidence?: number | null;
  nonBirdSpecies?: string | null;
  aiModelId?: number | null;
  aiPromptId?: number | null;
}

export interface AudioInput {
  birdnetDetectionId: number;
  detectedAt: string;
  species?: string | null;
  scientificName?: string | null;
  confidence?: number | null;
  audioPath?: string | null;
  speciesImageId?: number | null;
}

/**
 * A writable test database at `<dir>/data/bird-data.db`, the path lib/db.ts
 * opens relative to process.cwd(), with insert helpers that return row IDs.
 */
export function createTestDb(dir: string) {
  fs.mkdirSync(path.join(dir, "data"), { recursive: true });
  const db = new Database(path.join(dir, "data", "bird-data.db"));
  db.exec(SCHEMA);

  return {
    db,
    addSetting(name: string, value: string, isActive: boolean): number {
      return Number(
        db
          .prepare("INSERT INTO settings (name, value, is_active) VALUES (?, ?, ?)")
          .run(name, value, isActive ? 1 : 0).lastInsertRowid
      );
    },
    addClip({ id, createdAt, thumbnailPath }: ClipInput): number {
      db.prepare(
        `INSERT INTO clips (id, created_at, updated_at, device_name, network_name, type, source, media, time_zone, local_thumbnail_path)
         VALUES (?, ?, ?, 'Camera', 'Reolink FTP', 'recording', 'ftp', 'clip.mp4', 'America/Chicago', ?)`
      ).run(id, createdAt, createdAt, thumbnailPath ?? `downloads/thumb-${id}.jpg`);
      return id;
    },
    addIdentification(ident: IdentificationInput): number {
      return Number(
        db
          .prepare(
            `INSERT INTO identifications (clip_id, is_bird, species, gender, count, confidence, non_bird_species, ai_model_id, ai_prompt_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            ident.clipId,
            ident.isBird ? 1 : 0,
            ident.species ?? null,
            ident.gender ?? null,
            ident.count ?? null,
            ident.confidence ?? null,
            ident.nonBirdSpecies ?? null,
            ident.aiModelId ?? null,
            ident.aiPromptId ?? null
          ).lastInsertRowid
      );
    },
    addSpeciesImage(scientificName: string, localPath: string): number {
      return Number(
        db
          .prepare("INSERT INTO species_images (scientific_name, local_path) VALUES (?, ?)")
          .run(scientificName, localPath).lastInsertRowid
      );
    },
    addAudio(audio: AudioInput): number {
      return Number(
        db
          .prepare(
            `INSERT INTO audio_identifications
               (birdnet_detection_id, species, scientific_name, confidence, detected_at, local_audio_path, species_image_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            audio.birdnetDetectionId,
            audio.species ?? null,
            audio.scientificName ?? null,
            audio.confidence ?? null,
            audio.detectedAt,
            audio.audioPath ?? null,
            audio.speciesImageId ?? null
          ).lastInsertRowid
      );
    },
  };
}

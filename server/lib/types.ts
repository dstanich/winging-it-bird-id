/**
 * Shared types: the SQLite row shapes and the in-memory objects passed
 * between the processing steps.
 */

/** One species result from the AI, tagged with the settings rows used to produce it. */
export interface BirdIdentification {
  is_bird: boolean;
  species?: string | null;
  gender?: string | null;
  count?: number | null;
  confidence?: number | null;
  non_bird_species?: string | null;
  ai_model_id?: number | null;
  ai_prompt_id?: number | null;
}

/** A clip discovered in the upload directory, before and after AI identification. */
export interface Clip {
  /** Recording time in Unix seconds; also the dedupe key. */
  id: number;
  created_at?: string | null;
  updated_at?: string | null;
  device_name?: string | null;
  network_name?: string | null;
  type?: string | null;
  source?: string | null;
  thumbnail?: string | null;
  /** Original upload filename. */
  media?: string | null;
  time_zone?: string | null;
  localThumbnailPath?: string | null;
  localVideoPath?: string | null;
  /** Set by processClips(); a single object is stored as a one-element array. */
  birdIdentification?: BirdIdentification | BirdIdentification[] | null;
}

/** A clip returned by discoverNewClips(): its thumbnail has been extracted and its upload is on disk. */
export interface DiscoveredClip extends Clip {
  localThumbnailPath: string;
  localVideoPath: string;
}

export interface SettingRow {
  id: number;
  name: string;
  value: string;
  /** SQLite boolean: 0 or 1. */
  is_active: number;
}

export interface SettingWithId {
  id: number;
  value: string;
}

/** Fields accepted by addAudioIdentification(); everything but the detection ID is optional. */
export interface AudioIdentificationInput {
  birdnet_detection_id: number;
  species?: string | null;
  scientific_name?: string | null;
  species_code?: string | null;
  confidence?: number | null;
  verified?: string | null;
  source?: string | null;
  detected_at?: string | null;
  begin_time?: string | null;
  end_time?: string | null;
  local_audio_path?: string | null;
  species_image_id?: number | null;
  created_at?: string | null;
}

export interface SpeciesImageRow {
  id: number;
  scientific_name: string;
  common_name: string | null;
  local_path: string;
  created_at: string | null;
}

export interface SpeciesImageInput {
  scientific_name: string;
  common_name?: string | null;
  local_path: string;
}

export interface DailyImageRow {
  id: number;
  date: string;
  /** JSON array of the title-cased species drawn. */
  species: string;
  local_path: string | null;
  ai_model_id: number | null;
  ai_prompt_id: number | null;
  created_at: string | null;
}

export interface DailyImageInput {
  date: string;
  species: string[];
  local_path?: string | null;
  ai_model_id?: number | null;
  ai_prompt_id?: number | null;
}

export interface SettingUpdates {
  value?: string;
  isActive?: number | boolean;
}

export interface BirdSpecies {
  video: string[];
  audio: string[];
}

/**
 * Operations every storage provider implements. The Storage facade delegates
 * each one to its provider, so a method added here must be added to both.
 */
export interface StorageProvider {
  addClip(clip: Clip): void;
  commit(): void;
  data(since?: string | Date | null): Record<number, boolean>;
  getSetting(name: string): string | null;
  getSettingWithId(name: string): SettingWithId | null;
  getSettings(name: string): SettingRow[];
  setSetting(name: string, value: string, isActive?: number | boolean): unknown;
  updateSetting(id: number, updates?: SettingUpdates): void;
  deleteSetting(id: number): void;
  getMostRecentClipTimestamp(): string | null;
  pruneClipsBefore(cutoffIso: string): { clipsDeleted: number; identificationsDeleted: number };
  getLatestAudioDetectionId(): number;
  addAudioIdentification(record: AudioIdentificationInput): unknown;
  getSpeciesImage(scientificName: string): SpeciesImageRow | null;
  addSpeciesImage(image: SpeciesImageInput): number;
  pruneAudioIdentificationsBefore(cutoffIso: string): { audioIdentificationsDeleted: number };
  getBirdSpeciesBetween(startIso: string, endIso: string): BirdSpecies;
  getDailyImage(date: string): DailyImageRow | null;
  addDailyImage(image: DailyImageInput): number;
  pruneDailyImagesBefore(cutoffDate: string): { dailyImagesDeleted: number };
}

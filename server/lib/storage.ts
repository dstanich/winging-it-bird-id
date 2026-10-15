import { SQLiteStorage } from './sqlite-storage.ts';
import type {
    AudioIdentificationInput,
    BirdSpecies,
    Clip,
    DailyImageInput,
    DailyImageRow,
    SettingRow,
    SettingUpdates,
    SettingWithId,
    SpeciesImageInput,
    SpeciesImageRow,
    StorageProvider,
} from './types.ts';

/**
 * Interface for clip storage that delegates to a swappable storage provider.
 */
export class Storage implements StorageProvider {
    provider: StorageProvider;

    /** Creates a new Storage instance with the default storage provider. */
    constructor() {
        this.provider = new SQLiteStorage();
    }

    /**
     * Persists a clip and its bird identification(s) to storage.
     * @param clip - The clip object containing metadata and optional birdIdentification.
     */
    addClip(clip: Clip): void {
        return this.provider.addClip(clip);
    }

    /**
     * Flushes any pending writes to the backing store.
     * May be a no-op depending on the provider.
     */
    commit(): void {
        return this.provider.commit();
    }

    /**
     * Returns a map of processed clip IDs.
     * @param since - If provided, only return clips with created_at >= this value.
     * @returns An object keyed by clip ID, with `true` for each processed clip.
     */
    data(since: string | Date | null = null): Record<number, boolean> {
        return this.provider.data(since);
    }

    /**
     * Retrieves the value of an active setting by name.
     * @param name - The setting name to look up.
     * @returns The setting value, or null if not found or inactive.
     */
    getSetting(name: string): string | null {
        return this.provider.getSetting(name);
    }

    /**
     * Retrieves the value and ID of an active setting by name.
     * @param name - The setting name to look up.
     * @returns The setting row, or null if not found.
     */
    getSettingWithId(name: string): SettingWithId | null {
        return this.provider.getSettingWithId(name);
    }

    /**
     * Retrieves all settings (active and inactive) matching the given name.
     * @param name - The setting name to look up.
     * @returns Array of setting rows including id, name, value, and is_active.
     */
    getSettings(name: string): SettingRow[] {
        return this.provider.getSettings(name);
    }

    /**
     * Creates a new setting.
     * @param name - The setting name.
     * @param value - The setting value.
     * @param isActive - Whether the setting is active (truthy = active).
     * @returns The result of the insert operation.
     */
    setSetting(name: string, value: string, isActive: number | boolean = 0): unknown {
        return this.provider.setSetting(name, value, isActive);
    }

    /**
     * Updates an existing setting by ID.
     * @param id - The setting row ID.
     * @param updates - Fields to update: `value` and/or `isActive` (truthy = active).
     */
    updateSetting(id: number, updates?: SettingUpdates): void {
        return this.provider.updateSetting(id, updates);
    }

    /**
     * Deletes a setting by ID.
     * @param id - The setting row ID to delete.
     */
    deleteSetting(id: number): void {
        return this.provider.deleteSetting(id);
    }

    /**
     * Returns the created_at timestamp of the most recently created clip, or null if none exist.
     */
    getMostRecentClipTimestamp(): string | null {
        return this.provider.getMostRecentClipTimestamp();
    }

    /**
     * Deletes clips (and their identifications) with created_at strictly before the cutoff.
     * @param cutoffIso - ISO 8601 timestamp; rows with created_at < cutoff are removed.
     */
    pruneClipsBefore(cutoffIso: string): { clipsDeleted: number; identificationsDeleted: number } {
        return this.provider.pruneClipsBefore(cutoffIso);
    }

    /**
     * Returns the highest BirdNET-Go detection ID already synced, or 0 if none.
     */
    getLatestAudioDetectionId(): number {
        return this.provider.getLatestAudioDetectionId();
    }

    /**
     * Persists a BirdNET-Go audio detection. No-ops if the detection was already synced.
     * @param record - Audio identification fields.
     */
    addAudioIdentification(record: AudioIdentificationInput): unknown {
        return this.provider.addAudioIdentification(record);
    }

    /**
     * Looks up a cached species clipart image by scientific name.
     * @returns The species_images row, or null if not cached yet.
     */
    getSpeciesImage(scientificName: string): SpeciesImageRow | null {
        return this.provider.getSpeciesImage(scientificName);
    }

    /**
     * Caches a species clipart image record.
     * @returns The new species_images row ID.
     */
    addSpeciesImage(image: SpeciesImageInput): number {
        return this.provider.addSpeciesImage(image);
    }

    /**
     * Deletes audio identifications with detected_at strictly before the cutoff.
     * @param cutoffIso - ISO 8601 timestamp.
     */
    pruneAudioIdentificationsBefore(cutoffIso: string): { audioIdentificationsDeleted: number } {
        return this.provider.pruneAudioIdentificationsBefore(cutoffIso);
    }

    /**
     * Returns the distinct bird species identified between two instants, from
     * video identifications (is_bird only) and BirdNET-Go audio detections.
     * Species names are returned as stored (video lowercase, audio mixed case);
     * unknown/unidentified placeholders are not filtered out.
     * @param startIso - ISO 8601 start instant (inclusive).
     * @param endIso - ISO 8601 end instant (exclusive).
     */
    getBirdSpeciesBetween(startIso: string, endIso: string): BirdSpecies {
        return this.provider.getBirdSpeciesBetween(startIso, endIso);
    }

    /**
     * Looks up the AI-generated daily image row for a local date.
     * @param date - Local date as YYYY-MM-DD.
     * @returns The daily_images row (species is a JSON string), or null if none yet.
     */
    getDailyImage(date: string): DailyImageRow | null {
        return this.provider.getDailyImage(date);
    }

    /**
     * Records a daily image. A null local_path marks a completed day with no known bird species.
     * @returns The new daily_images row ID.
     */
    addDailyImage(image: DailyImageInput): number {
        return this.provider.addDailyImage(image);
    }

    /**
     * Deletes daily image rows for dates strictly before the cutoff date.
     * @param cutoffDate - Local date as YYYY-MM-DD.
     */
    pruneDailyImagesBefore(cutoffDate: string): { dailyImagesDeleted: number } {
        return this.provider.pruneDailyImagesBefore(cutoffDate);
    }
}

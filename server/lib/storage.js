import { SQLiteStorage } from './sqlite-storage.js';

/**
 * Interface for clip storage that delegates to a swappable storage provider.
 */
export class Storage {
    /** Creates a new Storage instance with the default storage provider. */
    constructor() {
        this.provider = new SQLiteStorage();
    }

    /**
     * Persists a clip and its bird identification(s) to storage.
     * @param {Object} clip - The clip object containing metadata and optional birdIdentification.
     */
    addClip(clip) {
        return this.provider.addClip(clip);
    }

    /**
     * Flushes any pending writes to the backing store.
     * May be a no-op depending on the provider.
     */
    commit() {
        return this.provider.commit();
    }

    /**
     * Returns a map of processed clip IDs.
     * @param {string|Date|null} [since=null] - If provided, only return clips with created_at >= this value.
     * @returns {Object.<number, boolean>} An object keyed by clip ID, with `true` for each processed clip.
     */
    data(since = null) {
        return this.provider.data(since);
    }

    /**
     * Retrieves the value of an active setting by name.
     * @param {string} name - The setting name to look up.
     * @returns {string|null} The setting value, or null if not found or inactive.
     */
    getSetting(name) {
        return this.provider.getSetting(name);
    }

    /**
     * Retrieves the value and ID of an active setting by name.
     * @param {string} name - The setting name to look up.
     * @returns {{ id: number, value: string } | null} The setting row, or null if not found.
     */
    getSettingWithId(name) {
        return this.provider.getSettingWithId(name);
    }

    /**
     * Retrieves all settings (active and inactive) matching the given name.
     * @param {string} name - The setting name to look up.
     * @returns {Object[]} Array of setting rows including id, name, value, and is_active.
     */
    getSettings(name) {
        return this.provider.getSettings(name);
    }

    /**
     * Creates a new setting.
     * @param {string} name - The setting name.
     * @param {string} value - The setting value.
     * @param {number} [isActive=0] - Whether the setting is active (truthy = active).
     * @returns {Object} The result of the insert operation.
     */
    setSetting(name, value, isActive = 0) {
        return this.provider.setSetting(name, value, isActive);
    }

    /**
     * Updates an existing setting by ID.
     * @param {number} id - The setting row ID.
     * @param {Object} updates - Fields to update.
     * @param {string} [updates.value] - New value for the setting.
     * @param {number} [updates.isActive] - New active state (truthy = active).
     */
    updateSetting(id, updates) {
        return this.provider.updateSetting(id, updates);
    }

    /**
     * Deletes a setting by ID.
     * @param {number} id - The setting row ID to delete.
     */
    deleteSetting(id) {
        return this.provider.deleteSetting(id);
    }

    /**
     * Returns the created_at timestamp of the most recently created clip, or null if none exist.
     * @returns {string|null}
     */
    getMostRecentClipTimestamp() {
        return this.provider.getMostRecentClipTimestamp();
    }

    /**
     * Deletes clips (and their identifications) with created_at strictly before the cutoff.
     * @param {string} cutoffIso - ISO 8601 timestamp; rows with created_at < cutoff are removed.
     * @returns {{ clipsDeleted: number, identificationsDeleted: number }}
     */
    pruneClipsBefore(cutoffIso) {
        return this.provider.pruneClipsBefore(cutoffIso);
    }

    /**
     * Returns the highest BirdNET-Go detection ID already synced, or 0 if none.
     * @returns {number}
     */
    getLatestAudioDetectionId() {
        return this.provider.getLatestAudioDetectionId();
    }

    /**
     * Persists a BirdNET-Go audio detection. No-ops if the detection was already synced.
     * @param {Object} record - Audio identification fields (see sqlite-storage.js).
     */
    addAudioIdentification(record) {
        return this.provider.addAudioIdentification(record);
    }

    /**
     * Looks up a cached species clipart image by scientific name.
     * @param {string} scientificName
     * @returns {Object|null} The species_images row, or null if not cached yet.
     */
    getSpeciesImage(scientificName) {
        return this.provider.getSpeciesImage(scientificName);
    }

    /**
     * Caches a species clipart image record.
     * @param {{ scientific_name: string, common_name?: string, local_path: string }} image
     * @returns {number} The new species_images row ID.
     */
    addSpeciesImage(image) {
        return this.provider.addSpeciesImage(image);
    }

    /**
     * Deletes audio identifications with detected_at strictly before the cutoff.
     * @param {string} cutoffIso - ISO 8601 timestamp.
     * @returns {{ audioIdentificationsDeleted: number }}
     */
    pruneAudioIdentificationsBefore(cutoffIso) {
        return this.provider.pruneAudioIdentificationsBefore(cutoffIso);
    }

    /**
     * Returns the distinct bird species identified between two instants, from
     * video identifications (is_bird only) and BirdNET-Go audio detections.
     * Species names are returned as stored (video lowercase, audio mixed case);
     * unknown/unidentified placeholders are not filtered out.
     * @param {string} startIso - ISO 8601 start instant (inclusive).
     * @param {string} endIso - ISO 8601 end instant (exclusive).
     * @returns {{ video: string[], audio: string[] }}
     */
    getBirdSpeciesBetween(startIso, endIso) {
        return this.provider.getBirdSpeciesBetween(startIso, endIso);
    }

    /**
     * Looks up the AI-generated daily image row for a local date.
     * @param {string} date - Local date as YYYY-MM-DD.
     * @returns {Object|null} The daily_images row (species is a JSON string), or null if none yet.
     */
    getDailyImage(date) {
        return this.provider.getDailyImage(date);
    }

    /**
     * Records a daily image. A null local_path marks a completed day with no known bird species.
     * @param {{ date: string, species: string[], local_path?: string|null, ai_model_id?: number|null, ai_prompt_id?: number|null }} image
     * @returns {number} The new daily_images row ID.
     */
    addDailyImage(image) {
        return this.provider.addDailyImage(image);
    }

    /**
     * Deletes daily image rows for dates strictly before the cutoff date.
     * @param {string} cutoffDate - Local date as YYYY-MM-DD.
     * @returns {{ dailyImagesDeleted: number }}
     */
    pruneDailyImagesBefore(cutoffDate) {
        return this.provider.pruneDailyImagesBefore(cutoffDate);
    }
}

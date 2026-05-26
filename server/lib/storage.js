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
     * Deletes clips (and their identifications) with created_at strictly before the cutoff.
     * @param {string} cutoffIso - ISO 8601 timestamp; rows with created_at < cutoff are removed.
     * @returns {{ clipsDeleted: number, identificationsDeleted: number }}
     */
    pruneClipsBefore(cutoffIso) {
        return this.provider.pruneClipsBefore(cutoffIso);
    }
}

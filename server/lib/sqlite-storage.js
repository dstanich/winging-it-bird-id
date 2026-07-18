import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { DEFAULT_PROMPT, DEFAULT_MODEL } from './ai-provider.js';

export class SQLiteStorage {
    constructor() {
        this.dataDir = process.env.DATA_DIR || './data';
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
        this.db = new Database(path.join(this.dataDir, 'bird-data.db'));
        this.db.pragma('journal_mode = WAL'); // allow concurrent reads/writes and reduce locking issues
        this.db.pragma('foreign_keys = ON');
        this._createSchema();
    }

    _createSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS clips (
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

            CREATE TABLE IF NOT EXISTS identifications (
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

            CREATE INDEX IF NOT EXISTS idx_identifications_species ON identifications(species);
            CREATE INDEX IF NOT EXISTS idx_clips_created_at ON clips(created_at);

            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                value TEXT NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_settings_name ON settings(name);

            CREATE TABLE IF NOT EXISTS species_images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                scientific_name TEXT NOT NULL UNIQUE,
                common_name TEXT,
                local_path TEXT NOT NULL,
                created_at TEXT
            );

            CREATE TABLE IF NOT EXISTS audio_identifications (
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

            CREATE INDEX IF NOT EXISTS idx_audio_identifications_species ON audio_identifications(scientific_name);
            CREATE INDEX IF NOT EXISTS idx_audio_identifications_detected_at ON audio_identifications(detected_at);
        `);

        this._seedDefaultSettings();
        this._migrateIdentifications();
    }

    _migrateIdentifications() {
        // Migrate from old `model` TEXT column to `ai_model_id` + `ai_prompt_id` foreign keys
        const columns = this.db.pragma('table_info(identifications)');
        const hasModelColumn = columns.some(c => c.name === 'model');
        if (!hasModelColumn) return; // already migrated or fresh DB

        const hasAiModelId = columns.some(c => c.name === 'ai_model_id');
        if (!hasAiModelId) {
            this.db.exec('ALTER TABLE identifications ADD COLUMN ai_model_id INTEGER REFERENCES settings(id)');
        }
        const hasAiPromptId = columns.some(c => c.name === 'ai_prompt_id');
        if (!hasAiPromptId) {
            this.db.exec('ALTER TABLE identifications ADD COLUMN ai_prompt_id INTEGER REFERENCES settings(id)');
        }

        // Backfill ai_model_id from the model text value by matching against settings
        this.db.exec(`
            UPDATE identifications
            SET ai_model_id = (
                SELECT s.id FROM settings s
                WHERE s.name = 'ai_model' AND s.value = identifications.model
                LIMIT 1
            )
            WHERE ai_model_id IS NULL AND model IS NOT NULL
        `);

        // Backfill ai_prompt_id with the active prompt for rows that had a model set
        const activePrompt = this.db.prepare("SELECT id FROM settings WHERE name = 'ai_prompt' AND is_active = 1").get();
        if (activePrompt) {
            this.db.exec(`
                UPDATE identifications
                SET ai_prompt_id = ${activePrompt.id}
                WHERE ai_prompt_id IS NULL AND model IS NOT NULL
            `);
        }

        // Drop the old model column by recreating the table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS identifications_new (
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
            INSERT INTO identifications_new (id, clip_id, is_bird, species, gender, count, confidence, non_bird_species, ai_model_id, ai_prompt_id)
                SELECT id, clip_id, is_bird, species, gender, count, confidence, non_bird_species, ai_model_id, ai_prompt_id FROM identifications;
            DROP TABLE identifications;
            ALTER TABLE identifications_new RENAME TO identifications;
            CREATE INDEX IF NOT EXISTS idx_identifications_species ON identifications(species);
        `);
    }

    _seedDefaultSettings() {
        const defaults = [
            {
                name: 'ai_prompt',
                value: DEFAULT_PROMPT,
            },
            {
                name: 'ai_model',
                value: DEFAULT_MODEL,
            },
        ];

        const insert = this.db.prepare('INSERT INTO settings (name, value, is_active) VALUES (?, ?, 1)');
        for (const { name, value } of defaults) {
            const existing = this.db.prepare('SELECT COUNT(*) as count FROM settings WHERE name = ?').get(name);
            if (existing.count === 0) {
                insert.run(name, value);
            }
        }
    }

    getSetting(name) {
        const row = this.db.prepare('SELECT value FROM settings WHERE name = ? AND is_active = 1').get(name);
        return row ? row.value : null;
    }

    getSettingWithId(name) {
        const row = this.db.prepare('SELECT id, value FROM settings WHERE name = ? AND is_active = 1').get(name);
        return row || null;
    }

    getSettings(name) {
        return this.db.prepare('SELECT * FROM settings WHERE name = ?').all(name);
    }

    setSetting(name, value, isActive = 0) {
        return this.db.prepare('INSERT INTO settings (name, value, is_active) VALUES (?, ?, ?)').run(name, value, isActive ? 1 : 0);
    }

    updateSetting(id, { value, isActive } = {}) {
        const fields = [];
        const params = [];
        if (value !== undefined) { fields.push('value = ?'); params.push(value); }
        if (isActive !== undefined) { fields.push('is_active = ?'); params.push(isActive ? 1 : 0); }
        if (fields.length === 0) return;
        params.push(id);
        this.db.prepare(`UPDATE settings SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    }

    deleteSetting(id) {
        this.db.prepare('DELETE FROM settings WHERE id = ?').run(id);
    }

    addClip(clip) {
        const insertClip = this.db.prepare(`
            INSERT OR REPLACE INTO clips (id, created_at, updated_at, device_name, network_name, type, source, thumbnail, media, time_zone, local_thumbnail_path)
            VALUES (@id, @created_at, @updated_at, @device_name, @network_name, @type, @source, @thumbnail, @media, @time_zone, @local_thumbnail_path)
        `);

        const insertIdentification = this.db.prepare(`
            INSERT INTO identifications (clip_id, is_bird, species, gender, count, confidence, non_bird_species, ai_model_id, ai_prompt_id)
            VALUES (@clip_id, @is_bird, @species, @gender, @count, @confidence, @non_bird_species, @ai_model_id, @ai_prompt_id)
        `);

        const transaction = this.db.transaction((clip) => {
            insertClip.run({
                id: clip.id,
                created_at: clip.created_at || null,
                updated_at: clip.updated_at || null,
                device_name: clip.device_name || null,
                network_name: clip.network_name || null,
                type: clip.type || null,
                source: clip.source || null,
                thumbnail: clip.thumbnail || null,
                media: clip.media || null,
                time_zone: clip.time_zone || null,
                local_thumbnail_path: clip.localThumbnailPath || null,
            });

            let identifications = clip.birdIdentification;
            if (!identifications) return;
            if (!Array.isArray(identifications)) {
                identifications = [identifications];
            }

            for (const ident of identifications) {
                insertIdentification.run({
                    clip_id: clip.id,
                    is_bird: ident.is_bird ? 1 : 0,
                    species: ident.species || null,
                    gender: ident.gender || null,
                    count: ident.count ?? null,
                    confidence: ident.confidence ?? null,
                    non_bird_species: ident.non_bird_species || null,
                    ai_model_id: ident.ai_model_id ?? null,
                    ai_prompt_id: ident.ai_prompt_id ?? null,
                });
            }
        });

        transaction(clip);
    }

    commit() {
        // No-op: SQLite writes are immediate
    }

    data(since = null) {
        let rows;
        if (since) {
            const sinceStr = since instanceof Date ? since.toISOString() : String(since);
            rows = this.db.prepare('SELECT id FROM clips WHERE created_at >= ?').all(sinceStr);
        } else {
            rows = this.db.prepare('SELECT id FROM clips').all();
        }
        const result = {};
        for (const row of rows) {
            result[row.id] = true;
        }
        return result;
    }

    pruneClipsBefore(cutoffIso) {
        const deleteIdents = this.db.prepare(
            'DELETE FROM identifications WHERE clip_id IN (SELECT id FROM clips WHERE created_at < ?)'
        );
        const deleteClips = this.db.prepare('DELETE FROM clips WHERE created_at < ?');

        const transaction = this.db.transaction((cutoff) => {
            const identsResult = deleteIdents.run(cutoff);
            const clipsResult = deleteClips.run(cutoff);
            return {
                identificationsDeleted: identsResult.changes,
                clipsDeleted: clipsResult.changes,
            };
        });

        return transaction(cutoffIso);
    }

    getLatestAudioDetectionId() {
        const row = this.db.prepare('SELECT MAX(birdnet_detection_id) as maxId FROM audio_identifications').get();
        return row?.maxId || 0;
    }

    addAudioIdentification(record) {
        const insert = this.db.prepare(`
            INSERT OR IGNORE INTO audio_identifications
                (birdnet_detection_id, species, scientific_name, species_code, confidence, verified, source, detected_at, begin_time, end_time, local_audio_path, species_image_id, created_at)
            VALUES
                (@birdnet_detection_id, @species, @scientific_name, @species_code, @confidence, @verified, @source, @detected_at, @begin_time, @end_time, @local_audio_path, @species_image_id, @created_at)
        `);
        return insert.run({
            birdnet_detection_id: record.birdnet_detection_id,
            species: record.species || null,
            scientific_name: record.scientific_name || null,
            species_code: record.species_code || null,
            confidence: record.confidence ?? null,
            verified: record.verified || null,
            source: record.source || null,
            detected_at: record.detected_at || null,
            begin_time: record.begin_time || null,
            end_time: record.end_time || null,
            local_audio_path: record.local_audio_path || null,
            species_image_id: record.species_image_id ?? null,
            created_at: record.created_at || new Date().toISOString(),
        });
    }

    getSpeciesImage(scientificName) {
        const row = this.db.prepare('SELECT * FROM species_images WHERE scientific_name = ?').get(scientificName);
        return row || null;
    }

    addSpeciesImage({ scientific_name, common_name, local_path }) {
        const insert = this.db.prepare(`
            INSERT INTO species_images (scientific_name, common_name, local_path, created_at)
            VALUES (@scientific_name, @common_name, @local_path, @created_at)
        `);
        const result = insert.run({
            scientific_name,
            common_name: common_name || null,
            local_path,
            created_at: new Date().toISOString(),
        });
        return result.lastInsertRowid;
    }

    pruneAudioIdentificationsBefore(cutoffIso) {
        const result = this.db.prepare('DELETE FROM audio_identifications WHERE detected_at < ?').run(cutoffIso);
        return { audioIdentificationsDeleted: result.changes };
    }
}

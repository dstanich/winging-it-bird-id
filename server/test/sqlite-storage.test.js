import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SQLiteStorage } from '../lib/sqlite-storage.js';
import { DEFAULT_MODEL, DEFAULT_PROMPT } from '../lib/ai-provider.js';
import { useTempDirs } from './helpers.js';

const makeTempDir = useTempDirs();

describe('SQLiteStorage', () => {
  let dataDir;
  let storage;

  const openStorage = () => {
    storage = new SQLiteStorage();
    return storage;
  };

  beforeEach(() => {
    dataDir = path.join(makeTempDir(), 'data');
    vi.stubEnv('DATA_DIR', dataDir);
  });

  afterEach(() => {
    storage?.db.close();
    storage = undefined;
  });

  const clipRows = () => storage.db.prepare('SELECT * FROM clips ORDER BY id').all();
  const identRows = () => storage.db.prepare('SELECT * FROM identifications ORDER BY id').all();

  describe('initialization', () => {
    it('creates DATA_DIR and the database file if missing', () => {
      expect(fs.existsSync(dataDir)).toBe(false);
      openStorage();
      expect(fs.existsSync(path.join(dataDir, 'bird-data.db'))).toBe(true);
    });

    it('enables WAL mode and foreign keys', () => {
      openStorage();
      expect(storage.db.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(storage.db.pragma('foreign_keys', { simple: true })).toBe(1);
    });

    it('creates all tables', () => {
      openStorage();
      const tables = storage.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .all()
        .map(r => r.name);
      expect(tables).toEqual(expect.arrayContaining([
        'clips', 'identifications', 'settings', 'species_images', 'audio_identifications',
      ]));
    });

    it('seeds the default ai_prompt and ai_model as active settings', () => {
      openStorage();
      expect(storage.getSetting('ai_prompt')).toBe(DEFAULT_PROMPT);
      expect(storage.getSetting('ai_model')).toBe(DEFAULT_MODEL);
      expect(storage.getSettings('ai_prompt')).toHaveLength(1);
      expect(storage.getSettings('ai_model')).toHaveLength(1);
    });

    it('does not re-seed settings when reopening an existing database', () => {
      openStorage();
      storage.db.close();
      openStorage();
      expect(storage.getSettings('ai_prompt')).toHaveLength(1);
      expect(storage.getSettings('ai_model')).toHaveLength(1);
    });

    it('does not seed a setting that already exists, even if none is active', () => {
      openStorage();
      const [model] = storage.getSettings('ai_model');
      storage.updateSetting(model.id, { isActive: 0 });
      storage.db.close();

      openStorage();
      expect(storage.getSettings('ai_model')).toHaveLength(1);
      expect(storage.getSetting('ai_model')).toBeNull();
    });
  });

  describe('legacy identifications.model migration', () => {
    const createLegacyDb = ({ withSettings }) => {
      fs.mkdirSync(dataDir, { recursive: true });
      const db = new Database(path.join(dataDir, 'bird-data.db'));
      db.exec(`
        CREATE TABLE clips (id INTEGER PRIMARY KEY, created_at TEXT, updated_at TEXT, device_name TEXT,
          network_name TEXT, type TEXT, source TEXT, thumbnail TEXT, media TEXT, time_zone TEXT,
          local_thumbnail_path TEXT);
        CREATE TABLE identifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          clip_id INTEGER NOT NULL REFERENCES clips(id),
          is_bird BOOLEAN NOT NULL,
          species TEXT, gender TEXT, count INTEGER, confidence REAL, non_bird_species TEXT,
          model TEXT
        );
        INSERT INTO clips (id, created_at) VALUES (100, '2026-07-01T12:00:00.000Z');
        INSERT INTO identifications (clip_id, is_bird, species, count, confidence, model)
          VALUES (100, 1, 'northern cardinal', 2, 0.9, '${DEFAULT_MODEL}');
        INSERT INTO identifications (clip_id, is_bird, species, model)
          VALUES (100, 1, 'blue jay', 'some-retired-model');
        INSERT INTO identifications (clip_id, is_bird, non_bird_species, model)
          VALUES (100, 0, 'squirrel', NULL);
      `);
      if (withSettings) {
        db.exec(`
          CREATE TABLE settings (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
            value TEXT NOT NULL, is_active BOOLEAN NOT NULL DEFAULT 0);
          INSERT INTO settings (name, value, is_active) VALUES ('ai_prompt', 'old prompt', 0);
          INSERT INTO settings (name, value, is_active) VALUES ('ai_prompt', 'current prompt', 1);
          INSERT INTO settings (name, value, is_active) VALUES ('ai_model', 'some-retired-model', 0);
          INSERT INTO settings (name, value, is_active) VALUES ('ai_model', '${DEFAULT_MODEL}', 1);
        `);
      }
      db.close();
    };

    it('drops the model column and adds ai_model_id/ai_prompt_id', () => {
      createLegacyDb({ withSettings: true });
      openStorage();
      const columns = storage.db.pragma('table_info(identifications)').map(c => c.name);
      expect(columns).not.toContain('model');
      expect(columns).toEqual(expect.arrayContaining(['ai_model_id', 'ai_prompt_id']));
    });

    it('backfills ai_model_id by matching model text and ai_prompt_id with the active prompt', () => {
      createLegacyDb({ withSettings: true });
      openStorage();
      const settingId = (name, value) => storage.getSettings(name).find(s => s.value === value).id;

      const rows = identRows();
      expect(rows).toHaveLength(3);
      expect(rows[0]).toMatchObject({
        clip_id: 100, species: 'northern cardinal', count: 2, confidence: 0.9,
        ai_model_id: settingId('ai_model', DEFAULT_MODEL),
        ai_prompt_id: settingId('ai_prompt', 'current prompt'),
      });
      expect(rows[1]).toMatchObject({
        species: 'blue jay',
        ai_model_id: settingId('ai_model', 'some-retired-model'),
        ai_prompt_id: settingId('ai_prompt', 'current prompt'),
      });
      // Rows that never had a model stay unattributed
      expect(rows[2]).toMatchObject({ is_bird: 0, non_bird_species: 'squirrel', ai_model_id: null, ai_prompt_id: null });
    });

    it('leaves ai_model_id null when the legacy model has no matching settings row', () => {
      createLegacyDb({ withSettings: false });
      openStorage();
      const rows = identRows();
      const seededModelId = storage.getSettingWithId('ai_model').id;
      expect(rows[0].ai_model_id).toBe(seededModelId); // matches the freshly seeded default model
      expect(rows[1].ai_model_id).toBeNull(); // 'some-retired-model' isn't in settings
    });

    it('recreates the species index and is a no-op on subsequent opens', () => {
      createLegacyDb({ withSettings: true });
      openStorage();
      const before = identRows();
      const indexes = storage.db.pragma('index_list(identifications)').map(i => i.name);
      expect(indexes).toContain('idx_identifications_species');
      storage.db.close();

      openStorage();
      expect(identRows()).toEqual(before);
    });
  });

  describe('settings', () => {
    beforeEach(() => openStorage());

    it('getSetting/getSettingWithId return null for unknown names', () => {
      expect(storage.getSetting('nope')).toBeNull();
      expect(storage.getSettingWithId('nope')).toBeNull();
    });

    it('getSettingWithId returns only id and value of the active row', () => {
      const result = storage.getSettingWithId('ai_model');
      expect(result).toEqual({ id: expect.any(Number), value: DEFAULT_MODEL });
    });

    it('setSetting inserts inactive by default and coerces isActive to 0/1', () => {
      storage.setSetting('ai_model', 'inactive-model');
      storage.setSetting('ai_model', 'truthy-model', 'yes');
      const rows = storage.getSettings('ai_model');
      expect(rows.find(r => r.value === 'inactive-model').is_active).toBe(0);
      expect(rows.find(r => r.value === 'truthy-model').is_active).toBe(1);
    });

    it('setSetting returns the insert result', () => {
      const result = storage.setSetting('foo', 'bar');
      expect(result.changes).toBe(1);
      expect(storage.getSettings('foo')[0].id).toBe(Number(result.lastInsertRowid));
    });

    it('supports versioning by flipping is_active between rows', () => {
      const original = storage.getSettingWithId('ai_model');
      const { lastInsertRowid } = storage.setSetting('ai_model', 'gemini-next');
      storage.updateSetting(original.id, { isActive: false });
      storage.updateSetting(Number(lastInsertRowid), { isActive: true });

      expect(storage.getSettingWithId('ai_model')).toEqual({ id: Number(lastInsertRowid), value: 'gemini-next' });
      expect(storage.getSettings('ai_model')).toHaveLength(2);
    });

    it('updateSetting updates only the provided fields', () => {
      const { id } = storage.getSettingWithId('ai_prompt');
      storage.updateSetting(id, { value: 'new prompt' });
      expect(storage.getSettings('ai_prompt')[0]).toMatchObject({ value: 'new prompt', is_active: 1 });
    });

    it('updateSetting with no fields is a no-op', () => {
      const before = storage.getSettings('ai_prompt');
      expect(() => storage.updateSetting(before[0].id, {})).not.toThrow();
      expect(() => storage.updateSetting(before[0].id)).not.toThrow();
      expect(storage.getSettings('ai_prompt')).toEqual(before);
    });

    it('deleteSetting removes the row', () => {
      const { lastInsertRowid } = storage.setSetting('foo', 'bar');
      storage.deleteSetting(Number(lastInsertRowid));
      expect(storage.getSettings('foo')).toEqual([]);
    });
  });

  describe('clips and identifications', () => {
    beforeEach(() => openStorage());

    const baseClip = {
      id: 1751652000,
      created_at: '2025-07-04T18:00:00.000Z',
      updated_at: '2025-07-04T18:00:00.000Z',
      device_name: 'Feeder',
      network_name: 'Reolink FTP',
      type: 'recording',
      source: 'ftp',
      thumbnail: 'ftp-frame',
      media: 'Feeder_00_20250704130000.mp4',
      time_zone: 'America/Chicago',
      localThumbnailPath: 'downloads/2025/7/4/1751652000.jpg',
      localVideoPath: 'uploads/Feeder_00_20250704130000.mp4',
    };

    it('stores clip metadata, mapping localThumbnailPath to local_thumbnail_path', () => {
      storage.addClip(baseClip);
      expect(clipRows()).toEqual([{
        id: 1751652000,
        created_at: '2025-07-04T18:00:00.000Z',
        updated_at: '2025-07-04T18:00:00.000Z',
        device_name: 'Feeder',
        network_name: 'Reolink FTP',
        type: 'recording',
        source: 'ftp',
        thumbnail: 'ftp-frame',
        media: 'Feeder_00_20250704130000.mp4',
        time_zone: 'America/Chicago',
        local_thumbnail_path: 'downloads/2025/7/4/1751652000.jpg',
      }]);
    });

    it('stores missing clip fields as NULL', () => {
      storage.addClip({ id: 5 });
      expect(clipRows()[0]).toMatchObject({ id: 5, created_at: null, device_name: null, local_thumbnail_path: null });
    });

    it('stores a clip without identifications', () => {
      storage.addClip(baseClip);
      expect(identRows()).toEqual([]);
    });

    it('stores an array of identifications, one row per species', () => {
      const modelId = storage.getSettingWithId('ai_model').id;
      const promptId = storage.getSettingWithId('ai_prompt').id;
      storage.addClip({
        ...baseClip,
        birdIdentification: [
          { is_bird: true, species: 'house finch', gender: 'male', count: 2, confidence: 0.92, non_bird_species: '', ai_model_id: modelId, ai_prompt_id: promptId },
          { is_bird: true, species: 'house sparrow', gender: 'unknown', count: 1, confidence: 0.6, ai_model_id: modelId, ai_prompt_id: promptId },
        ],
      });
      const rows = identRows();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({
        id: expect.any(Number),
        clip_id: baseClip.id,
        is_bird: 1,
        species: 'house finch',
        gender: 'male',
        count: 2,
        confidence: 0.92,
        non_bird_species: null,
        ai_model_id: modelId,
        ai_prompt_id: promptId,
      });
      expect(rows[1]).toMatchObject({ species: 'house sparrow', count: 1 });
    });

    it('accepts a single identification object (non-array AI response)', () => {
      storage.addClip({ ...baseClip, birdIdentification: { is_bird: false, non_bird_species: 'squirrel', confidence: 0.8 } });
      expect(identRows()).toEqual([expect.objectContaining({
        is_bird: 0, species: null, non_bird_species: 'squirrel', confidence: 0.8, ai_model_id: null, ai_prompt_id: null,
      })]);
    });

    it('preserves zero count and confidence rather than nulling them', () => {
      storage.addClip({ ...baseClip, birdIdentification: [{ is_bird: false, count: 0, confidence: 0 }] });
      expect(identRows()[0]).toMatchObject({ count: 0, confidence: 0 });
    });

    it('rolls back the clip if an identification insert fails', () => {
      expect(() => storage.addClip({
        ...baseClip,
        birdIdentification: [{ is_bird: true, species: 'x', ai_model_id: 999999 }], // FK violation
      })).toThrow(/FOREIGN KEY/);
      expect(clipRows()).toEqual([]);
      expect(identRows()).toEqual([]);
    });

    it('replaces clip metadata but appends identifications when a clip id is re-added', () => {
      // Documents current behavior: discoverNewClips() dedupes clip ids against
      // storage and within a batch, so the main loop never re-adds a clip.
      storage.addClip({ ...baseClip, device_name: 'Old', birdIdentification: [{ is_bird: true, species: 'blue jay' }] });
      storage.addClip({ ...baseClip, device_name: 'New', birdIdentification: [{ is_bird: true, species: 'house finch' }] });

      expect(clipRows().map(c => c.device_name)).toEqual(['New']);
      expect(identRows().map(i => i.species)).toEqual(['blue jay', 'house finch']);
    });

    it('commit() is a no-op', () => {
      expect(() => storage.commit()).not.toThrow();
    });

    it('data() returns a map of all stored clip ids', () => {
      expect(storage.data()).toEqual({});
      storage.addClip({ id: 1, created_at: '2026-01-01T00:00:00.000Z' });
      storage.addClip({ id: 2, created_at: '2026-01-02T00:00:00.000Z' });
      expect(storage.data()).toEqual({ 1: true, 2: true });
    });

    it('data(since) filters by created_at >= since, accepting a Date or string', () => {
      storage.addClip({ id: 1, created_at: '2026-01-01T00:00:00.000Z' });
      storage.addClip({ id: 2, created_at: '2026-01-02T00:00:00.000Z' });
      storage.addClip({ id: 3, created_at: '2026-01-03T00:00:00.000Z' });
      expect(storage.data('2026-01-02T00:00:00.000Z')).toEqual({ 2: true, 3: true });
      expect(storage.data(new Date('2026-01-02T12:00:00.000Z'))).toEqual({ 3: true });
    });

    it('getMostRecentClipTimestamp returns null when empty, else the latest created_at', () => {
      expect(storage.getMostRecentClipTimestamp()).toBeNull();
      storage.addClip({ id: 2, created_at: '2026-01-02T00:00:00.000Z' });
      storage.addClip({ id: 3, created_at: '2026-01-03T00:00:00.000Z' });
      storage.addClip({ id: 1, created_at: '2026-01-01T00:00:00.000Z' });
      expect(storage.getMostRecentClipTimestamp()).toBe('2026-01-03T00:00:00.000Z');
    });

    it('pruneClipsBefore deletes older clips and their identifications only', () => {
      storage.addClip({ id: 1, created_at: '2026-01-01T00:00:00.000Z', birdIdentification: [{ is_bird: true }, { is_bird: true }] });
      storage.addClip({ id: 2, created_at: '2026-01-02T00:00:00.000Z', birdIdentification: [{ is_bird: true }] });
      storage.addClip({ id: 3, created_at: '2026-01-03T00:00:00.000Z', birdIdentification: [{ is_bird: false }] });

      // Cutoff equal to clip 2's created_at: strictly-before semantics keep clip 2
      const result = storage.pruneClipsBefore('2026-01-02T00:00:00.000Z');

      expect(result).toEqual({ clipsDeleted: 1, identificationsDeleted: 2 });
      expect(clipRows().map(c => c.id)).toEqual([2, 3]);
      expect(identRows().map(i => i.clip_id)).toEqual([2, 3]);
    });

    it('pruneClipsBefore returns zero counts when nothing is old enough', () => {
      storage.addClip({ id: 1, created_at: '2026-01-01T00:00:00.000Z' });
      expect(storage.pruneClipsBefore('2025-01-01T00:00:00.000Z')).toEqual({ clipsDeleted: 0, identificationsDeleted: 0 });
    });
  });

  describe('audio identifications and species images', () => {
    beforeEach(() => openStorage());

    const audioRows = () => storage.db.prepare('SELECT * FROM audio_identifications ORDER BY id').all();

    const detection = (overrides = {}) => ({
      birdnet_detection_id: 42,
      species: 'American Robin',
      scientific_name: 'Turdus migratorius',
      species_code: 'amerob',
      confidence: 0.85,
      verified: 'unverified',
      source: 'Backyard mic',
      detected_at: '2026-07-04T13:00:00-05:00',
      begin_time: '2026-07-04T13:00:00-05:00',
      end_time: '2026-07-04T13:00:03-05:00',
      local_audio_path: 'downloads/2026/7/4/audio-42.wav',
      species_image_id: null,
      ...overrides,
    });

    it('getLatestAudioDetectionId returns 0 when empty, else the max detection id', () => {
      expect(storage.getLatestAudioDetectionId()).toBe(0);
      storage.addAudioIdentification(detection({ birdnet_detection_id: 7 }));
      storage.addAudioIdentification(detection({ birdnet_detection_id: 12 }));
      storage.addAudioIdentification(detection({ birdnet_detection_id: 9 }));
      expect(storage.getLatestAudioDetectionId()).toBe(12);
    });

    it('stores every audio identification field', () => {
      const imageId = storage.addSpeciesImage({ scientific_name: 'Turdus migratorius', local_path: 'p.jpg' });
      storage.addAudioIdentification(detection({ species_image_id: imageId, created_at: '2026-07-04T18:01:00.000Z' }));
      expect(audioRows()).toEqual([{
        id: expect.any(Number),
        birdnet_detection_id: 42,
        species: 'American Robin',
        scientific_name: 'Turdus migratorius',
        species_code: 'amerob',
        confidence: 0.85,
        verified: 'unverified',
        source: 'Backyard mic',
        detected_at: '2026-07-04T13:00:00-05:00',
        begin_time: '2026-07-04T13:00:00-05:00',
        end_time: '2026-07-04T13:00:03-05:00',
        local_audio_path: 'downloads/2026/7/4/audio-42.wav',
        species_image_id: Number(imageId),
        created_at: '2026-07-04T18:01:00.000Z',
      }]);
    });

    it('defaults created_at to now and missing fields to NULL', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
      try {
        storage.addAudioIdentification({ birdnet_detection_id: 1 });
      } finally {
        vi.useRealTimers();
      }
      expect(audioRows()[0]).toMatchObject({
        birdnet_detection_id: 1, species: null, confidence: null, species_image_id: null,
        created_at: '2026-08-01T00:00:00.000Z',
      });
    });

    it('ignores a duplicate birdnet_detection_id', () => {
      expect(storage.addAudioIdentification(detection()).changes).toBe(1);
      expect(storage.addAudioIdentification(detection({ species: 'changed' })).changes).toBe(0);
      expect(audioRows()).toHaveLength(1);
      expect(audioRows()[0].species).toBe('American Robin');
    });

    it('rejects a species_image_id that does not exist', () => {
      expect(() => storage.addAudioIdentification(detection({ species_image_id: 999 }))).toThrow(/FOREIGN KEY/);
    });

    it('pruneAudioIdentificationsBefore deletes rows with detected_at strictly before the cutoff', () => {
      storage.addAudioIdentification(detection({ birdnet_detection_id: 1, detected_at: '2026-01-01T00:00:00.000Z' }));
      storage.addAudioIdentification(detection({ birdnet_detection_id: 2, detected_at: '2026-01-02T00:00:00.000Z' }));
      storage.addAudioIdentification(detection({ birdnet_detection_id: 3, detected_at: '2026-01-03T00:00:00.000Z' }));
      expect(storage.pruneAudioIdentificationsBefore('2026-01-02T00:00:00.000Z')).toEqual({ audioIdentificationsDeleted: 1 });
      expect(audioRows().map(r => r.birdnet_detection_id)).toEqual([2, 3]);
    });

    it('pruneAudioIdentificationsBefore compares offset-style detected_at values as instants', () => {
      // Cutoff is 17:00Z. As strings both rows sort before it; as instants only the first is older.
      storage.addAudioIdentification(detection({ birdnet_detection_id: 1, detected_at: '2026-01-02T11:59:59-05:00' })); // 16:59:59Z
      storage.addAudioIdentification(detection({ birdnet_detection_id: 2, detected_at: '2026-01-02T12:30:00-05:00' })); // 17:30:00Z
      expect(storage.pruneAudioIdentificationsBefore('2026-01-02T17:00:00.000Z')).toEqual({ audioIdentificationsDeleted: 1 });
      expect(audioRows().map(r => r.birdnet_detection_id)).toEqual([2]);
    });

    it('getSpeciesImage returns null for an unknown species', () => {
      expect(storage.getSpeciesImage('Nope nope')).toBeNull();
    });

    it('addSpeciesImage returns the new row id and getSpeciesImage finds it', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
      let id;
      try {
        id = storage.addSpeciesImage({ scientific_name: 'Cardinalis cardinalis', common_name: 'Northern Cardinal', local_path: 'downloads/species/cardinalis_cardinalis.jpg' });
      } finally {
        vi.useRealTimers();
      }
      expect(storage.getSpeciesImage('Cardinalis cardinalis')).toEqual({
        id: Number(id),
        scientific_name: 'Cardinalis cardinalis',
        common_name: 'Northern Cardinal',
        local_path: 'downloads/species/cardinalis_cardinalis.jpg',
        created_at: '2026-08-01T00:00:00.000Z',
      });
    });

    it('addSpeciesImage stores a missing common_name as NULL', () => {
      storage.addSpeciesImage({ scientific_name: 'Turdus migratorius', local_path: 'p.jpg' });
      expect(storage.getSpeciesImage('Turdus migratorius').common_name).toBeNull();
    });

    it('addSpeciesImage rejects a duplicate scientific_name', () => {
      storage.addSpeciesImage({ scientific_name: 'Turdus migratorius', local_path: 'a.jpg' });
      expect(() => storage.addSpeciesImage({ scientific_name: 'Turdus migratorius', local_path: 'b.jpg' })).toThrow(/UNIQUE/);
    });
  });
});

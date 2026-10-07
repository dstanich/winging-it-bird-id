import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Storage } from '../lib/storage.js';
import { SQLiteStorage } from '../lib/sqlite-storage.js';
import { useTempDirs } from './helpers.js';

const makeTempDir = useTempDirs();

const facadeMethods = Object.getOwnPropertyNames(Storage.prototype).filter(name => name !== 'constructor');

describe('Storage facade', () => {
  let storage;

  afterEach(() => {
    storage?.provider.db?.close();
    storage = undefined;
  });

  it('uses SQLiteStorage as the default provider', () => {
    vi.stubEnv('DATA_DIR', path.join(makeTempDir(), 'data'));
    storage = new Storage();
    expect(storage.provider).toBeInstanceOf(SQLiteStorage);
  });

  // Representative arguments for each facade method. Adding a method to the
  // facade without adding it here fails the coverage test below.
  const callArgs = {
    addClip: [{ id: 1 }],
    commit: [],
    data: ['2026-01-01T00:00:00.000Z'],
    getSetting: ['ai_model'],
    getSettingWithId: ['ai_model'],
    getSettings: ['ai_model'],
    setSetting: ['ai_model', 'gemini-x', 1],
    updateSetting: [3, { value: 'v', isActive: 0 }],
    deleteSetting: [3],
    getMostRecentClipTimestamp: [],
    pruneClipsBefore: ['2026-01-01T00:00:00.000Z'],
    getLatestAudioDetectionId: [],
    addAudioIdentification: [{ birdnet_detection_id: 1 }],
    getSpeciesImage: ['Turdus migratorius'],
    addSpeciesImage: [{ scientific_name: 'Turdus migratorius', local_path: 'p.jpg' }],
    pruneAudioIdentificationsBefore: ['2026-01-01T00:00:00.000Z'],
  };

  it('has delegation test arguments for every facade method', () => {
    expect(Object.keys(callArgs).sort()).toEqual([...facadeMethods].sort());
  });

  it.each(facadeMethods)('SQLiteStorage implements %s', (method) => {
    expect(typeof SQLiteStorage.prototype[method]).toBe('function');
  });

  it.each(facadeMethods)('%s delegates to the provider with the same arguments and return value', (method) => {
    const facade = Object.create(Storage.prototype);
    const sentinel = Symbol(method);
    facade.provider = { [method]: vi.fn().mockReturnValue(sentinel) };

    const result = facade[method](...callArgs[method]);

    expect(facade.provider[method]).toHaveBeenCalledExactlyOnceWith(...callArgs[method]);
    expect(result).toBe(sentinel);
  });

  it('data() defaults since to null', () => {
    const facade = Object.create(Storage.prototype);
    facade.provider = { data: vi.fn() };
    facade.data();
    expect(facade.provider.data).toHaveBeenCalledExactlyOnceWith(null);
  });

  it('setSetting() defaults isActive to 0', () => {
    const facade = Object.create(Storage.prototype);
    facade.provider = { setSetting: vi.fn() };
    facade.setSetting('name', 'value');
    expect(facade.provider.setSetting).toHaveBeenCalledExactlyOnceWith('name', 'value', 0);
  });

  it('works end to end against a real SQLite provider', () => {
    vi.stubEnv('DATA_DIR', path.join(makeTempDir(), 'data'));
    storage = new Storage();
    storage.addClip({ id: 10, created_at: '2026-01-01T00:00:00.000Z', birdIdentification: [{ is_bird: true, species: 'blue jay' }] });
    storage.commit();
    expect(storage.data()).toEqual({ 10: true });
    expect(storage.getMostRecentClipTimestamp()).toBe('2026-01-01T00:00:00.000Z');
  });
});

import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completedDays,
  generateDailyImages,
  localDateString,
  mergeSpecies,
} from '../lib/daily-image.js';
import { useTempDirs } from './helpers.js';

const makeTempDir = useTempDirs();

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

describe('localDateString', () => {
  it('formats a local date as zero-padded YYYY-MM-DD', () => {
    expect(localDateString(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('mergeSpecies', () => {
  it('merges video and audio species case-insensitively, title-cased and sorted', () => {
    expect(mergeSpecies({
      video: ['house finch', 'american robin', 'house finch'],
      audio: ['American Robin', 'Blue Jay'],
    })).toEqual(['American Robin', 'Blue Jay', 'House Finch']);
  });

  it('drops blank and unknown/unidentified species', () => {
    expect(mergeSpecies({
      video: ['', '  ', 'unknown', 'unidentified bird', 'Unknown Sparrow'],
      audio: [' blue jay '],
    })).toEqual(['Blue Jay']);
  });
});

describe('completedDays', () => {
  const dates = (now, lookback) => completedDays(now, lookback).map(localDateString);

  it('excludes yesterday before 7 AM today', () => {
    expect(dates(new Date(2026, 6, 15, 6, 59, 59), 3)).toEqual(['2026-07-12', '2026-07-13']);
  });

  it('includes yesterday from 7 AM today, oldest first', () => {
    expect(dates(new Date(2026, 6, 15, 7, 0, 0), 3)).toEqual(['2026-07-12', '2026-07-13', '2026-07-14']);
  });

  it('never includes today and honors the lookback window', () => {
    expect(dates(new Date(2026, 6, 15, 23, 0, 0), 1)).toEqual(['2026-07-14']);
    expect(dates(new Date(2026, 6, 15, 23, 0, 0), 0)).toEqual([]);
  });

  it('crosses month boundaries', () => {
    expect(dates(new Date(2026, 7, 1, 8), 2)).toEqual(['2026-07-30', '2026-07-31']);
  });

  it('uses the local time zone for the 7 AM boundary', () => {
    vi.stubEnv('TZ', 'America/Chicago');
    // 11:30Z is 06:30 CDT: yesterday is not complete yet
    expect(dates(new Date('2026-07-15T11:30:00Z'), 1)).toEqual([]);
    // 12:00Z is 07:00 CDT
    expect(dates(new Date('2026-07-15T12:00:00Z'), 1)).toEqual(['2026-07-14']);
  });
});

describe('generateDailyImages', () => {
  // Local 8 AM on July 15: July 12-14 are complete with a 3-day lookback.
  const NOW = new Date(2026, 6, 15, 8, 0, 0);
  let downloadDir;

  /**
   * In-memory storage fake. speciesByDate maps YYYY-MM-DD (local start of the
   * queried range) to { video, audio }.
   */
  const fakeStorage = ({ speciesByDate = {}, existing = [] } = {}) => {
    const rows = new Map(existing.map(date => [date, { date }]));
    return {
      rows,
      getDailyImage: vi.fn(date => rows.get(date) ?? null),
      addDailyImage: vi.fn(image => { rows.set(image.date, image); return rows.size; }),
      getBirdSpeciesBetween: vi.fn((startIso) =>
        speciesByDate[localDateString(new Date(startIso))] ?? { video: [], audio: [] }),
    };
  };

  const fakeAi = () => ({
    generateImage: vi.fn().mockResolvedValue({ data: PNG_BYTES, mimeType: 'image/png', ai_model_id: 5, ai_prompt_id: 6 }),
  });

  const run = (storage, aiProvider, lookbackDays = 3) =>
    generateDailyImages(storage, aiProvider, { downloadDir, lookbackDays, delayMs: 0 });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    downloadDir = makeTempDir();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('queries each day from local midnight to the next local midnight', async () => {
    const storage = fakeStorage();
    await run(storage, fakeAi(), 1);
    expect(storage.getBirdSpeciesBetween).toHaveBeenCalledExactlyOnceWith(
      new Date(2026, 6, 14).toISOString(),
      new Date(2026, 6, 15).toISOString(),
    );
  });

  it('generates, writes, and records an image for a completed day with known species', async () => {
    const storage = fakeStorage({
      speciesByDate: { '2026-07-14': { video: ['house finch', 'blue jay'], audio: ['House Finch', 'American Robin'] } },
    });
    const ai = fakeAi();

    expect(await run(storage, ai)).toBe(1);

    expect(ai.generateImage).toHaveBeenCalledExactlyOnceWith('American Robin, Blue Jay, House Finch');
    const localPath = path.join(downloadDir, '2026', '7', '14', 'daily-2026-07-14.png');
    expect(fs.readFileSync(localPath)).toEqual(PNG_BYTES);
    expect(storage.addDailyImage).toHaveBeenCalledWith({
      date: '2026-07-14',
      species: ['American Robin', 'Blue Jay', 'House Finch'],
      local_path: localPath,
      ai_model_id: 5,
      ai_prompt_id: 6,
    });
  });

  it('uses the extension matching the returned mime type', async () => {
    const storage = fakeStorage({ speciesByDate: { '2026-07-14': { video: ['blue jay'], audio: [] } } });
    const ai = fakeAi();
    ai.generateImage.mockResolvedValue({ data: PNG_BYTES, mimeType: 'image/jpeg', ai_model_id: 5, ai_prompt_id: 6 });

    await run(storage, ai, 1);

    expect(fs.existsSync(path.join(downloadDir, '2026', '7', '14', 'daily-2026-07-14.jpg'))).toBe(true);
  });

  it('records a no-birds row without calling the AI when a day has no known species', async () => {
    const storage = fakeStorage({ speciesByDate: { '2026-07-14': { video: ['unknown'], audio: [] } } });
    const ai = fakeAi();

    expect(await run(storage, ai, 1)).toBe(0);

    expect(ai.generateImage).not.toHaveBeenCalled();
    expect(storage.addDailyImage).toHaveBeenCalledExactlyOnceWith({ date: '2026-07-14', species: [], local_path: null });
  });

  it('skips days that already have a row', async () => {
    const storage = fakeStorage({
      existing: ['2026-07-12', '2026-07-14'],
      speciesByDate: { '2026-07-13': { video: ['blue jay'], audio: [] } },
    });
    const ai = fakeAi();

    await run(storage, ai);

    expect(storage.getBirdSpeciesBetween).toHaveBeenCalledTimes(1);
    expect(storage.addDailyImage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ date: '2026-07-13' }));
  });

  it('does not process yesterday before 7 AM', async () => {
    vi.setSystemTime(new Date(2026, 6, 15, 6, 0, 0));
    const storage = fakeStorage();
    await run(storage, fakeAi(), 1);
    expect(storage.getDailyImage).not.toHaveBeenCalled();
    expect(storage.addDailyImage).not.toHaveBeenCalled();
  });

  it('logs a failure, stores nothing for that day, and continues with the next', async () => {
    const storage = fakeStorage({
      speciesByDate: {
        '2026-07-13': { video: ['blue jay'], audio: [] },
        '2026-07-14': { video: ['house finch'], audio: [] },
      },
    });
    const ai = fakeAi();
    const apiError = new Error('429 rate limited');
    ai.generateImage.mockRejectedValueOnce(apiError);

    expect(await run(storage, ai, 2)).toBe(1);

    expect(console.error).toHaveBeenCalledWith('Error generating daily image for 2026-07-13:', apiError);
    expect(storage.rows.has('2026-07-13')).toBe(false);
    expect(storage.rows.has('2026-07-14')).toBe(true);
    expect(fs.existsSync(path.join(downloadDir, '2026', '7', '13'))).toBe(false);
  });

  it('waits delayMs after each AI call, including failed ones', async () => {
    const storage = fakeStorage({
      speciesByDate: {
        '2026-07-13': { video: ['blue jay'], audio: [] },
        '2026-07-14': { video: ['house finch'], audio: [] },
      },
    });
    const ai = fakeAi();
    ai.generateImage.mockRejectedValueOnce(new Error('boom'));
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await generateDailyImages(storage, ai, { downloadDir, lookbackDays: 2, delayMs: 1 });

    expect(setTimeoutSpy.mock.calls.filter(([, ms]) => ms === 1)).toHaveLength(2);
  });
});

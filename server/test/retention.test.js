import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pruneOldData } from '../lib/retention.js';
import { useTempDirs } from './helpers.js';

const makeTempDir = useTempDirs();

// Local noon, so subtracting whole days never crosses a day boundary due to DST.
const NOW = new Date(2026, 6, 15, 12, 0, 0);
const RETENTION_DAYS = 10;

const fakeStorage = ({ clipsDeleted = 0, identificationsDeleted = 0, audioIdentificationsDeleted = 0, dailyImagesDeleted = 0 } = {}) => ({
  pruneClipsBefore: vi.fn().mockReturnValue({ clipsDeleted, identificationsDeleted }),
  pruneAudioIdentificationsBefore: vi.fn().mockReturnValue({ audioIdentificationsDeleted }),
  pruneDailyImagesBefore: vi.fn().mockReturnValue({ dailyImagesDeleted }),
});

/** Creates downloads/YYYY/M/D/ (non-padded) containing a file, for the given local date. */
const makeDayDir = (downloadDir, date) => {
  const dir = path.join(downloadDir, `${date.getFullYear()}`, `${date.getMonth() + 1}`, `${date.getDate()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '123.jpg'), 'jpeg');
  return dir;
};

const daysAgo = (n) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - n, 12);

describe('pruneOldData', () => {
  let downloadDir;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    downloadDir = makeTempDir();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prunes clips and audio identifications older than the retention cutoff', async () => {
    const storage = fakeStorage();
    await pruneOldData(storage, downloadDir, RETENTION_DAYS);

    const expectedCutoff = new Date(NOW.getTime() - RETENTION_DAYS * 86_400_000).toISOString();
    expect(storage.pruneClipsBefore).toHaveBeenCalledExactlyOnceWith(expectedCutoff);
    expect(storage.pruneAudioIdentificationsBefore).toHaveBeenCalledExactlyOnceWith(expectedCutoff);
  });

  it('prunes daily images dated before the cutoff day, keeping the cutoff day', async () => {
    const storage = fakeStorage();
    await pruneOldData(storage, downloadDir, RETENTION_DAYS);
    // NOW is 2026-07-15 local noon; 10 days earlier is 2026-07-05.
    expect(storage.pruneDailyImagesBefore).toHaveBeenCalledExactlyOnceWith('2026-07-05');
  });

  it('logs only when rows were actually pruned', async () => {
    await pruneOldData(fakeStorage(), downloadDir, RETENTION_DAYS);
    expect(console.log).not.toHaveBeenCalled();

    await pruneOldData(fakeStorage({ clipsDeleted: 2, identificationsDeleted: 3, audioIdentificationsDeleted: 4, dailyImagesDeleted: 5 }), downloadDir, RETENTION_DAYS);
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^Pruned 2 clip\(s\) and 3 identification\(s\)/));
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^Pruned 4 audio identification\(s\)/));
    expect(console.log).toHaveBeenCalledWith('Pruned 5 daily image(s) before 2026-07-05');
  });

  it('removes day directories before the cutoff day and keeps the cutoff day onward', async () => {
    const tooOld = makeDayDir(downloadDir, daysAgo(RETENTION_DAYS + 1));
    const cutoffDay = makeDayDir(downloadDir, daysAgo(RETENTION_DAYS));
    const recent = makeDayDir(downloadDir, daysAgo(1));
    const today = makeDayDir(downloadDir, NOW);

    await pruneOldData(fakeStorage(), downloadDir, RETENTION_DAYS);

    expect(fs.existsSync(tooOld)).toBe(false);
    expect(fs.existsSync(cutoffDay)).toBe(true);
    expect(fs.existsSync(recent)).toBe(true);
    expect(fs.existsSync(today)).toBe(true);
  });

  it('keeps the cutoff day even when the cutoff falls late in that day', async () => {
    // Cutoff instant is 23:30 local, 10 days ago; that day's directory must survive
    vi.setSystemTime(new Date(2026, 6, 15, 23, 30, 0));
    const cutoffDay = makeDayDir(downloadDir, new Date(2026, 6, 5));
    const dayBefore = makeDayDir(downloadDir, new Date(2026, 6, 4));

    await pruneOldData(fakeStorage(), downloadDir, RETENTION_DAYS);

    expect(fs.existsSync(cutoffDay)).toBe(true);
    expect(fs.existsSync(dayBefore)).toBe(false);
  });

  it('removes month and year directories left empty, and keeps non-empty ones', async () => {
    const oldYear = path.join(downloadDir, '2025');
    makeDayDir(downloadDir, new Date(2025, 11, 31));
    const oldMonthSameYear = path.join(downloadDir, '2026', '5');
    makeDayDir(downloadDir, new Date(2026, 4, 1));
    const currentMonth = path.join(downloadDir, '2026', '7');
    makeDayDir(downloadDir, new Date(2026, 6, 1)); // old day in the current month
    makeDayDir(downloadDir, daysAgo(0));

    await pruneOldData(fakeStorage(), downloadDir, RETENTION_DAYS);

    expect(fs.existsSync(oldYear)).toBe(false);
    expect(fs.existsSync(oldMonthSameYear)).toBe(false);
    expect(fs.readdirSync(currentMonth)).toEqual([`${NOW.getDate()}`]);
    expect(fs.existsSync(path.join(downloadDir, '2026'))).toBe(true);
  });

  it('logs the number of day directories removed', async () => {
    makeDayDir(downloadDir, daysAgo(30));
    makeDayDir(downloadDir, daysAgo(31));
    await pruneOldData(fakeStorage(), downloadDir, RETENTION_DAYS);
    expect(console.log).toHaveBeenCalledWith(`Pruned 2 day-directories from ${downloadDir}`);
  });

  it('uses singular wording for a single day directory', async () => {
    makeDayDir(downloadDir, daysAgo(30));
    await pruneOldData(fakeStorage(), downloadDir, RETENTION_DAYS);
    expect(console.log).toHaveBeenCalledWith(`Pruned 1 day-directory from ${downloadDir}`);
  });

  it('never touches the species cache or other non-numeric entries', async () => {
    const speciesImage = path.join(downloadDir, 'species', 'turdus_migratorius.jpg');
    fs.mkdirSync(path.dirname(speciesImage), { recursive: true });
    fs.writeFileSync(speciesImage, 'jpeg');
    const oldYearNonNumeric = path.join(downloadDir, '2020', 'notes', '1');
    fs.mkdirSync(oldYearNonNumeric, { recursive: true });
    const oldMonthNonNumeric = path.join(downloadDir, '2020', '1', 'tmp');
    fs.mkdirSync(oldMonthNonNumeric, { recursive: true });
    fs.writeFileSync(path.join(downloadDir, 'README.txt'), 'hi');

    await pruneOldData(fakeStorage(), downloadDir, RETENTION_DAYS);

    expect(fs.existsSync(speciesImage)).toBe(true);
    expect(fs.existsSync(oldYearNonNumeric)).toBe(true);
    expect(fs.existsSync(oldMonthNonNumeric)).toBe(true);
    expect(fs.existsSync(path.join(downloadDir, 'README.txt'))).toBe(true);
  });

  it('skips numeric-named files at every level', async () => {
    fs.writeFileSync(path.join(downloadDir, '1999'), 'file, not a year dir');
    fs.mkdirSync(path.join(downloadDir, '2020', '1'), { recursive: true });
    fs.writeFileSync(path.join(downloadDir, '2020', '2'), 'file, not a month dir');
    fs.writeFileSync(path.join(downloadDir, '2020', '1', '3'), 'file, not a day dir');

    await expect(pruneOldData(fakeStorage(), downloadDir, RETENTION_DAYS)).resolves.toBeUndefined();

    expect(fs.existsSync(path.join(downloadDir, '1999'))).toBe(true);
    expect(fs.existsSync(path.join(downloadDir, '2020', '2'))).toBe(true);
    expect(fs.existsSync(path.join(downloadDir, '2020', '1', '3'))).toBe(true);
  });

  it('still prunes the database when downloadDir is unset or missing', async () => {
    const storage = fakeStorage();
    await pruneOldData(storage, undefined, RETENTION_DAYS);
    await pruneOldData(storage, path.join(downloadDir, 'does-not-exist'), RETENTION_DAYS);
    expect(storage.pruneClipsBefore).toHaveBeenCalledTimes(2);
    expect(storage.pruneAudioIdentificationsBefore).toHaveBeenCalledTimes(2);
    expect(storage.pruneDailyImagesBefore).toHaveBeenCalledTimes(2);
  });
});

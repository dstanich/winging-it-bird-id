import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import ffmpegPath from 'ffmpeg-static';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverNewClips } from '../lib/ftp-clips.js';
import { reolinkTimestamp, useTempDirs } from './helpers.js';

// Wrap the real rmSync/readdirSync so tests can make deleting an upload fail,
// or pin the directory listing order (which is filesystem-dependent).
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, rmSync: vi.fn(actual.rmSync), readdirSync: vi.fn(actual.readdirSync) };
});

const actualFs = await vi.importActual('fs');

/** Makes the next readdirSync call list entries in the given name order. */
const forceListingOrder = (names) => {
  vi.mocked(fs.readdirSync).mockImplementationOnce((dir, options) =>
    actualFs.readdirSync(dir, options).sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name)));
};

const makeTempDir = useTempDirs();

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

const fakeStorage = (processedIds = {}) => ({ data: vi.fn().mockReturnValue(processedIds) });

describe('discoverNewClips', () => {
  // A real 2-second video, generated once with the bundled ffmpeg binary.
  let fixturesDir;
  let sampleVideo;
  let uploadDir;
  let downloadDir;

  beforeAll(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'winging-it-fixture-'));
    sampleVideo = path.join(fixturesDir, 'sample.mp4');
    execFileSync(ffmpegPath, [
      '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc=duration=2:size=64x48:rate=5',
      '-pix_fmt', 'yuv420p',
      sampleVideo,
    ]);
  });

  afterAll(() => {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    const root = makeTempDir();
    uploadDir = path.join(root, 'uploads');
    downloadDir = path.join(root, 'downloads');
    fs.mkdirSync(uploadDir);
  });

  /** Copies the sample video into the upload dir under the given relative name. */
  const upload = (relativeName) => {
    const dest = path.join(uploadDir, relativeName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(sampleVideo, dest);
    return dest;
  };

  /** Writes a non-video file with a video extension, which ffmpeg cannot decode. */
  const uploadCorrupt = (relativeName) => {
    const dest = path.join(uploadDir, relativeName);
    fs.writeFileSync(dest, 'not a video');
    return dest;
  };

  const expectedThumbnailPath = (date, id) =>
    path.join(downloadDir, `${date.getFullYear()}`, `${date.getMonth() + 1}`, `${date.getDate()}`, `${id}.jpg`);

  const isJpeg = (file) => fs.readFileSync(file).subarray(0, 3).equals(JPEG_MAGIC);

  it('returns no clips when the upload dir does not exist', async () => {
    const clips = await discoverNewClips(fakeStorage(), path.join(uploadDir, 'missing'), downloadDir, 'Default');
    expect(clips).toEqual([]);
  });

  it('builds a clip from a Reolink-named upload and extracts a real JPEG thumbnail', async () => {
    const recordedAt = new Date(2026, 6, 4, 8, 5, 9); // local time, single-digit month/day
    const fileName = `Bird_Feeder_00_${reolinkTimestamp(recordedAt)}.mp4`;
    const videoPath = upload(fileName);
    const id = recordedAt.getTime() / 1000;

    const clips = await discoverNewClips(fakeStorage(), uploadDir, downloadDir, 'Default');

    const thumbnailPath = expectedThumbnailPath(recordedAt, id);
    expect(clips).toEqual([{
      id,
      created_at: recordedAt.toISOString(),
      updated_at: recordedAt.toISOString(),
      device_name: 'Bird_Feeder', // greedy match keeps underscores in camera names
      network_name: 'Reolink FTP',
      type: 'recording',
      source: 'ftp',
      thumbnail: 'ftp-frame',
      media: fileName,
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      localThumbnailPath: thumbnailPath,
      localVideoPath: videoPath,
    }]);
    expect(thumbnailPath).toContain(path.join('2026', '7', '4')); // month/day not zero-padded
    expect(isJpeg(thumbnailPath)).toBe(true);
    expect(fs.existsSync(videoPath)).toBe(true); // discovery never deletes uploads
  });

  it('interprets the filename timestamp in the server\'s local time zone', async () => {
    vi.stubEnv('TZ', 'America/Chicago');
    // 2026-07-04 13:00:00 CDT (UTC-5) === 18:00:00Z
    upload('Cam_00_20260704130000.mp4');

    const [clip] = await discoverNewClips(fakeStorage(), uploadDir, downloadDir, 'Default');

    expect(clip.id).toBe(Date.UTC(2026, 6, 4, 18, 0, 0) / 1000);
    expect(clip.created_at).toBe('2026-07-04T18:00:00.000Z');
    expect(clip.time_zone).toBe('America/Chicago');
  });

  it('buckets thumbnails by local date, even when the UTC date differs', async () => {
    vi.stubEnv('TZ', 'America/Chicago');
    // 2026-07-04 22:30 CDT is already 2026-07-05 in UTC
    upload('Cam_00_20260704223000.mp4');

    const [clip] = await discoverNewClips(fakeStorage(), uploadDir, downloadDir, 'Default');

    expect(clip.localThumbnailPath).toBe(path.join(downloadDir, '2026', '7', '4', `${clip.id}.jpg`));
  });

  it('falls back to file mtime and the default camera name for unrecognized filenames', async () => {
    const videoPath = upload('random-upload.mp4');
    const mtime = new Date(2026, 2, 1, 6, 30, 15);
    fs.utimesSync(videoPath, mtime, mtime);

    const [clip] = await discoverNewClips(fakeStorage(), uploadDir, downloadDir, 'Default Cam');

    expect(clip).toMatchObject({
      id: mtime.getTime() / 1000,
      device_name: 'Default Cam',
      media: 'random-upload.mp4',
      created_at: mtime.toISOString(),
      localThumbnailPath: expectedThumbnailPath(mtime, mtime.getTime() / 1000),
    });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('random-upload.mp4'));
  });

  it('skips clips already in storage, deleting the upload without extracting a thumbnail', async () => {
    const recordedAt = new Date(2026, 6, 4, 8, 0, 0);
    const id = recordedAt.getTime() / 1000;
    const videoPath = upload(`Cam_00_${reolinkTimestamp(recordedAt)}.mp4`);
    const storage = fakeStorage({ [id]: true });

    const clips = await discoverNewClips(storage, uploadDir, downloadDir, 'Default');

    expect(clips).toEqual([]);
    expect(storage.data).toHaveBeenCalledExactlyOnceWith();
    expect(fs.existsSync(videoPath)).toBe(false);
    expect(fs.existsSync(expectedThumbnailPath(recordedAt, id))).toBe(false);
  });

  it('keeps one clip when two uploads in a batch share a clip ID, deleting the other upload', async () => {
    // Directory listing order isn't guaranteed, so either upload may win
    const paths = [upload('Cam_00_20260704080001.mp4'), upload('Cam_01_20260704080001.mp4')];

    const clips = await discoverNewClips(fakeStorage(), uploadDir, downloadDir, 'Default');

    expect(clips).toHaveLength(1);
    expect(paths.filter(p => fs.existsSync(p))).toEqual([clips[0].localVideoPath]);
    expect(isJpeg(clips[0].localThumbnailPath)).toBe(true);
  });

  describe('same-ID uploads where one cannot be decoded', () => {
    const CORRUPT = 'Cam_00_20260704080001.mp4';
    const GOOD = 'Cam_01_20260704080001.mp4';

    it('uses the later upload when the first one listed fails extraction', async () => {
      const corrupt = uploadCorrupt(CORRUPT);
      const good = upload(GOOD);
      forceListingOrder([CORRUPT, GOOD]);

      const clips = await discoverNewClips(fakeStorage(), uploadDir, downloadDir, 'Default');

      // The failed extraction must not mark the ID as seen, or the good upload would be deleted
      expect(clips.map(c => c.localVideoPath)).toEqual([good]);
      expect(fs.existsSync(good)).toBe(true);
      expect(isJpeg(clips[0].localThumbnailPath)).toBe(true);
      expect(fs.existsSync(corrupt)).toBe(true); // left for the next tick, which removes it as already processed
      expect(console.error).toHaveBeenCalledWith(`Error processing uploaded file ${CORRUPT}:`, expect.any(Error));
    });

    it('deletes the undecodable upload as a duplicate when the good one is listed first', async () => {
      const corrupt = uploadCorrupt(CORRUPT);
      const good = upload(GOOD);
      forceListingOrder([GOOD, CORRUPT]);

      const clips = await discoverNewClips(fakeStorage(), uploadDir, downloadDir, 'Default');

      expect(clips.map(c => c.localVideoPath)).toEqual([good]);
      expect(fs.existsSync(corrupt)).toBe(false);
      expect(console.error).not.toHaveBeenCalled();
    });
  });

  it('logs and keeps going when a duplicate upload cannot be deleted', async () => {
    const recordedAt = new Date(2026, 6, 4, 8, 0, 0);
    const id = recordedAt.getTime() / 1000;
    const videoPath = upload(`Cam_00_${reolinkTimestamp(recordedAt)}.mp4`);
    upload('Other_00_20260704090000.mp4');
    const rmError = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    vi.mocked(fs.rmSync).mockClear().mockImplementationOnce(() => { throw rmError; });

    const clips = await discoverNewClips(fakeStorage({ [id]: true }), uploadDir, downloadDir, 'Default');

    expect(fs.rmSync).toHaveBeenCalledExactlyOnceWith(videoPath, { force: true });
    expect(console.error).toHaveBeenCalledWith(`Error removing duplicate upload ${videoPath}:`, rmError);
    expect(clips.map(c => c.device_name)).toEqual(['Other']);
  });

  it('only picks up supported video extensions, case-insensitively', async () => {
    const accepted = ['a_00_20260704080001.mp4', 'b_00_20260704080002.MP4', 'c_00_20260704080003.264',
      'd_00_20260704080004.265', 'e_00_20260704080005.h264', 'f_00_20260704080006.H265'];
    // The .264/.265/.h264/.h265 copies are really MP4s; ffmpeg probes content, not extension.
    accepted.forEach(upload);
    fs.writeFileSync(path.join(uploadDir, 'g_00_20260704080007.jpg'), 'jpeg');
    fs.writeFileSync(path.join(uploadDir, 'h_00_20260704080008.txt'), 'text');
    fs.writeFileSync(path.join(uploadDir, 'noextension'), 'data');

    const clips = await discoverNewClips(fakeStorage(), uploadDir, downloadDir, 'Default');

    expect(clips.map(c => c.media).sort()).toEqual([...accepted].sort());
  });

  it('scans one level of subdirectories but no deeper', async () => {
    upload('top_00_20260704080001.mp4');
    upload(path.join('sub', 'nested_00_20260704080002.mp4'));
    upload(path.join('sub', 'deeper', 'ignored_00_20260704080003.mp4'));

    const clips = await discoverNewClips(fakeStorage(), uploadDir, downloadDir, 'Default');

    expect(clips.map(c => c.device_name).sort()).toEqual(['nested', 'top']);
    expect(clips.find(c => c.device_name === 'nested').localVideoPath)
      .toBe(path.join(uploadDir, 'sub', 'nested_00_20260704080002.mp4'));
  });

  it('does not re-extract a thumbnail that already exists', async () => {
    // A corrupt video proves ffmpeg is never invoked: extraction would fail.
    const recordedAt = new Date(2026, 6, 4, 9, 0, 0);
    const id = recordedAt.getTime() / 1000;
    uploadCorrupt(`Cam_00_${reolinkTimestamp(recordedAt)}.mp4`);
    const thumbnailPath = expectedThumbnailPath(recordedAt, id);
    fs.mkdirSync(path.dirname(thumbnailPath), { recursive: true });
    fs.writeFileSync(thumbnailPath, 'existing thumbnail');

    const clips = await discoverNewClips(fakeStorage(), uploadDir, downloadDir, 'Default');

    expect(clips.map(c => c.id)).toEqual([id]);
    expect(fs.readFileSync(thumbnailPath, 'utf8')).toBe('existing thumbnail');
  });

  it('logs and skips uploads whose thumbnail cannot be extracted, keeping the rest', async () => {
    uploadCorrupt('Bad_00_20260704080001.mp4');
    upload('Good_00_20260704080002.mp4');

    const clips = await discoverNewClips(fakeStorage(), uploadDir, downloadDir, 'Default');

    expect(clips.map(c => c.device_name)).toEqual(['Good']);
    expect(console.error).toHaveBeenCalledWith(
      'Error processing uploaded file Bad_00_20260704080001.mp4:',
      expect.any(Error),
    );
  });
});

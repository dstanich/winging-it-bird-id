import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyCooldown, processClips } from '../lib/clip-processing.js';
import { useTempDirs } from './helpers.js';

const makeTempDir = useTempDirs();

describe('applyCooldown', () => {
  let dir;

  beforeEach(() => {
    dir = makeTempDir();
  });

  /** Creates a clip with real video/thumbnail files on disk. */
  const makeClip = (id) => {
    const localVideoPath = path.join(dir, `Cam_00_${id}.mp4`);
    const localThumbnailPath = path.join(dir, `${id}.jpg`);
    fs.writeFileSync(localVideoPath, 'video');
    fs.writeFileSync(localThumbnailPath, 'jpeg');
    return { id, media: path.basename(localVideoPath), localVideoPath, localThumbnailPath };
  };

  const ids = (clips) => clips.map(c => c.id);
  const filesExist = (clip) => fs.existsSync(clip.localVideoPath) && fs.existsSync(clip.localThumbnailPath);

  it('returns the input unchanged when cooldown is disabled', () => {
    const clips = [makeClip(300), makeClip(100), makeClip(101)];
    const result = applyCooldown(clips, 100_000, 0);
    expect(result).toBe(clips);
    expect(clips.every(filesExist)).toBe(true);
  });

  it('keeps every clip that is outside the cooldown, in chronological order', () => {
    const clips = [makeClip(300), makeClip(100), makeClip(200)];
    expect(ids(applyCooldown(clips, null, 60))).toEqual([100, 200, 300]);
    expect(clips.every(filesExist)).toBe(true);
  });

  it('does not mutate the input array order', () => {
    const clips = [makeClip(300), makeClip(100)];
    applyCooldown(clips, null, 60);
    expect(ids(clips)).toEqual([300, 100]);
  });

  it('always keeps the first clip when nothing has been processed yet', () => {
    const clips = [makeClip(100), makeClip(110)];
    expect(ids(applyCooldown(clips, null, 60))).toEqual([100]);
  });

  it('discards clips within the cooldown of the last processed clip from storage', () => {
    const clips = [makeClip(1030), makeClip(1100)];
    const result = applyCooldown(clips, 1000 * 1000, 60);
    expect(ids(result)).toEqual([1100]);
  });

  it('keeps a clip exactly cooldownSeconds after the last processed clip', () => {
    const clips = [makeClip(1059), makeClip(1060)];
    // 1059 is 59s after → discarded; 1060 is exactly 60s after the seed → kept
    expect(ids(applyCooldown(clips, 1000 * 1000, 60))).toEqual([1060]);
  });

  it('measures the cooldown from the last kept clip, not the last discarded one', () => {
    // 100 kept; 140, 159 discarded (within 60s of 100); 160 kept (60s after 100);
    // 200 discarded (40s after 160) even though it is 41s after 159
    const clips = [makeClip(100), makeClip(140), makeClip(159), makeClip(160), makeClip(200)];
    expect(ids(applyCooldown(clips, null, 60))).toEqual([100, 160]);
  });

  it('keeps clips older than the last processed clip (e.g. a retry after a failed AI call)', () => {
    // Clip 100 failed last tick while 200 was stored; it must not be discarded as "-100s since"
    const retry = makeClip(100);
    expect(ids(applyCooldown([retry], 200 * 1000, 60))).toEqual([100]);
    expect(filesExist(retry)).toBe(true);
  });

  it('applies the cooldown among older clips, and measures newer clips from the stored clip', () => {
    // Seed 1000s. Backlog: 900 kept, 930 discarded (30s after 900), 970 kept.
    // 1020 is 20s after the seed → discarded, even though it is 50s after 970.
    // 1060 is exactly 60s after the seed → kept.
    const clips = [makeClip(1060), makeClip(970), makeClip(1020), makeClip(930), makeClip(900)];
    expect(ids(applyCooldown(clips, 1000 * 1000, 60))).toEqual([900, 970, 1060]);
  });

  it('measures a clip just older than the seed against earlier kept clips only', () => {
    // 990 is 10s before the seed (not measured against it) and 50s after 940 → discarded
    const clips = [makeClip(940), makeClip(990)];
    expect(ids(applyCooldown(clips, 1000 * 1000, 60))).toEqual([940]);
  });

  it('deletes the video and thumbnail of discarded clips only', () => {
    const [kept, discarded] = [makeClip(100), makeClip(110)];
    applyCooldown([discarded, kept], null, 60);

    expect(filesExist(kept)).toBe(true);
    expect(fs.existsSync(discarded.localVideoPath)).toBe(false);
    expect(fs.existsSync(discarded.localThumbnailPath)).toBe(false);
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Discarding clip 110 .*10\.0s since last processed clip, within 60s cooldown/));
  });

  it('tolerates discarded clips with missing or absent file paths', () => {
    const clips = [
      { id: 100 },
      { id: 110, media: 'a.mp4' },
      { id: 120, localVideoPath: path.join(dir, 'gone.mp4'), localThumbnailPath: path.join(dir, 'gone.jpg') },
    ];
    expect(ids(applyCooldown(clips, null, 60))).toEqual([100]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('logs and continues when a discarded file cannot be removed', () => {
    const undeletable = path.join(dir, 'a-directory');
    fs.mkdirSync(undeletable); // rmSync without recursive throws on directories
    const thumb = path.join(dir, 'thumb.jpg');
    fs.writeFileSync(thumb, 'jpeg');

    const result = applyCooldown(
      [{ id: 100 }, { id: 110, localVideoPath: undeletable, localThumbnailPath: thumb }],
      null,
      60,
    );

    expect(ids(result)).toEqual([100]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(undeletable), expect.any(Error));
    expect(fs.existsSync(thumb)).toBe(false); // still removed the other file
  });

  it('returns an empty array for no clips', () => {
    expect(applyCooldown([], 1000, 60)).toEqual([]);
  });
});

describe('processClips', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const clip = (id) => ({ id, localThumbnailPath: `/thumbs/${id}.jpg` });

  it('identifies each clip and attaches the AI response', async () => {
    const aiProvider = {
      identifyBird: vi.fn(async c => [{ is_bird: true, species: `bird-${c.id}` }]),
    };
    const clips = [clip(1), clip(2)];

    const result = await processClips(clips, aiProvider, 0);

    expect(aiProvider.identifyBird).toHaveBeenNthCalledWith(1, clips[0], '/thumbs/1.jpg');
    expect(aiProvider.identifyBird).toHaveBeenNthCalledWith(2, clips[1], '/thumbs/2.jpg');
    expect(result).toEqual([
      { ...clip(1), birdIdentification: [{ is_bird: true, species: 'bird-1' }] },
      { ...clip(2), birdIdentification: [{ is_bird: true, species: 'bird-2' }] },
    ]);
    expect(result[0]).toBe(clips[0]); // clips are annotated in place
  });

  it('leaves failed clips out of the result and keeps going', async () => {
    const failure = new Error('boom');
    const aiProvider = {
      identifyBird: vi.fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce({ is_bird: false }),
    };
    const clips = [clip(1), clip(2)];

    const result = await processClips(clips, aiProvider, 0);

    expect(result.map(c => c.id)).toEqual([2]);
    expect(clips[0].birdIdentification).toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('Error processing clip 1:', failure);
  });

  it('returns an empty array for no clips', async () => {
    const aiProvider = { identifyBird: vi.fn() };
    expect(await processClips([], aiProvider, 0)).toEqual([]);
    expect(aiProvider.identifyBird).not.toHaveBeenCalled();
  });

  it('waits delayMs after each AI call', async () => {
    vi.useFakeTimers();
    const aiProvider = { identifyBird: vi.fn().mockResolvedValue([]) };
    let settled = false;

    const done = processClips([clip(1), clip(2)], aiProvider, 30000).then((r) => { settled = true; return r; });

    await vi.advanceTimersByTimeAsync(0);
    expect(aiProvider.identifyBird).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(29999);
    expect(aiProvider.identifyBird).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(aiProvider.identifyBird).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false); // still waiting after the last call

    await vi.advanceTimersByTimeAsync(30000);
    expect(settled).toBe(true);
    expect(await done).toHaveLength(2);
  });

  it('also waits delayMs after a failed AI call (e.g. a rate limit)', async () => {
    vi.useFakeTimers();
    const aiProvider = {
      identifyBird: vi.fn()
        .mockRejectedValueOnce(new Error('429 rate limited'))
        .mockResolvedValueOnce([]),
    };

    const done = processClips([clip(1), clip(2)], aiProvider, 30000);

    await vi.advanceTimersByTimeAsync(29999);
    expect(aiProvider.identifyBird).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(aiProvider.identifyBird).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30000);
    expect((await done).map(c => c.id)).toEqual([2]);
  });

  it('accepts the delay as a string (as read from PROCESS_DELAY)', async () => {
    vi.useFakeTimers();
    const aiProvider = { identifyBird: vi.fn().mockResolvedValue([]) };

    const done = processClips([clip(1), clip(2)], aiProvider, '500');

    await vi.advanceTimersByTimeAsync(499);
    expect(aiProvider.identifyBird).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(aiProvider.identifyBird).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(500);
    expect(await done).toHaveLength(2);
  });
});

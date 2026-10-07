import * as fs from 'fs';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BirdNetProvider } from '../lib/birdnet-provider.js';
import { Storage } from '../lib/storage.js';
import { useTempDirs } from './helpers.js';

const makeTempDir = useTempDirs();

const BASE_URL = 'http://birdnet.local:8080';
const NOW = new Date('2026-07-04T20:00:00.000Z');
const PAGE_SIZE = 100;

/** In-memory stand-in for the subset of Storage that BirdNetProvider uses. */
const fakeStorage = ({ latestId = 0, speciesImages = [] } = {}) => {
  const images = new Map(speciesImages.map(img => [img.scientific_name, img]));
  let nextImageId = 100;
  return {
    getLatestAudioDetectionId: vi.fn(() => latestId),
    getSpeciesImage: vi.fn(name => images.get(name) ?? null),
    addSpeciesImage: vi.fn((img) => {
      const row = { id: nextImageId++, ...img };
      images.set(img.scientific_name, row);
      return row.id;
    }),
    addAudioIdentification: vi.fn(),
  };
};

/** A BirdNET-Go detection as returned by /api/v2/detections. `minutesAgo` sets its timestamp relative to NOW. */
const detection = (id, { minutesAgo = 10, ...overrides } = {}) => {
  const timestamp = new Date(NOW.getTime() - minutesAgo * 60_000);
  return {
    id,
    date: timestamp.toISOString().slice(0, 10),
    timestamp: timestamp.toISOString(),
    commonName: 'American Robin',
    scientificName: 'Turdus migratorius',
    speciesCode: 'amerob',
    confidence: 0.9,
    verified: 'unverified',
    source: { id: 'rtsp_1', displayName: 'Backyard mic' },
    beginTime: timestamp.toISOString(),
    endTime: new Date(timestamp.getTime() + 3000).toISOString(),
    ...overrides,
  };
};

/**
 * Stubs global fetch with a tiny router. `pages` are the /api/v2/detections
 * responses by offset; `failures` maps a URL path to an HTTP status to return.
 */
const stubBirdNet = ({ pages = [], failures = {} } = {}) => {
  const fetchMock = vi.fn(async (url) => {
    const { pathname, search, searchParams } = new URL(url);
    const urlPath = pathname + search;
    if (failures[urlPath]) {
      return new Response('error', { status: failures[urlPath] });
    }
    if (pathname === '/api/v2/detections') {
      const page = pages[Number(searchParams.get('offset')) / PAGE_SIZE];
      return Response.json(page ?? { data: [], total_pages: pages.length });
    }
    if (pathname.startsWith('/api/v2/audio/')) {
      return new Response(`wav:${pathname.split('/').pop()}`);
    }
    if (pathname === '/api/v2/media/species-image') {
      return new Response(`jpg:${searchParams.get('name')}`);
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const fetchedPaths = (fetchMock) => fetchMock.mock.calls.map(([url]) => url.slice(BASE_URL.length));

describe('BirdNetProvider', () => {
  let downloadDir;

  const makeProvider = (storage, overrides = {}) => new BirdNetProvider(storage, {
    baseUrl: BASE_URL,
    minConfidence: 0.7,
    lookbackHours: 48,
    downloadDir,
    ...overrides,
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    downloadDir = makeTempDir();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('strips trailing slashes from the base URL', async () => {
    const fetchMock = stubBirdNet({ pages: [{ data: [], total_pages: 1 }] });
    await makeProvider(fakeStorage(), { baseUrl: `${BASE_URL}//` }).syncDetections();
    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/api/v2/detections?limit=100&offset=0`);
  });

  it('persists a detection with its downloaded audio clip and species image', async () => {
    stubBirdNet({ pages: [{ data: [detection(501)], total_pages: 1 }] });
    const storage = fakeStorage();

    const persisted = await makeProvider(storage).syncDetections();

    expect(persisted).toBe(1);
    const audioPath = path.join(downloadDir, '2026', '7', '4', 'audio-501.wav'); // month/day not zero-padded
    const imagePath = path.join(downloadDir, 'species', 'turdus_migratorius.jpg');
    expect(fs.readFileSync(audioPath, 'utf8')).toBe('wav:501');
    expect(fs.readFileSync(imagePath, 'utf8')).toBe('jpg:Turdus migratorius');

    const d = detection(501);
    expect(storage.addSpeciesImage).toHaveBeenCalledExactlyOnceWith({
      scientific_name: 'Turdus migratorius',
      common_name: 'American Robin',
      local_path: imagePath,
    });
    expect(storage.addAudioIdentification).toHaveBeenCalledExactlyOnceWith({
      birdnet_detection_id: 501,
      species: 'American Robin',
      scientific_name: 'Turdus migratorius',
      species_code: 'amerob',
      confidence: 0.9,
      verified: 'unverified',
      source: 'Backyard mic',
      detected_at: d.timestamp,
      begin_time: d.beginTime,
      end_time: d.endTime,
      local_audio_path: audioPath,
      species_image_id: 100,
    });
    expect(console.log).toHaveBeenCalledWith('✓ Synced 1 new BirdNET-Go audio detection(s)');
  });

  it('files audio by the detection\'s own date field', async () => {
    stubBirdNet({ pages: [{ data: [detection(7, { date: '2026-12-05' })], total_pages: 1 }] });
    const storage = fakeStorage();
    await makeProvider(storage).syncDetections();
    expect(storage.addAudioIdentification.mock.calls[0][0].local_audio_path)
      .toBe(path.join(downloadDir, '2026', '12', '5', 'audio-7.wav'));
  });

  it('falls back to the source id when the source has no display name', async () => {
    stubBirdNet({ pages: [{ data: [detection(1, { source: { id: 'rtsp_1' } })], total_pages: 1 }] });
    const storage = fakeStorage();
    await makeProvider(storage).syncDetections();
    expect(storage.addAudioIdentification.mock.calls[0][0].source).toBe('rtsp_1');
  });

  it('skips detections below the confidence threshold and keeps those at it', async () => {
    const fetchMock = stubBirdNet({
      pages: [{ data: [detection(3, { confidence: 0.7 }), detection(2, { confidence: 0.69 })], total_pages: 1 }],
    });
    const storage = fakeStorage();

    expect(await makeProvider(storage).syncDetections()).toBe(1);

    expect(storage.addAudioIdentification).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ birdnet_detection_id: 3 }));
    expect(fetchedPaths(fetchMock)).not.toContain('/api/v2/audio/2');
  });

  it('downloads each species image once and reuses it across detections', async () => {
    const fetchMock = stubBirdNet({
      pages: [{
        data: [
          detection(3),
          detection(2),
          detection(1, { scientificName: 'Cardinalis cardinalis', commonName: 'Northern Cardinal' }),
        ],
        total_pages: 1,
      }],
    });
    const storage = fakeStorage();

    await makeProvider(storage).syncDetections();

    const imageFetches = fetchedPaths(fetchMock).filter(p => p.startsWith('/api/v2/media/species-image'));
    expect(imageFetches).toEqual([
      '/api/v2/media/species-image?name=Turdus%20migratorius',
      '/api/v2/media/species-image?name=Cardinalis%20cardinalis',
    ]);
    const imageIds = storage.addAudioIdentification.mock.calls.map(([r]) => r.species_image_id);
    expect(imageIds).toEqual([100, 100, 101]);
  });

  it('reuses a species image cached by a previous sync without downloading', async () => {
    const fetchMock = stubBirdNet({ pages: [{ data: [detection(1)], total_pages: 1 }] });
    const storage = fakeStorage({
      speciesImages: [{ id: 9, scientific_name: 'Turdus migratorius', local_path: 'x.jpg' }],
    });

    await makeProvider(storage).syncDetections();

    expect(fetchedPaths(fetchMock).some(p => p.includes('species-image'))).toBe(false);
    expect(storage.addSpeciesImage).not.toHaveBeenCalled();
    expect(storage.addAudioIdentification.mock.calls[0][0].species_image_id).toBe(9);
  });

  it('slugifies scientific names into safe file names', async () => {
    stubBirdNet({
      pages: [{ data: [detection(1, { scientificName: 'Junco hyemalis (Oregon)/x' })], total_pages: 1 }],
    });
    const storage = fakeStorage();
    await makeProvider(storage).syncDetections();
    expect(storage.addSpeciesImage.mock.calls[0][0].local_path)
      .toBe(path.join(downloadDir, 'species', 'junco_hyemalis_oregon_x.jpg'));
  });

  describe('paging', () => {
    const pageOf = (ids, totalPages) => ({ data: ids.map(id => detection(id)), total_pages: totalPages });

    it('follows pages until total_pages is exhausted', async () => {
      const fetchMock = stubBirdNet({ pages: [pageOf([6, 5], 3), pageOf([4, 3], 3), pageOf([2, 1], 3)] });
      const storage = fakeStorage();

      expect(await makeProvider(storage).syncDetections()).toBe(6);

      const pageFetches = fetchedPaths(fetchMock).filter(p => p.startsWith('/api/v2/detections'));
      expect(pageFetches).toEqual([
        '/api/v2/detections?limit=100&offset=0',
        '/api/v2/detections?limit=100&offset=100',
        '/api/v2/detections?limit=100&offset=200',
      ]);
      expect(storage.addAudioIdentification.mock.calls.map(([r]) => r.birdnet_detection_id)).toEqual([6, 5, 4, 3, 2, 1]);
    });

    it('treats a missing total_pages as a single page', async () => {
      const fetchMock = stubBirdNet({ pages: [{ data: [detection(1)] }, pageOf([0], 2)] });
      await makeProvider(fakeStorage()).syncDetections();
      expect(fetchedPaths(fetchMock).filter(p => p.startsWith('/api/v2/detections'))).toHaveLength(1);
    });

    it('stops at the last synced detection id without fetching more pages', async () => {
      const fetchMock = stubBirdNet({ pages: [pageOf([12, 11, 10, 9], 5)] });
      const storage = fakeStorage({ latestId: 10 });

      expect(await makeProvider(storage).syncDetections()).toBe(2);

      expect(storage.addAudioIdentification.mock.calls.map(([r]) => r.birdnet_detection_id)).toEqual([12, 11]);
      expect(fetchedPaths(fetchMock).filter(p => p.startsWith('/api/v2/detections'))).toHaveLength(1);
    });

    it('stops at the lookback cutoff without fetching more pages', async () => {
      const fetchMock = stubBirdNet({
        pages: [{
          data: [
            detection(3, { minutesAgo: 60 }),
            detection(2, { minutesAgo: 48 * 60 }), // exactly at the cutoff: kept
            detection(1, { minutesAgo: 48 * 60 + 1 }), // older than the cutoff
          ],
          total_pages: 5,
        }],
      });
      const storage = fakeStorage();

      expect(await makeProvider(storage).syncDetections()).toBe(2);

      expect(storage.addAudioIdentification.mock.calls.map(([r]) => r.birdnet_detection_id)).toEqual([3, 2]);
      expect(fetchedPaths(fetchMock).filter(p => p.startsWith('/api/v2/detections'))).toHaveLength(1);
    });

    it('returns 0 and logs nothing when there is nothing new', async () => {
      stubBirdNet({ pages: [{ data: [], total_pages: 0 }] });
      const storage = fakeStorage();
      expect(await makeProvider(storage).syncDetections()).toBe(0);
      expect(storage.addAudioIdentification).not.toHaveBeenCalled();
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('errors', () => {
    it('rejects when a detections page request fails', async () => {
      stubBirdNet({ failures: { '/api/v2/detections?limit=100&offset=0': 503 } });
      await expect(makeProvider(fakeStorage()).syncDetections())
        .rejects.toThrow('BirdNET-Go request failed: /api/v2/detections?limit=100&offset=0 (503)');
    });

    it('logs and skips a detection whose audio download fails, continuing with the rest', async () => {
      stubBirdNet({
        pages: [{ data: [detection(3), detection(2), detection(1)], total_pages: 1 }],
        failures: { '/api/v2/audio/2': 404 },
      });
      const storage = fakeStorage();

      expect(await makeProvider(storage).syncDetections()).toBe(2);

      expect(storage.addAudioIdentification.mock.calls.map(([r]) => r.birdnet_detection_id)).toEqual([3, 1]);
      expect(console.error).toHaveBeenCalledWith(
        'Error syncing BirdNET-Go detection 2:',
        expect.objectContaining({ message: 'BirdNET-Go download failed: /api/v2/audio/2 (404)' }),
      );
    });

    it('does not persist a detection when its species image download fails', async () => {
      stubBirdNet({
        pages: [{ data: [detection(1)], total_pages: 1 }],
        failures: { '/api/v2/media/species-image?name=Turdus%20migratorius': 500 },
      });
      const storage = fakeStorage();

      expect(await makeProvider(storage).syncDetections()).toBe(0);
      expect(storage.addSpeciesImage).not.toHaveBeenCalled();
      expect(storage.addAudioIdentification).not.toHaveBeenCalled();
    });
  });

  it('syncs into a real SQLite store and does not re-sync on the next run', async () => {
    vi.stubEnv('DATA_DIR', path.join(makeTempDir(), 'data'));
    const storage = new Storage();
    try {
      const page = { data: [detection(2), detection(1)], total_pages: 1 };
      stubBirdNet({ pages: [page] });
      const provider = makeProvider(storage);

      expect(await provider.syncDetections()).toBe(2);
      expect(storage.getLatestAudioDetectionId()).toBe(2);
      expect(storage.getSpeciesImage('Turdus migratorius')).toMatchObject({ common_name: 'American Robin' });

      const fetchMock = stubBirdNet({ pages: [{ data: [detection(3), ...page.data], total_pages: 1 }] });
      expect(await provider.syncDetections()).toBe(1);
      expect(fetchedPaths(fetchMock)).toEqual([
        '/api/v2/detections?limit=100&offset=0',
        '/api/v2/audio/3',
      ]);
    } finally {
      storage.provider.db.close();
    }
  });
});

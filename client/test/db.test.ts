import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioIdentification, Clip, Identification } from "@/lib/db";
import { createTestDb, createTempDirFactory } from "./helpers";

// Fixed "now" for retention cutoffs. July in Chicago is CDT (UTC-5).
const NOW = new Date("2026-07-10T17:00:00Z");

const makeTempDir = createTempDirFactory();
let testDb: ReturnType<typeof createTestDb>;

/**
 * lib/db.ts computes its retention cutoff at import time, so re-import it
 * fresh after the clock and env are set up for each test.
 */
async function loadDb() {
  vi.resetModules();
  return import("@/lib/db");
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // Default to the code's 60-day retention even if the shell exports RETENTION_DAYS.
  vi.stubEnv("RETENTION_DAYS", undefined);
  const dir = makeTempDir();
  testDb = createTestDb(dir);
  vi.spyOn(process, "cwd").mockReturnValue(dir);
});

afterEach(() => {
  testDb.db.close();
  vi.useRealTimers();
});

describe("getAvailableDates", () => {
  it("returns an empty list for an empty database", async () => {
    const { getAvailableDates } = await loadDb();
    expect(getAvailableDates()).toEqual([]);
  });

  it("returns unique Chicago dates from clips and audio, newest first", async () => {
    testDb.addClip({ id: 1, createdAt: "2026-07-04T14:00:00Z" });
    testDb.addClip({ id: 2, createdAt: "2026-07-04T20:00:00Z" });
    // 03:00 UTC on July 9 is still July 8 in Chicago.
    testDb.addClip({ id: 3, createdAt: "2026-07-09T03:00:00Z" });
    testDb.addAudio({ birdnetDetectionId: 1, detectedAt: "2026-07-06T12:00:00Z" });
    testDb.addAudio({ birdnetDetectionId: 2, detectedAt: "2026-07-04T15:00:00Z" });

    const { getAvailableDates } = await loadDb();
    expect(getAvailableDates()).toEqual(["2026-07-08", "2026-07-06", "2026-07-04"]);
  });

  it("includes dates that only have audio detections", async () => {
    testDb.addAudio({ birdnetDetectionId: 1, detectedAt: "2026-07-06T12:00:00Z" });

    const { getAvailableDates } = await loadDb();
    expect(getAvailableDates()).toEqual(["2026-07-06"]);
  });

  it("excludes rows older than the default 60-day retention window", async () => {
    // Cutoff is 2026-05-11T17:00:00Z.
    testDb.addClip({ id: 1, createdAt: "2026-05-11T16:59:59Z" });
    testDb.addAudio({ birdnetDetectionId: 1, detectedAt: "2026-05-01T12:00:00Z" });
    testDb.addClip({ id: 2, createdAt: "2026-05-12T17:00:00Z" });

    const { getAvailableDates } = await loadDb();
    expect(getAvailableDates()).toEqual(["2026-05-12"]);
  });

  it("applies the cutoff to offset-style audio timestamps as instants", async () => {
    // Cutoff is 2026-05-11T17:00:00Z. 12:30 CDT is 17:30Z, inside the window,
    // even though the string sorts before the cutoff.
    testDb.addAudio({ birdnetDetectionId: 1, detectedAt: "2026-05-11T12:30:00-05:00" });

    const { getAvailableDates } = await loadDb();
    expect(getAvailableDates()).toEqual(["2026-05-11"]);
  });

  it("honors RETENTION_DAYS", async () => {
    vi.stubEnv("RETENTION_DAYS", "7");
    // Cutoff is 2026-07-03T17:00:00Z.
    testDb.addClip({ id: 1, createdAt: "2026-07-02T12:00:00Z" });
    testDb.addAudio({ birdnetDetectionId: 1, detectedAt: "2026-07-03T16:00:00Z" });
    testDb.addClip({ id: 2, createdAt: "2026-07-04T12:00:00Z" });

    const { getAvailableDates } = await loadDb();
    expect(getAvailableDates()).toEqual(["2026-07-04"]);
  });

  it("buckets by Chicago time regardless of the process time zone", async () => {
    vi.stubEnv("TZ", "Asia/Tokyo");
    // 23:30 CDT on July 4 — already July 5 in UTC and in Tokyo.
    testDb.addClip({ id: 1, createdAt: "2026-07-05T04:30:00Z" });

    const { getAvailableDates } = await loadDb();
    expect(getAvailableDates()).toEqual(["2026-07-04"]);
  });
});

describe("getClipsForDate", () => {
  it("returns clips for the date newest first, grouping identifications per clip in insert order", async () => {
    const modelId = testDb.addSetting("ai_model", "gemini-2.5-flash", true);
    const promptId = testDb.addSetting("ai_prompt", "identify birds", true);

    testDb.addClip({ id: 100, createdAt: "2026-07-04T13:00:00Z", thumbnailPath: "downloads/2026/7/4/100.jpg" });
    testDb.addClip({ id: 200, createdAt: "2026-07-04T18:00:00Z", thumbnailPath: "downloads/2026/7/4/200.jpg" });
    testDb.addIdentification({
      clipId: 100,
      isBird: true,
      species: "northern cardinal",
      gender: "male",
      count: 1,
      confidence: 0.92,
      aiModelId: modelId,
      aiPromptId: promptId,
    });
    testDb.addIdentification({
      clipId: 100,
      isBird: true,
      species: "house finch",
      gender: "female",
      count: 2,
      confidence: 0.81,
      aiModelId: modelId,
      aiPromptId: promptId,
    });
    testDb.addIdentification({
      clipId: 200,
      isBird: false,
      nonBirdSpecies: "squirrel",
      confidence: 0.7,
      aiModelId: modelId,
      aiPromptId: promptId,
    });

    const { getClipsForDate } = await loadDb();
    const clips = getClipsForDate("2026-07-04");

    expect(clips).toEqual([
      {
        id: 200,
        createdAt: "2026-07-04T18:00:00Z",
        thumbnailPath: "downloads/2026/7/4/200.jpg",
        identifications: [
          {
            isBird: false,
            species: null,
            gender: null,
            count: null,
            confidence: 0.7,
            nonBirdSpecies: "squirrel",
            model: "gemini-2.5-flash",
          },
        ],
      },
      {
        id: 100,
        createdAt: "2026-07-04T13:00:00Z",
        thumbnailPath: "downloads/2026/7/4/100.jpg",
        identifications: [
          {
            isBird: true,
            species: "northern cardinal",
            gender: "male",
            count: 1,
            confidence: 0.92,
            nonBirdSpecies: null,
            model: "gemini-2.5-flash",
          },
          {
            isBird: true,
            species: "house finch",
            gender: "female",
            count: 2,
            confidence: 0.81,
            nonBirdSpecies: null,
            model: "gemini-2.5-flash",
          },
        ],
      },
    ]);
  });

  it("returns a clip with no identifications as an empty list", async () => {
    testDb.addClip({ id: 1, createdAt: "2026-07-04T13:00:00Z" });

    const { getClipsForDate } = await loadDb();
    const clips = getClipsForDate("2026-07-04");

    expect(clips).toHaveLength(1);
    expect(clips[0].identifications).toEqual([]);
  });

  it("returns a null model when the identification has no model setting", async () => {
    testDb.addClip({ id: 1, createdAt: "2026-07-04T13:00:00Z" });
    testDb.addIdentification({ clipId: 1, isBird: true, species: "blue jay" });

    const { getClipsForDate } = await loadDb();
    expect(getClipsForDate("2026-07-04")[0].identifications[0].model).toBeNull();
  });

  it("uses the model each identification references, even if no longer active", async () => {
    const oldModel = testDb.addSetting("ai_model", "gemini-1.5-flash", false);
    testDb.addSetting("ai_model", "gemini-2.5-flash", true);
    testDb.addClip({ id: 1, createdAt: "2026-07-04T13:00:00Z" });
    testDb.addIdentification({ clipId: 1, isBird: true, species: "blue jay", aiModelId: oldModel });

    const { getClipsForDate } = await loadDb();
    expect(getClipsForDate("2026-07-04")[0].identifications[0].model).toBe("gemini-1.5-flash");
  });

  it("splits days at Chicago midnight", async () => {
    testDb.addClip({ id: 1, createdAt: "2026-07-05T04:59:59Z" }); // 23:59:59 CDT July 4
    testDb.addClip({ id: 2, createdAt: "2026-07-05T05:00:00Z" }); // 00:00:00 CDT July 5

    const { getClipsForDate } = await loadDb();
    expect(getClipsForDate("2026-07-04").map((c) => c.id)).toEqual([1]);
    expect(getClipsForDate("2026-07-05").map((c) => c.id)).toEqual([2]);
  });

  it("excludes clips older than the retention cutoff on the cutoff day", async () => {
    // Cutoff is 2026-05-11T17:00:00Z; both clips are on May 11 in Chicago.
    testDb.addClip({ id: 1, createdAt: "2026-05-11T16:59:59Z" });
    testDb.addClip({ id: 2, createdAt: "2026-05-11T17:00:00Z" });

    const { getClipsForDate } = await loadDb();
    expect(getClipsForDate("2026-05-11").map((c) => c.id)).toEqual([2]);
  });

  it("returns an empty list for a date with no clips", async () => {
    testDb.addClip({ id: 1, createdAt: "2026-07-04T13:00:00Z" });

    const { getClipsForDate } = await loadDb();
    expect(getClipsForDate("2026-07-05")).toEqual([]);
  });
});

describe("getAudioIdentificationsForDate", () => {
  it("returns detections for the date newest first, with species image paths", async () => {
    const imageId = testDb.addSpeciesImage("Cardinalis cardinalis", "downloads/species/cardinalis-cardinalis.jpg");
    const cardinalId = testDb.addAudio({
      birdnetDetectionId: 501,
      detectedAt: "2026-07-04T13:00:00Z",
      species: "Northern Cardinal",
      scientificName: "Cardinalis cardinalis",
      confidence: 0.88,
      audioPath: "downloads/2026/7/4/audio-501.wav",
      speciesImageId: imageId,
    });
    const robinId = testDb.addAudio({
      birdnetDetectionId: 502,
      detectedAt: "2026-07-04T19:30:00Z",
      species: "American Robin",
      scientificName: "Turdus migratorius",
      confidence: 0.75,
      audioPath: null,
      speciesImageId: null,
    });

    const { getAudioIdentificationsForDate } = await loadDb();
    expect(getAudioIdentificationsForDate("2026-07-04")).toEqual([
      {
        id: robinId,
        detectedAt: "2026-07-04T19:30:00Z",
        species: "American Robin",
        scientificName: "Turdus migratorius",
        confidence: 0.75,
        audioPath: null,
        speciesImagePath: null,
      },
      {
        id: cardinalId,
        detectedAt: "2026-07-04T13:00:00Z",
        species: "Northern Cardinal",
        scientificName: "Cardinalis cardinalis",
        confidence: 0.88,
        audioPath: "downloads/2026/7/4/audio-501.wav",
        speciesImagePath: "downloads/species/cardinalis-cardinalis.jpg",
      },
    ]);
  });

  it("filters by Chicago date and excludes detections before the retention cutoff", async () => {
    testDb.addAudio({ birdnetDetectionId: 1, detectedAt: "2026-07-05T04:59:59Z" }); // July 4 CDT
    testDb.addAudio({ birdnetDetectionId: 2, detectedAt: "2026-07-05T05:00:00Z" }); // July 5 CDT
    testDb.addAudio({ birdnetDetectionId: 3, detectedAt: "2026-05-11T16:59:59Z" }); // before cutoff
    testDb.addAudio({ birdnetDetectionId: 4, detectedAt: "2026-05-11T17:00:00Z" }); // at cutoff

    const { getAudioIdentificationsForDate } = await loadDb();
    expect(getAudioIdentificationsForDate("2026-07-04").map((a) => a.detectedAt)).toEqual(["2026-07-05T04:59:59Z"]);
    expect(getAudioIdentificationsForDate("2026-07-05").map((a) => a.detectedAt)).toEqual(["2026-07-05T05:00:00Z"]);
    expect(getAudioIdentificationsForDate("2026-05-11").map((a) => a.detectedAt)).toEqual(["2026-05-11T17:00:00Z"]);
  });

  it("buckets BirdNET-Go's offset-style timestamps by Chicago date", async () => {
    // 23:30 CDT on July 4 is 04:30 UTC on July 5.
    testDb.addAudio({ birdnetDetectionId: 1, detectedAt: "2026-07-04T23:30:00-05:00" });

    const { getAudioIdentificationsForDate } = await loadDb();
    expect(getAudioIdentificationsForDate("2026-07-04").map((a) => a.detectedAt)).toEqual(["2026-07-04T23:30:00-05:00"]);
    expect(getAudioIdentificationsForDate("2026-07-05")).toEqual([]);
  });

  it("applies the retention cutoff to offset-style timestamps as instants", async () => {
    // Cutoff is 2026-05-11T17:00:00Z; both are May 11 in Chicago.
    testDb.addAudio({ birdnetDetectionId: 1, detectedAt: "2026-05-11T11:59:59-05:00" }); // 16:59:59Z
    testDb.addAudio({ birdnetDetectionId: 2, detectedAt: "2026-05-11T12:30:00-05:00" }); // 17:30:00Z

    const { getAudioIdentificationsForDate } = await loadDb();
    expect(getAudioIdentificationsForDate("2026-05-11").map((a) => a.detectedAt)).toEqual([
      "2026-05-11T12:30:00-05:00",
    ]);
  });

  it("orders mixed-format timestamps by instant, newest first", async () => {
    testDb.addAudio({ birdnetDetectionId: 1, detectedAt: "2026-07-04T18:00:00Z" });
    testDb.addAudio({ birdnetDetectionId: 2, detectedAt: "2026-07-04T14:00:00-05:00" }); // 19:00Z
    testDb.addAudio({ birdnetDetectionId: 3, detectedAt: "2026-07-04T17:00:00Z" });

    const { getAudioIdentificationsForDate } = await loadDb();
    expect(getAudioIdentificationsForDate("2026-07-04").map((a) => a.detectedAt)).toEqual([
      "2026-07-04T14:00:00-05:00",
      "2026-07-04T18:00:00Z",
      "2026-07-04T17:00:00Z",
    ]);
  });
});

describe("getActiveSettings", () => {
  it("returns the active model and prompt", async () => {
    testDb.addSetting("ai_model", "gemini-1.5-flash", false);
    testDb.addSetting("ai_model", "gemini-2.5-flash", true);
    testDb.addSetting("ai_prompt", "old prompt", false);
    testDb.addSetting("ai_prompt", "identify the birds", true);
    testDb.addSetting("something_else", "ignored", true);

    testDb.addSetting("ai_image_model", "gemini-3.1-flash-lite-image", true);
    testDb.addSetting("ai_image_prompt", "draw {species}", true);

    const { getActiveSettings } = await loadDb();
    expect(getActiveSettings()).toEqual({
      aiModel: "gemini-2.5-flash",
      aiPrompt: "identify the birds",
      aiImageModel: "gemini-3.1-flash-lite-image",
      aiImagePrompt: "draw {species}",
    });
  });

  it("returns nulls when no active settings exist", async () => {
    testDb.addSetting("ai_model", "gemini-2.5-flash", false);

    const { getActiveSettings } = await loadDb();
    expect(getActiveSettings()).toEqual({ aiModel: null, aiPrompt: null, aiImageModel: null, aiImagePrompt: null });
  });
});

describe("getDailyImage", () => {
  it("returns null when no image has been generated for the date", async () => {
    testDb.addDailyImage("2026-07-08", ["Blue Jay"], "downloads/2026/7/8/daily-2026-07-08.png");

    const { getDailyImage } = await loadDb();
    expect(getDailyImage("2026-07-09")).toBeNull();
  });

  it("returns the image path and parsed species list", async () => {
    testDb.addDailyImage("2026-07-08", ["Blue Jay", "House Finch"], "downloads/2026/7/8/daily-2026-07-08.png");

    const { getDailyImage } = await loadDb();
    expect(getDailyImage("2026-07-08")).toEqual({
      date: "2026-07-08",
      imagePath: "downloads/2026/7/8/daily-2026-07-08.png",
      species: ["Blue Jay", "House Finch"],
    });
  });

  it("returns a null image path for a completed day with no known birds", async () => {
    testDb.addDailyImage("2026-07-08", [], null);

    const { getDailyImage } = await loadDb();
    expect(getDailyImage("2026-07-08")).toEqual({ date: "2026-07-08", imagePath: null, species: [] });
  });

  it("excludes dates before the retention cutoff day", async () => {
    vi.stubEnv("RETENTION_DAYS", "7");
    // Cutoff is 2026-07-03T17:00:00Z, i.e. July 3 in Chicago.
    testDb.addDailyImage("2026-07-02", ["Blue Jay"], "a.png");
    testDb.addDailyImage("2026-07-03", ["Blue Jay"], "b.png");

    const { getDailyImage } = await loadDb();
    expect(getDailyImage("2026-07-02")).toBeNull();
    expect(getDailyImage("2026-07-03")?.imagePath).toBe("b.png");
  });

  it("returns null when the database predates the daily_images table", async () => {
    testDb.db.exec("DROP TABLE daily_images");

    const { getDailyImage } = await loadDb();
    expect(getDailyImage("2026-07-08")).toBeNull();
  });
});

function ident(overrides: Partial<Identification> = {}): Identification {
  return {
    isBird: true,
    species: "northern cardinal",
    gender: null,
    count: 1,
    confidence: 0.9,
    nonBirdSpecies: null,
    model: "gemini-2.5-flash",
    ...overrides,
  };
}

function clip(createdAt: string, identifications: Identification[] = []): Clip {
  return { id: Date.parse(createdAt) / 1000, createdAt, thumbnailPath: "downloads/x.jpg", identifications };
}

let nextAudioId = 1;
function audio(detectedAt: string, overrides: Partial<AudioIdentification> = {}): AudioIdentification {
  return {
    id: nextAudioId++,
    detectedAt,
    species: "Northern Cardinal",
    scientificName: "Cardinalis cardinalis",
    confidence: 0.9,
    audioPath: null,
    speciesImagePath: null,
    ...overrides,
  };
}

describe("getDateSummary", () => {
  it("returns zeros and nulls for no data", async () => {
    const { getDateSummary } = await loadDb();
    expect(getDateSummary([], [])).toEqual({
      video: {
        clipCount: 0,
        birdCount: 0,
        nonBirdCount: 0,
        mostCommonBirds: [],
        busiestHour: null,
        uniqueSpeciesCount: 0,
      },
      audio: {
        detectionCount: 0,
        uniqueSpeciesCount: 0,
        mostCommonSpecies: [],
        busiestHour: null,
      },
    });
  });

  it("defaults audio identifications to an empty list", async () => {
    const { getDateSummary } = await loadDb();
    expect(getDateSummary([]).audio.detectionCount).toBe(0);
  });

  it("counts birds by identification count, defaulting a null count to 1", async () => {
    const { getDateSummary } = await loadDb();
    const summary = getDateSummary([
      clip("2026-07-04T13:00:00Z", [ident({ species: "house finch", count: 3 }), ident({ species: "blue jay", count: null })]),
      clip("2026-07-04T14:00:00Z", [ident({ species: "house finch", count: 1 })]),
    ]);

    expect(summary.video.clipCount).toBe(2);
    expect(summary.video.birdCount).toBe(5);
    expect(summary.video.mostCommonBirds).toEqual(["House Finch"]);
    expect(summary.video.uniqueSpeciesCount).toBe(2);
  });

  it("counts non-bird identifications once each, regardless of count", async () => {
    const { getDateSummary } = await loadDb();
    const summary = getDateSummary([
      clip("2026-07-04T13:00:00Z", [ident({ isBird: false, species: null, nonBirdSpecies: "squirrel", count: 2 })]),
      clip("2026-07-04T14:00:00Z", [ident({ isBird: false, species: null, nonBirdSpecies: null })]),
    ]);

    expect(summary.video.nonBirdCount).toBe(2);
    expect(summary.video.birdCount).toBe(0);
    expect(summary.video.mostCommonBirds).toEqual([]);
    expect(summary.video.uniqueSpeciesCount).toBe(0);
  });

  it("counts birds without a species toward the total but not toward species stats", async () => {
    const { getDateSummary } = await loadDb();
    const summary = getDateSummary([clip("2026-07-04T13:00:00Z", [ident({ species: null, count: 2 })])]);

    expect(summary.video.birdCount).toBe(2);
    expect(summary.video.mostCommonBirds).toEqual([]);
    expect(summary.video.uniqueSpeciesCount).toBe(0);
  });

  it("returns every species tied for most common", async () => {
    const { getDateSummary } = await loadDb();
    const summary = getDateSummary([
      clip("2026-07-04T13:00:00Z", [ident({ species: "house finch", count: 2 }), ident({ species: "blue jay", count: 2 })]),
      clip("2026-07-04T14:00:00Z", [ident({ species: "mourning dove", count: 1 })]),
    ]);

    expect(summary.video.mostCommonBirds).toEqual(["House Finch", "Blue Jay"]);
  });

  it("title-cases each word of the most common bird, leaving hyphenated parts lowercase", async () => {
    const { getDateSummary } = await loadDb();
    const summary = getDateSummary([clip("2026-07-04T13:00:00Z", [ident({ species: "black-capped chickadee" })])]);

    expect(summary.video.mostCommonBirds).toEqual(["Black-capped Chickadee"]);
  });

  it("excludes unknown birds and non-birds from the most common bird", async () => {
    const { getDateSummary } = await loadDb();
    const summary = getDateSummary([
      clip("2026-07-04T13:00:00Z", [ident({ species: "unknown", count: 5 }), ident({ species: "Unknown Bird", count: 4 })]),
      clip("2026-07-04T14:00:00Z", [ident({ isBird: false, species: null, nonBirdSpecies: "squirrel", count: 6 })]),
      clip("2026-07-04T15:00:00Z", [ident({ species: "house sparrow", count: 1 })]),
    ]);

    expect(summary.video.mostCommonBirds).toEqual(["House Sparrow"]);
    expect(summary.video.uniqueSpeciesCount).toBe(1);
  });

  it("has no most common bird when every bird is unknown", async () => {
    const { getDateSummary } = await loadDb();
    const summary = getDateSummary([clip("2026-07-04T13:00:00Z", [ident({ species: "unknown bird" })])]);

    expect(summary.video.mostCommonBirds).toEqual([]);
    expect(summary.video.uniqueSpeciesCount).toBe(0);
    expect(summary.video.birdCount).toBe(1);
  });

  it("counts clips with no identifications toward clipCount and busiest hour", async () => {
    const { getDateSummary } = await loadDb();
    const summary = getDateSummary([clip("2026-07-04T13:10:00Z"), clip("2026-07-04T13:50:00Z")]);

    expect(summary.video.clipCount).toBe(2);
    expect(summary.video.birdCount).toBe(0);
    expect(summary.video.busiestHour).toBe("8 AM – 9 AM");
  });

  it("summarizes audio detections", async () => {
    const { getDateSummary } = await loadDb();
    const summary = getDateSummary(
      [],
      [
        audio("2026-07-04T13:00:00Z", { species: "Northern Cardinal", scientificName: "Cardinalis cardinalis" }),
        audio("2026-07-04T13:20:00Z", { species: "Northern Cardinal", scientificName: "Cardinalis cardinalis" }),
        audio("2026-07-04T13:40:00Z", { species: "American Robin", scientificName: "Turdus migratorius" }),
        audio("2026-07-04T18:00:00Z", { species: null, scientificName: null }),
      ]
    );

    expect(summary.audio).toEqual({
      detectionCount: 4,
      uniqueSpeciesCount: 2,
      mostCommonSpecies: ["Northern Cardinal"],
      busiestHour: "8 AM – 9 AM",
    });
  });

  it("counts unique audio species by scientific name and most common by common name", async () => {
    const { getDateSummary } = await loadDb();
    const summary = getDateSummary(
      [],
      [
        audio("2026-07-04T13:00:00Z", { species: "Robin", scientificName: "Turdus migratorius" }),
        audio("2026-07-04T13:00:00Z", { species: "American Robin", scientificName: "Turdus migratorius" }),
      ]
    );

    expect(summary.audio.uniqueSpeciesCount).toBe(1);
    expect(summary.audio.mostCommonSpecies).toEqual(["Robin", "American Robin"]);
  });

  it("computes video and audio busiest hours independently", async () => {
    const { getDateSummary } = await loadDb();
    const summary = getDateSummary(
      [clip("2026-07-04T13:00:00Z")], // 8 AM CDT
      [audio("2026-07-04T22:00:00Z")] // 5 PM CDT
    );

    expect(summary.video.busiestHour).toBe("8 AM – 9 AM");
    expect(summary.audio.busiestHour).toBe("5 PM – 6 PM");
  });

  describe("busiest hour", () => {
    async function busiestHourOf(...timestamps: string[]) {
      const { getDateSummary } = await loadDb();
      return getDateSummary(timestamps.map((t) => clip(t))).video.busiestHour;
    }

    it("picks the hour with the most items, in Chicago time", async () => {
      expect(
        await busiestHourOf("2026-07-04T13:05:00Z", "2026-07-04T15:05:00Z", "2026-07-04T15:45:00Z")
      ).toBe("10 AM – 11 AM");
    });

    it("picks the first hour encountered on a tie", async () => {
      expect(await busiestHourOf("2026-07-04T20:00:00Z", "2026-07-04T13:00:00Z")).toBe("3 PM – 4 PM");
    });

    it.each([
      ["2026-07-04T05:30:00Z", "12 AM – 1 AM"],
      ["2026-07-04T16:30:00Z", "11 AM – 12 PM"],
      ["2026-07-04T17:30:00Z", "12 PM – 1 PM"],
      ["2026-07-05T04:30:00Z", "11 PM – 12 AM"],
    ])("formats %s as %s", async (timestamp, expected) => {
      expect(await busiestHourOf(timestamp)).toBe(expected);
    });

    it("uses Chicago time regardless of the process time zone", async () => {
      vi.stubEnv("TZ", "Asia/Tokyo");
      expect(await busiestHourOf("2026-07-04T13:00:00Z")).toBe("8 AM – 9 AM");
    });
  });
});

// Newer ICU versions may put a narrow no-break space (U+202F) before AM/PM.
function normalizeSpaces(s: string): string {
  return s.replace(/\s/g, " ");
}

describe("formatClipTime", () => {
  it.each([
    ["2026-07-04T12:05:00Z", "7:05 AM"],
    ["2026-07-04T23:45:00Z", "6:45 PM"],
    ["2026-07-05T05:00:00Z", "12:00 AM"],
    // January is CST (UTC-6).
    ["2026-01-15T18:30:00Z", "12:30 PM"],
  ])("formats %s as %s in Chicago time", async (iso, expected) => {
    const { formatClipTime } = await loadDb();
    expect(normalizeSpaces(formatClipTime(iso))).toBe(expected);
  });

  it("uses Chicago time regardless of the process time zone", async () => {
    vi.stubEnv("TZ", "Asia/Tokyo");
    const { formatClipTime } = await loadDb();
    expect(normalizeSpaces(formatClipTime("2026-07-04T12:05:00Z"))).toBe("7:05 AM");
  });
});

describe("formatDateHeading", () => {
  it.each(["UTC", "America/Chicago", "America/Los_Angeles", "Asia/Tokyo", "Pacific/Kiritimati", "Pacific/Pago_Pago"])(
    "formats a YYYY-MM-DD date as a long human date (TZ=%s)",
    async (tz) => {
      vi.stubEnv("TZ", tz);
      const { formatDateHeading } = await loadDb();
      expect(formatDateHeading("2026-07-04")).toBe("Saturday, July 4, 2026");
      expect(formatDateHeading("2026-01-01")).toBe("Thursday, January 1, 2026");
    }
  );
});

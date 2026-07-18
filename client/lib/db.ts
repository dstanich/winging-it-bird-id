import Database from "better-sqlite3";
import path from "path";

interface ClipRow {
  id: string;
  created_at: string;
  local_thumbnail_path: string;
  time_zone: string;
  is_bird: number | null;
  species: string | null;
  gender: string | null;
  count: number | null;
  confidence: string | null;
  non_bird_species: string | null;
  ai_model_id: number | null;
  ai_prompt_id: number | null;
  model: string | null;
}

export interface Identification {
  isBird: boolean;
  species: string | null;
  gender: string | null;
  count: number | null;
  confidence: string | null;
  nonBirdSpecies: string | null;
  model: string | null;
}

export interface Clip {
  id: string;
  createdAt: string;
  thumbnailPath: string;
  identifications: Identification[];
}

export interface DateGroup {
  date: string;
  clips: Clip[];
}

interface AudioIdentificationRow {
  id: number;
  detected_at: string;
  species: string | null;
  scientific_name: string | null;
  confidence: number | null;
  local_audio_path: string | null;
  species_image_path: string | null;
}

export interface AudioIdentification {
  id: number;
  detectedAt: string;
  species: string | null;
  scientificName: string | null;
  confidence: number | null;
  audioPath: string | null;
  speciesImagePath: string | null;
}

const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || "60", 10);
const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 1000 * 60 * 60 * 24).toISOString();

function getDb() {
  const dbPath = path.join(process.cwd(), "data", "bird-data.db");
  return new Database(dbPath, { readonly: true });
}

function toChicagoDate(isoString: string): string {
  // en-CA locale produces YYYY-MM-DD format, safe for use in URL paths
  return new Date(isoString).toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  });
}

function toHumanDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function buildClips(rows: ClipRow[]): Clip[] {
  const clipMap = new Map<string, Clip>();
  const clipOrder: string[] = [];

  for (const row of rows) {
    if (!clipMap.has(row.id)) {
      clipMap.set(row.id, {
        id: row.id,
        createdAt: row.created_at,
        thumbnailPath: row.local_thumbnail_path,
        identifications: [],
      });
      clipOrder.push(row.id);
    }

    if (row.is_bird !== null) {
      clipMap.get(row.id)!.identifications.push({
        isBird: row.is_bird === 1,
        species: row.species,
        gender: row.gender,
        count: row.count,
        confidence: row.confidence,
        nonBirdSpecies: row.non_bird_species,
        model: row.model,
      });
    }
  }

  return clipOrder.map((id) => clipMap.get(id)!);
}

export function getAvailableDates(): string[] {
  const db = getDb();

  const clipRows = db
    .prepare(`SELECT DISTINCT created_at as ts FROM clips WHERE created_at >= ?`)
    .all(cutoffIso) as { ts: string }[];
  const audioRows = db
    .prepare(`SELECT DISTINCT detected_at as ts FROM audio_identifications WHERE detected_at >= ?`)
    .all(cutoffIso) as { ts: string }[];

  db.close();

  const seen = new Set<string>();
  for (const row of [...clipRows, ...audioRows]) {
    seen.add(toChicagoDate(row.ts));
  }
  return [...seen].sort((a, b) => (a < b ? 1 : -1));
}

export function getClipsForDate(date: string): Clip[] {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT c.id, c.created_at, c.local_thumbnail_path, c.time_zone,
              i.is_bird, i.species, i.gender, i.count, i.confidence, i.non_bird_species,
              i.ai_model_id, i.ai_prompt_id, s.value as model
       FROM clips c
       LEFT JOIN identifications i ON c.id = i.clip_id
       LEFT JOIN settings s ON i.ai_model_id = s.id
       WHERE c.created_at >= ?
       ORDER BY c.created_at DESC`
    )
    .all(cutoffIso) as ClipRow[];

  db.close();

  const filtered = rows.filter((r) => toChicagoDate(r.created_at) === date);
  return buildClips(filtered);
}

export function getAudioIdentificationsForDate(date: string): AudioIdentification[] {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT a.id, a.detected_at, a.species, a.scientific_name, a.confidence, a.local_audio_path,
              s.local_path as species_image_path
       FROM audio_identifications a
       LEFT JOIN species_images s ON a.species_image_id = s.id
       WHERE a.detected_at >= ?
       ORDER BY a.detected_at DESC`
    )
    .all(cutoffIso) as AudioIdentificationRow[];

  db.close();

  return rows
    .filter((r) => toChicagoDate(r.detected_at) === date)
    .map((r) => ({
      id: r.id,
      detectedAt: r.detected_at,
      species: r.species,
      scientificName: r.scientific_name,
      confidence: r.confidence,
      audioPath: r.local_audio_path,
      speciesImagePath: r.species_image_path,
    }));
}

export interface DateSummary {
  clipCount: number;
  birdCount: number;
  nonBirdCount: number;
  squirrelVisits: number;
  mostCommonBirds: string[];
  busiestHour: string | null;
  audioDetectionCount: number;
  uniqueSpeciesHeard: number;
}

export function getDateSummary(clips: Clip[], audioIdentifications: AudioIdentification[] = []): DateSummary {
  let birdCount = 0;
  let nonBirdCount = 0;
  let squirrelVisits = 0;
  const speciesCounts = new Map<string, number>();

  for (const clip of clips) {
    for (const ident of clip.identifications) {
      if (ident.isBird) {
        const count = ident.count ?? 1;
        birdCount += count;
        if (ident.species) {
          speciesCounts.set(ident.species, (speciesCounts.get(ident.species) ?? 0) + count);
        }
      } else {
        nonBirdCount++;
        if (ident.nonBirdSpecies?.toLowerCase().includes("squirrel")) {
          squirrelVisits++;
        }
      }
    }
  }

  let mostCommonBirds: string[] = [];

  if (speciesCounts.size > 0) {
    const maxCount = Math.max(...speciesCounts.values());
    mostCommonBirds = [...speciesCounts.entries()].filter(([, c]) => c === maxCount).map(([s]) => s);
  }

  // Find the busiest hour by bucketing clips into Chicago-time hours
  let busiestHour: string | null = null;
  if (clips.length > 0) {
    const hourCounts = new Map<number, number>();
    for (const clip of clips) {
      const hour = parseInt(
        new Date(clip.createdAt).toLocaleTimeString("en-US", {
          timeZone: "America/Chicago",
          hour: "numeric",
          hour12: false,
        }),
        10
      );
      hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
    }
    const maxCount = Math.max(...hourCounts.values());
    const peakHour = [...hourCounts.entries()].find(([, c]) => c === maxCount)![0];

    const fmt = (h: number) => {
      const suffix = h < 12 || h === 24 ? "AM" : "PM";
      const display = h === 0 || h === 24 ? 12 : h > 12 ? h - 12 : h;
      return `${display} ${suffix}`;
    };
    busiestHour = `${fmt(peakHour)} – ${fmt(peakHour + 1)}`;
  }

  const uniqueSpeciesHeard = new Set(
    audioIdentifications.map((a) => a.scientificName).filter((s): s is string => s != null)
  ).size;

  return {
    clipCount: clips.length,
    birdCount,
    nonBirdCount,
    squirrelVisits,
    mostCommonBirds,
    busiestHour,
    audioDetectionCount: audioIdentifications.length,
    uniqueSpeciesHeard,
  };
}

export function formatClipTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface ActiveSettings {
  aiModel: string | null;
  aiPrompt: string | null;
}

export function getActiveSettings(): ActiveSettings {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT name, value FROM settings WHERE is_active = 1 AND name IN ('ai_model', 'ai_prompt')`
    )
    .all() as { name: string; value: string }[];

  db.close();

  let aiModel: string | null = null;
  let aiPrompt: string | null = null;

  for (const row of rows) {
    if (row.name === "ai_model") aiModel = row.value;
    if (row.name === "ai_prompt") aiPrompt = row.value;
  }

  return { aiModel, aiPrompt };
}

export function formatDateHeading(date: string): string {
  return toHumanDate(date + "T12:00:00");
}

# AGENTS.md

This file provides guidance to AI agents such as Claude Code and GitHub Copilot when working with code in this repository. `CLAUDE.md` just imports this file — edit this one.

## Project Overview

Hobby project that runs a local FTP server for a Reolink camera (pointed at a bird feeder) to push recorded clips to, identifies bird species in each clip using Google Gemini AI, and logs results. It also optionally syncs audio-based species detections from a self-hosted BirdNET-Go instance, independent of the video clips. A Next.js frontend is statically exported and published to S3/CloudFront (live at https://winging-it.org). Monorepo with a Node.js backend (`server/`) and a Next.js frontend (`client/`).

## Repository Structure

```
├── server/                        # Node.js orchestration + local FTP ingestion
│   ├── index.js                   # Main entry point: starts FTP listener + periodic processing loop
│   ├── lib/
│   │   ├── ai-provider.js         # Gemini AI integration; exports DEFAULT_PROMPT / DEFAULT_MODEL
│   │   ├── birdnet-provider.js    # BirdNET-Go audio detection sync (optional, independent of clips)
│   │   ├── clip-processing.js     # applyCooldown() filter + processClips() AI pass, used by the main loop
│   │   ├── ftp-listener.js        # FTP server (ftp-srv) the camera pushes clips to
│   │   ├── ftp-clips.js           # Scans uploads, parses filenames, extracts thumbnails (ffmpeg)
│   │   ├── seed-uploads.js        # Local testing: turns test-birds/images photos into Reolink-named videos in UPLOAD_DIR
│   │   ├── retention.js           # Prunes clips/identifications/audio identifications/download dirs older than RETENTION_DAYS
│   │   ├── storage.js             # Storage facade (JSDoc'd interface)
│   │   └── sqlite-storage.js      # SQLite implementation: schema, seeding, migrations, queries
│   ├── scripts/seed-uploads.js    # CLI for lib/seed-uploads.js (npm run seed:uploads)
│   ├── test/                      # Vitest suite: one *.test.js per lib/ module, plus setup.js + helpers.js
│   ├── vitest.config.js
│   ├── data/bird-data.db          # SQLite database (git-ignored)
│   ├── uploads/                   # Raw video files pushed by the camera via FTP (deleted after processing)
│   ├── downloads/                 # Thumbnails: YYYY/M/D/{clip-id}.jpg; audio clips: YYYY/M/D/audio-{detection-id}.wav; species clipart cache: species/{scientific-name-slug}.jpg
│   ├── .env.example
│   └── Dockerfile
├── client/                        # Next.js static frontend
│   ├── app/
│   │   ├── layout.tsx             # Root layout (Geist fonts, favicons, optional Cloudflare Analytics)
│   │   ├── page.tsx               # Home: intro, 8 most recent dates, link to /all-dates
│   │   ├── all-dates/page.tsx     # Full list of available dates
│   │   ├── settings/page.tsx      # Shows current active AI model/prompt
│   │   └── [date]/
│   │       ├── page.tsx           # Date detail: summary (video + audio stats) + combined feed
│   │       └── clip-grid.tsx      # Client component: merged video/audio feed, video/audio toggles, non-bird filter, time/species sort, image lightbox
│   ├── lib/
│   │   ├── db.ts                  # SQLite queries (build-time only)
│   │   ├── links.ts               # pageHref(): internal link helper for S3-compatible URLs
│   │   └── species.ts             # isUnknownSpecies()/isKnownSpecies()/toTitleCase(): browser-safe, shared by db.ts and clip-grid.tsx
│   ├── test/                      # Vitest suite: db, links, species, clip-grid tests, plus setup.ts + helpers.ts
│   ├── vitest.config.mts
│   ├── public/
│   │   ├── images/                # Logo, favicons, GitHub mark, feeder photo
│   │   └── downloads/             # Server's downloads/ dir must be available here (git-ignored; locally a symlink → ../../server/downloads you create yourself; volume mount in Docker)
│   ├── data/                      # Committed symlink → ../server/data (so client/data/bird-data.db is the server's DB)
│   ├── scripts/scheduled-publish/ # S3 deploy script (own package.json): build + upload + CloudFront invalidation, every 5h
│   ├── .env.example
│   └── Dockerfile                 # Container for scheduled S3 publishing
├── test-birds/                    # Committed test media from the real feeder: images/ (bird photos + non*.jpg non-bird photos for seed:uploads), audio/ (wav clips)
├── .claude/
│   ├── settings.json              # Shared Claude Code permissions (npm lint/build/install/ci + read-only git/sqlite allowed; .env reads denied)
│   └── launch.json                # Claude Code preview config: client dev server on :3000
├── docker-compose.yml             # Production deploy: server + publish containers, external named volumes, env from server/.env + client/.env
├── .nvmrc                         # lts/krypton (Node 24) for local dev; Docker images use node:20
├── README.md                      # Human-facing setup docs (keep in sync with this file)
├── CLAUDE.md                      # Just `@./AGENTS.md`
└── AGENTS.md
```

## Keeping These Docs Current (required)

Any change that alters what this file describes **must update `AGENTS.md` in the same change** — don't wait to be asked. That includes: adding/removing/renaming files or routes, new env vars or defaults, schema changes, changes to the processing loop or sync behavior, new commands/scripts, Docker changes, and new conventions. Also update `README.md` (human setup docs) and the relevant `.env.example` when setup or configuration changes. `CLAUDE.md` only imports this file, so it never needs separate edits. Before finishing a task, re-read the affected sections here and confirm they still match the code.

There is no root-level `package.json` — `server/`, `client/`, and `client/scripts/scheduled-publish/` each manage their own dependencies.

## Commands

### Server (`cd server`)

```bash
npm start                  # node index.js: starts the FTP listener, runs an initial check, then loops every CHECK_INTERVAL
npm test                   # vitest run: the server test suite (npm run test:watch for watch mode)
npm run seed:uploads       # Put 5 bird + 1 non-bird test clips in UPLOAD_DIR (`-- <n>` for n bird clips); see "Test clips" below
```

### Client (`cd client`)

```bash
npm run dev                # Next.js dev server on http://localhost:3000 (no .env needed)
npm run build              # Static export build (outputs to client/out/)
npm run lint               # ESLint (eslint-config-next core-web-vitals + typescript)
npm test                   # vitest run: the client test suite (npm run test:watch for watch mode)
```

### Scheduled publish (`cd client/scripts/scheduled-publish`)

```bash
npm start                  # Build + publish immediately, then repeat every 5 hours (needs S3/AWS env vars)
```

The server and client each have a Vitest suite (`server/test/`, `client/test/`); the publish script has no tests, and the server has no linter. Verify server changes with `npm test` (add/update tests alongside behavior changes) and, for loop/FTP wiring in `index.js`, by running `npm start` against a scratch `DATA_DIR`; verify client changes with `npm test`, `npm run lint`, and `npm run build` (add/update tests alongside changes to `lib/` or `clip-grid.tsx`).

### Test clips (no camera)

`npm run seed:uploads [-- <count>]` (`scripts/seed-uploads.js` → `lib/seed-uploads.js`) picks `count` (default 5) random bird photos from `test-birds/images/` plus `max(1, floor(count / 3))` non-bird photos (filenames starting with `non`, e.g. `nonbird.jpg`; extra on top of `count`, skipped with a warning if none exist), shuffles them together, and encodes each as a 3-second still MP4 named `[CAMERA_NAME]_00_[YYYYMMDDHHMMSS].mp4` in `UPLOAD_DIR`. Within each pool, no photo repeats until every one has been used, then rounds are reshuffled. Timestamps end at "now" and step back by `max(300, VIDEO_COOLDOWN_SECONDS + 60)` seconds so the cooldown keeps them all. Files are written as `*.partial` and renamed, so a running server never sees half-written videos. The next tick processes them for real (Gemini calls included).

### Server tests

- **Vitest 4** (not 5: Vitest 5 requires Node 22+, and the server Docker image is `node:20`). Config in `server/vitest.config.js`; `restoreMocks`, `unstubEnvs`, and `unstubGlobals` are on, so `vi.spyOn`/`vi.stubEnv`/`vi.stubGlobal` reset between tests.
- `test/setup.js` silences `console.log/warn/error` with spies before each test; assert on `console.*` to check logging.
- `test/helpers.js`: `useTempDirs()` returns a temp-dir factory with automatic per-test cleanup; `reolinkTimestamp(date)` builds Reolink-style `YYYYMMDDHHMMSS` local-time strings.
- Tests never touch real data or services: SQLite tests point `DATA_DIR` at a temp dir via `vi.stubEnv`; `@google/genai` and `ftp-srv` are replaced with `vi.mock`; BirdNET-Go is a stubbed global `fetch` router. `ftp-clips` tests generate a real 2-second video with the bundled `ffmpeg-static` binary and extract real thumbnails.
- Time-dependent tests use `vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime()`; time-zone tests use `vi.stubEnv('TZ', ...)` (Node picks up `TZ` changes at runtime).
- `test/storage.test.js` fails if a `Storage` facade method is missing from `SQLiteStorage` or from its delegation-args table, enforcing the "add to both" rule below.
- `seed-uploads` tests encode tiny ffmpeg-generated JPEGs and run the output through `discoverNewClips()` to confirm the filenames and videos are accepted.
- `index.js` itself is not unit-tested (it starts the FTP server on import); keep testable logic in `lib/` modules.

### Client tests

- **Vitest 4** + React Testing Library + `@testing-library/user-event`. Config in `client/vitest.config.mts` (maps the `@/` alias; `restoreMocks`/`unstubEnvs`/`unstubGlobals` on). Default environment is `node`; `clip-grid.test.tsx` opts into jsdom with a `// @vitest-environment jsdom` docblock and calls RTL `cleanup` itself (globals are off). `test/setup.ts` registers jest-dom matchers.
- `test/helpers.ts`: `createTempDirFactory()` (temp dirs with per-test cleanup — not named `use*`, which would trip the React hooks lint rule) and `createTestDb(dir)`, which creates `<dir>/data/bird-data.db` with a copy of the server schema plus insert helpers. **If the server schema changes in a way the client queries, update this copy.**
- `lib/db.ts` computes its retention cutoff at import time and opens `process.cwd()/data/bird-data.db`, so `db.test.ts` fakes `Date`, spies `process.cwd()` to the temp dir, and re-imports the module per test (`vi.resetModules()` + dynamic import) after stubbing env like `RETENTION_DAYS`/`TZ`.
- The pages and the scheduled-publish script are untested.

## Architecture

### Server

- **Main loop** (`server/index.js`) — `initializeApp()` creates `DOWNLOAD_DIR`/`UPLOAD_DIR`, the `Storage`, `AIProvider`, and (if enabled) `BirdNetProvider`. Then it starts the FTP listener, runs one check immediately, and schedules `triggerCheck()` every `CHECK_INTERVAL` ms (code default 10 min; `.env.example` uses 2 h). `triggerCheck()` is guarded by an `isProcessing` flag so a slow run (due to `PROCESS_DELAY` throttling) never overlaps the next. Each tick, in order:
  1. `pruneOldData()` — retention (below)
  2. `birdnetProvider.syncDetections()` — if enabled
  3. `discoverNewClips()` — scan uploads, extract thumbnails
  4. `applyCooldown()` (`lib/clip-processing.js`) — if `VIDEO_COOLDOWN_SECONDS` > 0, sorts clips chronologically and discards any whose timestamp falls within that window *after* the later of an earlier clip kept in this batch and the newest stored clip (`storage.getMostRecentClipTimestamp()`, only if at or before it), deleting their video + thumbnail immediately without calling the AI. Avoids burning API calls on motion-triggered bursts of near-duplicate clips. Clips *older* than the stored timestamp (retries of a failed clip, late backlog uploads) are not measured against it, so they aren't discarded (nor checked against older stored clips).
  5. `processClips()` (`lib/clip-processing.js`) — sends each thumbnail to Gemini, waiting `PROCESS_DELAY` ms (default 30s) after each call, including failed ones (often rate limits)
  6. Stores successful clips, then deletes their uploaded videos. Failed clips keep their video and are retried next tick.
  Each step's errors are caught and logged so one failure doesn't kill the loop.
- **FTP listener** (`server/lib/ftp-listener.js`) — always-on `ftp-srv` server on `FTP_HOST:FTP_PORT` with the upload dir as FTP root. Anonymous login is disabled; if `FTP_USERNAME` is set, credentials must match, otherwise any login is accepted. Pure plumbing — no clip/AI logic.
- **Clip discovery** (`server/lib/ftp-clips.js`) — walks `UPLOAD_DIR` (plus one level of subdirectories) for `mp4/264/265/h264/h265` files, parses Reolink's FTP filename convention `[Camera]_[Channel]_[YYYYMMDDHHMMSS].ext` (timestamp interpreted in the **server's local time zone**; falls back to file mtime + `CAMERA_NAME` if unmatched). **Clip ID = recording time in Unix seconds**, which is also the dedupe key: uploads whose ID is already in `storage.data()`, or that repeat an ID already yielding a clip in the same scan (e.g. two channels in the same second), are skipped and their video deleted. Extracts a JPEG frame at the 1-second mark via `ffmpeg-static`/`fluent-ffmpeg` (fixed offset, because `ffmpeg-static` doesn't bundle `ffprobe`), skipping extraction if the thumbnail already exists.
- **AI provider** (`server/lib/ai-provider.js`) — sends the base64 JPEG plus the active prompt to Gemini via `@google/genai` (default model `gemini-2.5-flash`), parses the JSON response, and tags each result (a single object is tagged too, but returned as-is; `addClip()` wraps it in an array) with the `ai_model_id`/`ai_prompt_id` settings row IDs used. A clip can produce multiple identification rows (one per species).
- **BirdNET-Go provider** (`server/lib/birdnet-provider.js`) — optional (`BIRDNET_ENABLED=true` *and* `BIRDNET_GO_URL`). Pages through `GET /api/v2/detections` (newest-first, 100 per page), stopping at the last synced `birdnet_detection_id` or the `BIRDNET_LOOKBACK_HOURS` cutoff. Detections at or above `BIRDNET_MIN_CONFIDENCE` are persisted: the audio clip is downloaded (`GET /api/v2/audio/{id}`) into the dated `downloads/YYYY/M/D/` tree, and a per-species clipart image is downloaded once (`GET /api/v2/media/species-image?name={scientificName}`) and reused for every future detection of that species. Audio identifications are **not** correlated to video clips — they're an independent record stream keyed by BirdNET-Go's own detection ID.
- **Retention** (`server/lib/retention.js`) — deletes clips + identifications (by `created_at`) and audio identifications (by `detected_at`, compared via SQLite `julianday()` since BirdNET-Go timestamps carry a UTC offset) older than `RETENTION_DAYS`, then removes `downloads/YYYY/M/D/` directories older than the cutoff day (and empty month/year dirs). `downloads/species/` is never pruned — it's a small persistent per-species cache.
- **Storage** (`server/lib/storage.js` → `server/lib/sqlite-storage.js`) — facade over a swappable provider. The SQLite provider uses `better-sqlite3` with WAL mode and foreign keys on, creates the schema with `CREATE TABLE IF NOT EXISTS`, seeds default `ai_prompt`/`ai_model` settings on first run, and runs an in-place migration for the legacy `identifications.model` column. `commit()` is a no-op (writes are immediate). New storage methods must be added to both the facade and the SQLite provider.

### Client

- **Next.js 16 + React 19** with App Router, TypeScript, and Tailwind CSS v4.
- **Static export** — `next.config.ts` sets `output: "export"`, `trailingSlash: true`, and `outputFileTracingRoot` to the repo root so the `client/data` symlink resolves. All pages are server components rendered at build time; `[date]` uses `generateStaticParams()` from `getAvailableDates()`.
- **Routes:** `/` (intro + 8 most recent dates), `/all-dates/`, `/[date]/` (summary + combined feed), `/settings/` (active AI model/prompt).
- **Internal links** — use `pageHref()` from `client/lib/links.ts` for links between pages: it emits `/path/index.html` in production (S3 has no directory-index rewriting) and `/path/` in dev.
- **Combined feed** (`client/app/[date]/clip-grid.tsx`, the only client component) — merges video clips and BirdNET-Go audio identifications into one feed, newest first. Two independent "Show:" toggle chips (filled with a checkmark when on, dashed outline when off; `aria-pressed`) show/hide video and audio items. By default only items with an identified bird species are shown: clips need at least one `isBird` identification whose species passes `isKnownSpecies()` (not null/blank, not "unknown"/"unidentified"), and audio items need a known species. An "Include non-birds & unidentified birds" checkbox (off by default) shows everything; the item count notes how many items are hidden by this filter (counting only the media types currently shown). A "Sort by" dropdown switches between time (default, newest first) and species: alphabetical, case-insensitive (the AI stores lowercase names, BirdNET-Go doesn't), using a clip's first known bird identification, with items lacking a known bird species last and newest first within a species. Species names on cards (and image alt text) are title-cased via `toTitleCase()` ("house sparrow" → "House Sparrow"). Video cards show the thumbnail, each identification (species/gender/count/confidence, or the non-bird label in red), and the AI model. Audio cards show the cached species clipart (or a 🐦 fallback), species/confidence, and an inline `<audio>` player. Clicking a thumbnail or species image opens a lightbox modal (closable via click-outside, ×, or Escape). Formatted times are computed server-side and passed in as `clipTimes`/`audioTimes` maps to avoid hydration timezone mismatches.
- **Media paths** — the DB stores paths like `downloads/2026/7/4/1751652000.jpg` (relative to the server's working dir), and the client renders them as `/${path}`. So the server's `downloads/` directory must be exposed at `client/public/downloads/` (Docker volume mount in production); the publish script also copies `public/downloads` into `out/` explicitly.
- **Species helpers** (`client/lib/species.ts`) — `isUnknownSpecies()`/`isKnownSpecies()`/`toTitleCase()` live here rather than in `db.ts` because `db.ts` imports `better-sqlite3` and can't be bundled into the client component.
- **Data access** (`client/lib/db.ts`) — opens the SQLite DB read-only via `better-sqlite3` at build time, a fresh connection per query. Only rows newer than `RETENTION_DAYS` (default 60) are included. `getAvailableDates` unions dates from `clips` and `audio_identifications`; `getClipsForDate` joins identifications (ordered by `identifications.id` within a clip, so the first is the earliest-stored) and the model setting; `getAudioIdentificationsForDate` joins `species_images`. BirdNET-Go's `detected_at` carries a UTC offset (e.g. `-05:00`), so audio retention and ordering compare via SQLite `julianday()` rather than as strings; `getDateSummary` computes video (clips, birds, non-birds, most common — known bird species only, excluding non-birds and "unknown"/"unidentified" species, title-cased for display — busiest hour, unique species, which likewise excludes unknown species) and audio (detections, species heard, most common, busiest hour) stats; `getActiveSettings` backs the settings page. **All date bucketing and time display use the `America/Chicago` timezone**; dates are formatted with the `en-CA` locale to get `YYYY-MM-DD` URL paths. `formatDateHeading` anchors `YYYY-MM-DD` dates at UTC noon so the host time zone can't shift the day. Filtering by date happens in JS after the query, not in SQL.
- **Scheduled publishing** (`client/scripts/scheduled-publish/index.js`) — loop (immediately, then every 5 hours): `npm run build`, copy `public/downloads` into `out/`, upload changed files to S3 (skips unchanged via ETag/MD5 compare), delete S3 objects no longer in the build (skipped if fewer than 10 local files, guarding against a broken build wiping the bucket), then invalidate CloudFront `/*` if anything changed.

### Database Schema

**clips** — `id` (PK, Unix seconds of recording time), `created_at`, `updated_at`, `device_name`, `network_name` (`'Reolink FTP'`), `type` (`'recording'`), `source` (`'ftp'`), `thumbnail`, `media` (original filename), `time_zone`, `local_thumbnail_path`. Index on `created_at`.

**identifications** — `id` (autoincrement PK), `clip_id` (FK → clips), `is_bird`, `species` (lowercase common name), `gender`, `count`, `confidence`, `non_bird_species`, `ai_model_id` (FK → settings), `ai_prompt_id` (FK → settings). Index on `species`.

**audio_identifications** — `id` (autoincrement PK), `birdnet_detection_id` (unique, BirdNET-Go's own detection ID — dedupe/sync cursor key), `species`, `scientific_name`, `species_code`, `confidence`, `verified`, `source`, `detected_at`, `begin_time`, `end_time`, `local_audio_path`, `species_image_id` (FK → species_images), `created_at`. Indexes on `scientific_name`, `detected_at`. Not linked to `clips`.

**species_images** — `id` (autoincrement PK), `scientific_name` (unique — reuse key), `common_name`, `local_path`, `created_at`. One clipart image per species, fetched from BirdNET-Go once and referenced by every matching `audio_identifications` row.

**settings** — `id` (autoincrement PK), `name`, `value`, `is_active` (boolean). Index on `name`. Used for `ai_model` and `ai_prompt`. Settings are versioned: identifications reference the exact row used, so to change the model/prompt insert a new row and flip `is_active` rather than editing an existing row's `value`.

Schema changes go in `SQLiteStorage._createSchema()`; existing databases need an explicit migration (see `_migrateIdentifications()` for the pattern), since `CREATE TABLE IF NOT EXISTS` won't add columns. Update the client's row interfaces in `client/lib/db.ts` to match.

## Configuration

Environment config via `.env` in each directory (see each `.env.example`):

- **Server** — `GOOGLE_API_KEY`, `PROCESS_DELAY`; `CAMERA_NAME`, `CHECK_INTERVAL`, `DATA_DIR`, `DOWNLOAD_DIR`, `RETENTION_DAYS`, `VIDEO_COOLDOWN_SECONDS`; `UPLOAD_DIR`, `FTP_HOST`, `FTP_PORT`, `FTP_USERNAME`, `FTP_PASSWORD`, `FTP_PASV_URL`, `FTP_PASV_MIN`, `FTP_PASV_MAX`; `BIRDNET_ENABLED`, `BIRDNET_GO_URL`, `BIRDNET_MIN_CONFIDENCE`, `BIRDNET_LOOKBACK_HOURS`. `FTP_PASV_URL` must be the LAN IP of the host running the server (required for passive-mode transfers). `DOWNLOAD_DIR` has no code default (unlike `DATA_DIR` → `./data` and `UPLOAD_DIR` → `./uploads`), so `initializeApp()` throws if it's unset — keep it in `.env`.
- **Client / publish** — `SCHEDULED_PUBLISH_CLIENT_DIR`, `SCHEDULED_PUBLISH_S3_BUCKET`, `SCHEDULED_PUBLISH_S3_PREFIX`, `SCHEDULED_PUBLISH_CLOUDFRONT_DISTRIBUTION_ID`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION`, `RETENTION_DAYS`, `CLOUDFLARE_ANALYTICS_TOKEN`.

When adding an env var, update the relevant `.env.example`, the README, and this file.

## Key Conventions

- Server is plain JavaScript ES modules (`"type": "module"`), JSDoc for documentation, 2-space indent in `index.js`/`lib/ftp-*.js`/`birdnet-provider.js`/`clip-processing.js`/`seed-uploads.js`/`scripts/`/`test/` and 4-space in `storage.js`/`sqlite-storage.js`/`ai-provider.js`/`retention.js` — match the file you're editing.
- Uses the `fileURLToPath` pattern for a `__dirname` equivalent in ES module code.
- Server logs to stdout with `console.log`/`console.error`; `✓` prefixes successful steps.
- Camera pushes clips via FTP; no camera polling or cloud auth.
- Uploaded videos are deleted once successfully processed into a thumbnail + DB row (or when discarded by the cooldown, or found to be duplicates); downloads organized by date: `server/downloads/YYYY/M/D/` (month/day not zero-padded).
- BirdNET-Go audio sync is optional and entirely separate from FTP/video processing.
- Client: Tailwind utility classes with `dark:` variants for every color (dark mode is supported everywhere); zinc palette, blue-600/blue-400 links. Path alias `@/*` → `client/`. Plain `<img>`/`<a>` tags are used deliberately (static export, no image optimization).
- Server Dockerfile: `node:20-slim` + build tools for `better-sqlite3`; `npm ci --omit=dev` (no test tooling in the image; `package.json` `engines` requires Node >= 20.19); declares volumes for `data/` and `downloads/` (`uploads/` isn't declared in the Dockerfile but is mounted by compose so failed clips survive recreates); exposes FTP control port `2121` and passive port range `30100-30110`.
- Client Dockerfile: `node:20`; installs client + scheduled-publish deps, runs the publish script; volumes `/app/data` (DB) and `/app/public/downloads` (media).
- Deployment: root `docker-compose.yml` runs both containers on one host (`git pull && docker compose up -d --build`). Env comes from `server/.env`/`client/.env` via `env_file` at container creation (`.dockerignore` keeps `.env` out of images), so `.env` edits only need `docker compose up -d`, not a rebuild. Volumes `birdid-data`, `birdid-downloads`, `birdid-uploads` are `external: true` (created once with `docker volume create`; compose never deletes them) Both services set `TZ=America/Chicago` in the compose file — the server needs it because Reolink filename timestamps are parsed in local time (the image defaults to UTC). The publish container mounts `birdid-data` read-write because WAL-mode SQLite readers write the `-shm` file. FTP port mappings are hard-coded and must match `FTP_PORT`/`FTP_PASV_MIN`/`FTP_PASV_MAX`.
- Commit messages follow Conventional Commits with a scope, e.g. `fix(server): ...`, `feat(client): ...`, `docs: ...`, `chore: ...`.
- When behavior changes, keep `README.md` and this file in sync (see "Keeping These Docs Current" above).

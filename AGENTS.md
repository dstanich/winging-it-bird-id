# AGENTS.md

This file and its companion files — [`server/AGENTS.md`](server/AGENTS.md) and [`client/AGENTS.md`](client/AGENTS.md) — provide guidance to AI agents (such as Antigravity, Claude Code, and GitHub Copilot) when working in this repository. `CLAUDE.md` imports all three files.

- **Root `AGENTS.md` (this file):** Project overview, repository structure, doc-maintenance rules, commands, CI, database schema, Docker/deployment, and repo-wide conventions.
- **[`server/AGENTS.md`](server/AGENTS.md):** Server architecture (main loop, FTP, clip discovery, Gemini AI, daily image, BirdNET-Go, retention, storage), test-clip seeding, server test suite, server `.env` config, and server code conventions. **Read before working in `server/`.**
- **[`client/AGENTS.md`](client/AGENTS.md):** Client architecture (Next.js static export, routes, components, build-time SQLite queries/caching, scheduled S3 publishing), client test suite, client `.env` config, and client code conventions. **Read before working in `client/`.**

## Project Overview

Hobby project that runs a local FTP server for a Reolink camera (pointed at a bird feeder) to push recorded clips to, identifies bird species in each clip using Google Gemini AI, and logs results. Once each day is complete it generates an AI "species of the day" image of that day's birds. It also optionally syncs audio-based species detections from a self-hosted BirdNET-Go instance, independent of the video clips. A Next.js frontend is statically exported and published to S3/CloudFront (live at https://winging-it.org). Monorepo with a TypeScript Node.js backend (`server/`) and a Next.js frontend (`client/`).

## Repository Structure

```
├── server/                        # Node.js orchestration + local FTP ingestion
│   ├── AGENTS.md                  # Server architecture, tests, env vars, and conventions
│   ├── index.ts                   # Main entry point: starts FTP listener + periodic processing loop
│   ├── lib/
│   │   ├── ai-provider.ts         # Gemini AI integration (identification + image generation); exports DEFAULT_PROMPT / DEFAULT_MODEL / DEFAULT_IMAGE_PROMPT / DEFAULT_IMAGE_MODEL
│   │   ├── birdnet-provider.ts    # BirdNET-Go audio detection sync (optional, independent of clips)
│   │   ├── clip-processing.ts     # applyCooldown() filter + processClips() AI pass, used by the main loop
│   │   ├── daily-image.ts         # generateDailyImages(): per-day AI species illustration once a day is complete
│   │   ├── ftp-listener.ts        # FTP server (ftp-srv) the camera pushes clips to
│   │   ├── ftp-clips.ts           # Scans uploads, parses filenames, extracts thumbnails (ffmpeg)
│   │   ├── ffmpeg-path.ts         # FFMPEG_PATH: the ffmpeg-static binary path, typed as a string (works around its mismatched types)
│   │   ├── seed-local-db.ts       # Local offline testing: seeds SQLite DB + downloads/ from test-birds/ across multiple days
│   │   ├── seed-local-uploads.ts  # Local testing: turns test-birds/images photos into Reolink-named videos in UPLOAD_DIR
│   │   ├── retention.ts           # Prunes clips/identifications/audio identifications/daily images/download dirs older than RETENTION_DAYS
│   │   ├── storage.ts             # Storage facade, implements StorageProvider
│   │   ├── sqlite-storage.ts      # SQLite implementation (implements StorageProvider): schema, seeding, migrations, queries
│   │   └── types.ts               # Shared types: DB row shapes, Clip/DiscoveredClip, BirdIdentification, StorageProvider interface
│   ├── scripts/seed-local-db.ts   # CLI for lib/seed-local-db.ts (npm run seed:local-db)
│   ├── scripts/seed-local-uploads.ts  # CLI for lib/seed-local-uploads.ts (npm run seed:local-uploads)
│   ├── scripts/seed-ci-db.ts      # CI: creates DATA_DIR/bird-data.db with the real schema + fake rows so the client can build
│   ├── test/                      # Vitest suite: one *.test.ts per lib/ module, plus setup.ts + helpers.ts
│   ├── vitest.config.ts
│   ├── tsconfig.json              # Type-check only (noEmit, erasableSyntaxOnly); Node runs the .ts files directly
│   ├── data/bird-data.db          # SQLite database (git-ignored)
│   ├── uploads/                   # Raw video files pushed by the camera via FTP (deleted after processing)
│   ├── downloads/                 # Thumbnails: YYYY/M/D/{clip-id}.jpg; audio clips: YYYY/M/D/audio-{detection-id}.wav; daily images: YYYY/M/D/daily-YYYY-MM-DD.png; species clipart cache: species/{scientific-name-slug}.jpg
│   ├── .env.example
│   └── Dockerfile
├── client/                        # Next.js static frontend
│   ├── AGENTS.md                  # Client architecture, tests, env vars, and conventions
│   ├── app/
│   │   ├── layout.tsx             # Root layout (Geist fonts, favicons, page background, SiteHeader on every page, optional Cloudflare Analytics)
│   │   ├── page.tsx               # Home: intro (feeder photo in a LightboxLink modal), date cards for the 8 most recent dates, link to /all-dates
│   │   ├── all-dates/page.tsx     # Date cards for every available date
│   │   ├── settings/page.tsx      # Two cards: active identification model/prompt and daily image model/prompt
│   │   └── [date]/
│   │       ├── page.tsx           # Date detail: summary (video + audio stats + daily AI image / PENDING placeholder) + combined feed
│   │       └── clip-grid.tsx      # Client component: merged video/audio feed, unified filter/sort toolbar, active filter pills, image lightbox
│   ├── components/                # Shared across routes
│   │   ├── lightbox.tsx           # Client components: Lightbox image modal (portaled to <body>) + ZoomableImage (image that opens itself) + LightboxLink (inline link-styled text that opens an image)
│   │   ├── site-header.tsx        # Server component: sticky site-wide header bar (logo + title → home, GitHub icon), rendered by layout.tsx
│   │   ├── date-card-grid.tsx     # Server component: responsive date cards (daily image or placeholder + clip/species/song stats), used by / and /all-dates
│   │   └── daily-image-placeholder.tsx  # Dashed PENDING / "No birds identified" placeholder; caller sets the size
│   ├── lib/
│   │   ├── db.ts                  # SQLite queries (build-time only)
│   │   ├── links.ts               # pageHref(): internal link helper for S3-compatible URLs
│   │   └── species.ts             # isUnknownSpecies()/isKnownSpecies()/toTitleCase(): browser-safe, shared by db.ts and clip-grid.tsx
│   ├── test/                      # Vitest suite: db, links, species, clip-grid, lightbox tests, plus setup.ts + helpers.ts
│   ├── vitest.config.mts
│   ├── public/
│   │   ├── images/                # Logo, favicons, GitHub mark, feeder photo
│   │   └── downloads/             # Server's downloads/ dir must be available here (git-ignored; locally a symlink → ../../server/downloads you create yourself; volume mount in Docker)
│   ├── data/                      # Committed symlink → ../server/data (so client/data/bird-data.db is the server's DB)
│   ├── scripts/scheduled-publish/ # S3 deploy script (own package.json): build + upload + CloudFront invalidation, every SCHEDULED_PUBLISH_INTERVAL_HOURS (default 5h)
│   ├── .env.example
│   └── Dockerfile                 # Container for scheduled S3 publishing
├── .github/workflows/
│   ├── ci.yml                     # PR/push to main: server tests, client lint/test/build, publish-script check
│   └── docker.yml                 # PR/push to main touching server/ or client/: builds both Docker images (no push)
├── scripts/
│   └── setup-worktree.sh          # Idempotent local/worktree bootstrap: installs/clones node_modules, runs seed:local-db, links client/public/downloads (optional --link-env, --days <n>)
├── test-birds/                    # Committed test media from the real feeder: images/ (bird photos + non*.jpg non-bird photos for seed:local-uploads), audio/ (wav clips)
├── .agents/
│   ├── hooks.json                 # Antigravity hooks: SessionStart worktree bootstrap + PreToolUse blocking reads of server/.env and client/.env
│   └── skills/                    # Canonical repo skills (bird-developer end-to-end task → PR workflow, bird-reviewer code review subagent skill)
├── .claude/
│   ├── settings.json              # Shared Claude Code config: SessionStart worktree bootstrap hook + permissions (npm/git/sqlite allowed; .env reads denied)
│   ├── launch.json                # Claude Code preview config: client dev server on :3000
│   ├── skills/                    # Symlinks to ../../.agents/skills/* so skills work in both Antigravity and Claude Code
│   └── agents/                    # Claude Code subagent wrappers (bird-developer.md, bird-reviewer.md)
├── docker-compose.yml             # Production deploy: server + publish containers, external named volumes, env from server/.env + client/.env
├── .nvmrc                         # lts/krypton (Node 24) for local dev; Docker images and CI also use Node 24
├── README.md                      # Human-facing setup docs (keep in sync with AGENTS.md files)
├── CLAUDE.md                      # Imports `./AGENTS.md`, `./server/AGENTS.md`, and `./client/AGENTS.md`
└── AGENTS.md
```

## Keeping These Docs Current (required)

Any change that alters what `AGENTS.md`, `server/AGENTS.md`, or `client/AGENTS.md` describes **must update the relevant `AGENTS.md` file(s) in the same change** — don't wait to be asked. That includes: adding/removing/renaming files or routes, new env vars or defaults, schema changes, changes to the processing loop or sync behavior, new commands/scripts, Docker changes, and new conventions. Keep each `AGENTS.md` file under 24 KB (24,000 bytes) so agent rule loaders never truncate them. Also update `README.md` (human setup docs) and the relevant `.env.example` when setup or configuration changes. `CLAUDE.md` only imports the `AGENTS.md` files, so it never needs separate edits.

**Keep `.agents/` and `.claude/` in sync (required):** Customizations in this repo support both Antigravity (`.agents/`) and Claude Code (`.claude/`). Canonical skill definitions live in `.agents/skills/<name>/SKILL.md` and must be symlinked into `.claude/skills/<name>`. Whenever you add, rename, or update a skill, subagent, hook, or permission in either `.agents/` or `.claude/`, update the counterpart in the same change (`.agents/skills/*` ↔ `.claude/skills/*` symlinks + `.claude/agents/*.md` wrappers; `.agents/hooks.json` ↔ `.claude/settings.json`) so the two tools never drift out of sync.

Before finishing a task, re-read the affected sections and confirm they still match the code.

There is no root-level `package.json` — `server/`, `client/`, and `client/scripts/scheduled-publish/` each manage their own dependencies.

## Commands

### Worktree / Local Bootstrap (repo root)

```bash
./scripts/setup-worktree.sh              # Idempotent: clones/installs node_modules in all 3 packages, seeds server/data/bird-data.db (15 days), links client/public/downloads (also runs automatically on SessionStart in Antigravity and Claude Code)
./scripts/setup-worktree.sh --link-env   # Also symlinks server/.env and client/.env from the main worktree for manual live testing
```

### Server (`cd server`)

```bash
npm start                  # node index.ts: starts the FTP listener, runs an initial check, then loops every CHECK_INTERVAL
npm test                   # vitest run: the server test suite (npm run test:watch for watch mode)
npm run typecheck          # tsc: type-check only (no emit); Vitest and Node strip types without checking them
npm run seed:local-db      # Seed 15 days of video + audio test data into DATA_DIR + DOWNLOAD_DIR (`-- <days> [--force]`); see server/AGENTS.md
npm run seed:local-uploads # Put 5 bird + 1 non-bird test clips in UPLOAD_DIR (`-- <n>` for n bird clips); see server/AGENTS.md
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
npm start                  # Build + publish immediately, then repeat every SCHEDULED_PUBLISH_INTERVAL_HOURS (default 5) hours (needs S3/AWS env vars)
```

The server and client each have a Vitest suite (`server/test/`, `client/test/`); the publish script has no tests, and the server has no linter. Verify server changes with `npm run typecheck` and `npm test` (add/update tests alongside behavior changes) and, for loop/FTP wiring in `index.ts`, by running `npm start` against a scratch `DATA_DIR`; verify client changes with `npm test`, `npm run lint`, and `npm run build` (add/update tests alongside changes to `lib/`, `clip-grid.tsx`, or `lightbox.tsx`).

### CI (GitHub Actions)

- `.github/workflows/ci.yml` runs on Node 24 (matching the Docker images and `.nvmrc`) on every PR to `main` and push to `main`, with no path filters (so its jobs can be required checks): `server` (`npm ci`, `npm run typecheck`, `npm test`), `client` (`npm ci`, `npm run lint`, `npm test`, then `npm run build`), and `publish-script` (`npm ci` + `node --check index.js`).
- The client build needs `client/data/bird-data.db` (symlink → `server/data`), which CI doesn't have, so the `client` job runs `DATA_DIR=data node scripts/seed-ci-db.ts` in `server/` first. It creates the DB through `Storage` (so the schema is the real one) and adds two recent days of clips, audio detections, and one `daily_images` row, so `[date]` has static params to export. It refuses to run without `DATA_DIR` or when the DB already exists. If a schema change breaks the client build, update this script alongside `client/test/helpers.ts`.
- `.github/workflows/docker.yml` builds `server/` and `client/` images with Buildx (GHA cache, never pushed), only when `server/**`, `client/**`, `docker-compose.yml`, or the workflow itself change — so it's not meant to be a required check.
- Keep both green: anything that breaks `npm test`, `npm run lint`, or `npm run build` fails the PR. ESLint turns off `@next/next/no-html-link-for-pages` because plain `<a>` links are deliberate (static export).

## Database Schema

**clips** — `id` (PK, Unix seconds of recording time), `created_at`, `updated_at`, `device_name`, `network_name` (`'Reolink FTP'`), `type` (`'recording'`), `source` (`'ftp'`), `thumbnail`, `media` (original filename), `time_zone`, `local_thumbnail_path`. Index on `created_at`.

**identifications** — `id` (autoincrement PK), `clip_id` (FK → clips), `is_bird`, `species` (lowercase common name), `gender`, `count`, `confidence`, `non_bird_species`, `ai_model_id` (FK → settings), `ai_prompt_id` (FK → settings). Index on `species`.

**audio_identifications** — `id` (autoincrement PK), `birdnet_detection_id` (unique, BirdNET-Go's own detection ID — dedupe/sync cursor key), `species`, `scientific_name`, `species_code`, `confidence`, `verified`, `source`, `detected_at`, `begin_time`, `end_time`, `local_audio_path`, `species_image_id` (FK → species_images), `created_at`. Indexes on `scientific_name`, `detected_at`. Not linked to `clips`.

**species_images** — `id` (autoincrement PK), `scientific_name` (unique — reuse key), `common_name`, `local_path`, `created_at`. One clipart image per species, fetched from BirdNET-Go once and referenced by every matching `audio_identifications` row.

**daily_images** — `id` (autoincrement PK), `date` (unique, local `YYYY-MM-DD`), `species` (JSON array of the title-cased species drawn), `local_path` (NULL for a completed day with no known birds), `ai_model_id` (FK → settings), `ai_prompt_id` (FK → settings), `created_at`. One row per completed day; its presence means the day is done.

**settings** — `id` (autoincrement PK), `name`, `value`, `is_active` (boolean). Index on `name`. Used for `ai_model`, `ai_prompt`, `ai_image_model`, and `ai_image_prompt` (each seeded on first run if no row with that name exists). Settings are versioned: identifications reference the exact row used, so to change the model/prompt insert a new row and flip `is_active` rather than editing an existing row's `value`.

Schema changes go in `SQLiteStorage._createSchema()` (`server/lib/sqlite-storage.ts`) and the row types in `server/lib/types.ts`; existing databases need an explicit migration (see `_migrateIdentifications()` for the pattern), since `CREATE TABLE IF NOT EXISTS` won't add columns. Update the client's row interfaces in `client/lib/db.ts`, `client/test/helpers.ts`, and `server/scripts/seed-ci-db.ts` to match.

## Docker, Deployment & Repo-Wide Conventions

- **Server Dockerfile** (`server/Dockerfile`): `node:24-slim` (needed to run `.ts` directly) + build tools for `better-sqlite3`; `npm ci --omit=dev` (no TypeScript/test tooling in the image, since Node only strips types; `package.json` `engines` requires Node >= 24); declares volumes for `data/` and `downloads/` (`uploads/` isn't declared in the Dockerfile but is mounted by compose so failed clips survive recreates); exposes FTP control port `2121` and passive port range `30100-30110`.
- **Client Dockerfile** (`client/Dockerfile`): `node:24`; installs client + scheduled-publish deps, runs the publish script; volumes `/app/data` (DB) and `/app/public/downloads` (media).
- **Deployment** (`docker-compose.yml`): runs both containers on one host (`git pull && docker compose up -d --build`). Env comes from `server/.env`/`client/.env` via `env_file` at container creation (`.dockerignore` keeps `.env` out of images), so `.env` edits only need `docker compose up -d`, not a rebuild. Volumes `birdid-data`, `birdid-downloads`, `birdid-uploads` are `external: true` (created once with `docker volume create`; compose never deletes them). Both services set `TZ=America/Chicago` in the compose file — the server needs it because Reolink filename timestamps are parsed in local time and the daily image's 7 AM completion boundary is local (the image defaults to UTC). The publish container mounts `birdid-data` read-write because WAL-mode SQLite readers write the `-shm` file. FTP port mappings are hard-coded and must match `FTP_PORT`/`FTP_PASV_MIN`/`FTP_PASV_MAX`.
- **Secrets / `.env` files**: Never read `server/.env` or `client/.env` (they contain live API keys and credentials); read `server/.env.example` and `client/.env.example` instead.
- **Commit messages** follow Conventional Commits with a scope, e.g. `fix(server): ...`, `feat(client): ...`, `docs: ...`, `chore: ...`.
- **When behavior changes**, keep `README.md` and the `AGENTS.md` files in sync (see "Keeping These Docs Current" above).

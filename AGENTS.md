# AGENTS.md

This file provides guidance to AI agents such as Claude Code and GitHub Copilot when working with code in this repository.

## Project Overview

Hobby project that runs a local FTP server for a Reolink camera (pointed at a bird feeder) to push recorded clips to, identifies bird species in each clip using Google Gemini AI, and logs results. It also optionally syncs audio-based species detections from a self-hosted BirdNET-Go instance, independent of the video clips. Monorepo with a Node.js backend (`server/`) and a Next.js frontend (`client/`).

## Repository Structure

```
├── server/                        # Node.js orchestration + local FTP ingestion
│   ├── index.js                   # Main entry point: starts FTP listener + periodic processing loop
│   ├── lib/
│   │   ├── ai-provider.js         # Gemini AI integration
│   │   ├── birdnet-provider.js    # BirdNET-Go audio detection sync (optional, independent of clips)
│   │   ├── ftp-listener.js        # FTP server (ftp-srv) the camera pushes clips to
│   │   ├── ftp-clips.js           # Scans uploads, parses filenames, extracts thumbnails (ffmpeg)
│   │   ├── retention.js           # Prunes clips/identifications/audio identifications/downloads older than RETENTION_DAYS
│   │   ├── storage.js             # Storage facade
│   │   └── sqlite-storage.js      # SQLite implementation
│   ├── data/bird-data.db          # SQLite database
│   ├── uploads/                   # Raw video files pushed by the camera via FTP (deleted after processing)
│   ├── downloads/                 # Thumbnails: YYYY/M/D/{clip-id}.jpg; audio clips: YYYY/M/D/audio-{detection-id}.wav; species clipart cache: species/{scientific-name-slug}.jpg
│   └── Dockerfile
├── client/                        # Next.js static frontend
│   ├── app/
│   │   ├── layout.tsx             # Root layout (optional Cloudflare Analytics)
│   │   ├── page.tsx               # Home: lists available dates
│   │   ├── settings/page.tsx      # Shows current AI model/prompt config
│   │   └── [date]/
│   │       ├── page.tsx           # Date detail: summary + clip grid
│   │       └── clip-grid.tsx      # Client component: filter birds/non-birds
│   ├── lib/db.ts                  # SQLite queries (build-time only)
│   ├── data/bird-data.db          # Symlink → server/data/bird-data.db
│   ├── scripts/scheduled-publish/ # S3 deploy script (build + upload + CloudFront invalidation)
│   └── Dockerfile                 # Container for scheduled S3 publishing
└── AGENTS.md
```

There is no root-level `package.json` — each directory manages its own dependencies.

## Commands

### Server (`cd server`)

```bash
npm start                  # Run main app (node index.js): starts the FTP listener and processing loop
```

### Client (`cd client`)

```bash
npm run dev                # Next.js dev server
npm run build              # Static export build (outputs to client/out/)
npm run lint               # ESLint
```

## Architecture

### Server

- **Node.js orchestration layer** (`server/index.js`) — starts the FTP listener, then runs a periodic loop (`CHECK_INTERVAL`, default 10 minutes) that scans for newly uploaded clips, sends thumbnails to Gemini for bird identification (with `PROCESS_DELAY` between API calls), stores results, and deletes successfully processed videos (failed ones are retried next tick, guarded by an `isProcessing` flag against overlapping runs)
- **FTP listener** (`server/lib/ftp-listener.js`) — starts an always-on FTP server (`ftp-srv` npm package) on `FTP_HOST:FTP_PORT` that the camera authenticates against (`FTP_USERNAME`/`FTP_PASSWORD`) and pushes recordings to on motion; writes uploads under `UPLOAD_DIR`. Pure plumbing — no clip/AI logic.
- **Clip discovery** (`server/lib/ftp-clips.js`) — scans `UPLOAD_DIR` for video files, parses Reolink's FTP filename convention `[Camera]_[Channel]_[YYYYMMDDHHMMSS].ext` (falls back to file mtime + `CAMERA_NAME` if unmatched), extracts a JPEG thumbnail via `ffmpeg-static`/`fluent-ffmpeg`, and returns clip objects for anything not already in storage.
- **Retention** (`server/lib/retention.js`) — on each loop tick, prunes clips/identifications and audio identifications older than `RETENTION_DAYS` from SQLite and removes their corresponding date directories under `downloads/`. Species clipart in `downloads/species/` is never pruned — it's a small, persistent per-species cache, not time-bound per-detection data.
- **AI provider** (`server/lib/ai-provider.js`) — sends base64-encoded JPEG to Google Gemini (default model: `gemini-2.5-flash`), returns structured JSON with species info. Model and prompt are configurable via the `settings` database table.
- **BirdNET-Go provider** (`server/lib/birdnet-provider.js`) — optional (`BIRDNET_ENABLED`/`BIRDNET_GO_URL`). On each loop tick, polls a self-hosted BirdNET-Go instance's REST API (`GET /api/v2/detections`, newest-first, paginated) for detections newer than the last synced ID and within `BIRDNET_LOOKBACK_HOURS`. Detections at or above `BIRDNET_MIN_CONFIDENCE` are persisted: the per-detection audio clip is downloaded (`GET /api/v2/audio/{id}`) into the same dated `downloads/YYYY/M/D/` tree as thumbnails, and a per-species clipart image is downloaded once (`GET /api/v2/media/species-image?name={scientificName}`) and reused for every future detection of that species. Audio identifications are **not** correlated to video clips — they're an independent record stream keyed by BirdNET-Go's own detection ID.
- **Storage** (`server/lib/storage.js`) — facade over a swappable storage provider; delegates to `server/lib/sqlite-storage.js` which persists clips, bird identifications, audio identifications, species clipart, and settings to a SQLite database (`server/data/bird-data.db`) via `better-sqlite3`. Uses WAL mode.

### Client

- **Next.js 16 + React 19** with App Router, TypeScript, and Tailwind CSS v4
- **Static export** — configured in `next.config.ts` (`output: "export"`, `trailingSlash: true`) for S3 hosting
- **Routes:** `/` lists available dates; `/[date]/` shows clips and identifications for a given date; `/settings/` shows current AI model and prompt
- **Data access** (`client/lib/db.ts`) — reads the SQLite database directly via `better-sqlite3` at build time (readonly). All dates use `America/Chicago` timezone, formatted with `en-CA` locale for YYYY-MM-DD URL paths.
- **Symlinked database** — `client/data/bird-data.db` symlinks to `server/data/bird-data.db`
- **Scheduled publishing** (`client/scripts/scheduled-publish/`) — builds static site, uploads changed files to S3 (skips unchanged via ETag/MD5), optionally invalidates CloudFront

### Database Schema

**clips** — `id` (PK), `created_at`, `updated_at`, `device_name`, `network_name`, `type`, `source`, `thumbnail`, `media`, `time_zone`, `local_thumbnail_path`

**identifications** — `id` (autoincrement PK), `clip_id` (FK → clips), `is_bird`, `species`, `gender`, `count`, `confidence`, `non_bird_species`, `ai_model_id` (FK → settings), `ai_prompt_id` (FK → settings)

**audio_identifications** — `id` (autoincrement PK), `birdnet_detection_id` (unique, BirdNET-Go's own detection ID — dedupe/sync cursor key), `species`, `scientific_name`, `species_code`, `confidence`, `verified`, `source`, `detected_at`, `begin_time`, `end_time`, `local_audio_path`, `species_image_id` (FK → species_images). Not linked to `clips` — independent of video identifications.

**species_images** — `id` (autoincrement PK), `scientific_name` (unique — reuse key), `common_name`, `local_path`, `created_at`. One clipart image per species, fetched from BirdNET-Go once and referenced by every matching `audio_identifications` row.

**settings** — `id` (autoincrement PK), `name`, `value`, `is_active` (boolean). Used for `ai_model` and `ai_prompt` configuration.

## Key Conventions

- ES modules throughout (`"type": "module"` in server package.json)
- Uses `fileURLToPath` pattern for `__dirname` equivalent in server code
- Camera pushes clips via FTP; no local network polling or cloud auth — configured entirely via `FTP_HOST`/`FTP_PORT`/`FTP_USERNAME`/`FTP_PASSWORD`/`FTP_PASV_URL`/`FTP_PASV_MIN`/`FTP_PASV_MAX` env vars. `FTP_PASV_URL` must be the LAN IP of the host running the server (required for passive-mode transfers).
- Uploaded videos land in `UPLOAD_DIR` and are deleted once successfully processed into a thumbnail + DB row; downloads organized by date: `server/downloads/YYYY/M/D/{clip-id}.jpg`
- BirdNET-Go audio sync is optional and entirely separate from FTP/video processing — enabled via `BIRDNET_ENABLED`/`BIRDNET_GO_URL`, tuned via `BIRDNET_MIN_CONFIDENCE`/`BIRDNET_LOOKBACK_HOURS`; requires no local FTP/RTSP config since it just queries BirdNET-Go's own REST API
- Environment config via `.env` in each directory (see `.env.example` for variables)
- Server Dockerfile: `node:20-slim` base, volumes for `data/`, `downloads/`; exposes FTP control port `2121` and passive port range `30100-30110`
- Client Dockerfile: runs scheduled-publish script for automated S3 deployments
- Dark mode supported in frontend (Tailwind `dark:` prefixes)
- Path alias `@/*` → `./` in client TypeScript config

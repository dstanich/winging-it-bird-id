# winging-it-bird-id ![Winging It logo](client/public/images/winging-it-32x32.png)

Bird identification software intended on being used in conjunction with a 3d printable bird feeder with various compatible camera mounts.  The model is available on [Maker World by user Michele](https://makerworld.com/en/models/1239253-smart-bird-feeder-with-integrated-wifi-camera).

The current version of the `main` branch assumes you are using a Reolink camera with FTP upload capabilities.

The code can be easily adapted to fetch clips from Cloud services or other provides as needed.  A previous version of this tool that utilized the Blink ecosystem can be found in the [historical-blink-cameras](https://github.com/dstanich/blink-bird-id/tree/historical-blink-cameras) branch.  That branch is no longer maintained as Blink cameras are difficult to work with.

This repo is a mix of developer written and AI agent written code as a hobby project to experiment with AI such as GitHub Copilot and Claude.

## Overview

Node.js application that runs a local FTP server for a camera to push recorded clips to on motion, extracts a thumbnail from each clip via ffmpeg, then identifies what bird(s) are in it using Google Gemini.

Once a day is complete (7 AM local time the following day), the server also asks Gemini for a cartoon-style "species of the day" illustration of every known bird species seen on video or heard by BirdNET-Go that day. The date page shows it next to the summary, or a PENDING placeholder until it exists. `DAILY_IMAGE_LOOKBACK_DAYS` (default 7) caps how many past days are considered, and the image model/prompt are stored as `ai_image_model`/`ai_image_prompt` settings rows (default model `gemini-3.1-flash-lite-image`).

Frontend written with Next.js intended to be built and exported as a static website with a built in scheduler to build the static files, upload to AWS S3, then invalidate cache.

## Example Deployed Instance

An example of the code running can be found at https://winging-it.org.

Winging-It is being hosted as a static site on AWS and will be updated as improvements are made to the repo.

## Running
### Server

The server is a Node.js application that runs a local FTP server for the camera to push recorded clips to, extracts thumbnails from those clips, communicates with the AI provider, and stores the results into storage.

#### Setup

1. `cd server && npm install`
2. Copy `.env.example` to `.env` and fill in `GOOGLE_API_KEY` plus the FTP settings: `FTP_HOST`, `FTP_PORT`, `FTP_USERNAME`, `FTP_PASSWORD`, `FTP_PASV_URL`.
3. In the Reolink camera's own admin settings, configure FTP upload to point at this host/port with the same username/password, so it pushes recordings here on motion.
4. `npm start` — starts the FTP listener and the periodic clip-processing loop.

Alternatively, run it with the scheduled publisher via Docker Compose — see [Deploying with Docker](#deploying-with-docker).

#### Test clips without the camera

`cd server && npm run seed:uploads` (or `npm run seed:uploads -- 12`) creates short videos in `UPLOAD_DIR` from random photos in `test-birds/images/`: the requested number of bird clips (default 5) plus a third as many non-bird clips (at least 1) from photos whose names start with `non`. No photo repeats until every one in its group has been used. They are named like real Reolink uploads with recent timestamps spaced past `VIDEO_COOLDOWN_SECONDS`, so the next processing tick picks them up and sends them to Gemini like real clips.

#### Tests

`cd server && npm test` runs the [Vitest](https://vitest.dev) suite in `server/test/` (`npm run test:watch` for watch mode). Tests use temp directories and stubbed network/AI calls, so they need no `.env`, never touch `server/data/`, and never call Gemini or BirdNET-Go. Thumbnail tests run the real bundled ffmpeg binary.


### Client

The client is a Next.js application that is statically exported into files then published to a hosting location.  The client code pulls data from the server via the thumbnail download directory and the persistent storage where AI result data is kept.

#### Setup

1. Make sure `server/data/bird-data.db` exists — run the server (`cd server && npm start`) at least once so it creates the SQLite schema. The client reads this database read-only via `client/data`, a committed symlink to `server/data`.
2. To see thumbnails, audio, and species images locally, link the server's media directory into the client (git-ignored, so it isn't committed): `ln -s ../../server/downloads client/public/downloads` (run from the repo root).
3. `cd client && npm install`
4. `npm run dev` → http://localhost:3000 (no `.env` file needed for local dev)

#### Tests

`cd client && npm test` runs the [Vitest](https://vitest.dev) suite in `client/test/` (`npm run test:watch` for watch mode). It covers `lib/` (data queries run against a temp SQLite database, never `client/data/`) and the `ClipGrid` component (React Testing Library + jsdom). The page components and the scheduled-publish script aren't tested.

For building the static export and publishing it to production, see [Scheduled Publishing](#scheduled-publishing-production) below.

## Scheduled Publishing (Production)

`client/scripts/scheduled-publish/` is a standalone script that builds the client as a static site and publishes it to AWS S3 (with optional CloudFront cache invalidation) on a repeating schedule. It isn't needed for local development.

**What it does:** on a loop (every 5 hours, starting immediately when launched) it runs `npm run build` in `client/`, copies `client/public/downloads` into the static export output, uploads changed files to S3 (comparing local file hashes against existing S3 object ETags to skip anything unchanged), deletes S3 objects that are no longer present locally (skipped if the local build has fewer than 10 files total, as a safety guard against a broken build wiping the bucket), and invalidates CloudFront if anything changed.

**Setup:**

1. `cd client/scripts/scheduled-publish && npm install`
2. Copy `client/.env.example` to `client/.env` and fill in:
   - `SCHEDULED_PUBLISH_S3_BUCKET` — required; upload/invalidation is skipped without it
   - `SCHEDULED_PUBLISH_S3_PREFIX` — optional key prefix within the bucket
   - `SCHEDULED_PUBLISH_CLOUDFRONT_DISTRIBUTION_ID` — optional; invalidation is skipped without it
   - `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` — standard AWS credentials; needs S3 read/write/delete on the bucket and `cloudfront:CreateInvalidation` on the distribution
   - `SCHEDULED_PUBLISH_CLIENT_DIR` — optional override for the client directory (defaults to `client/`)
   - `RETENTION_DAYS` — default 60; how many days of dates the static build includes
   - `CLOUDFLARE_ANALYTICS_TOKEN` — optional; enables the analytics script tag in `client/app/layout.tsx`
3. `cd client/scripts/scheduled-publish && npm start` — runs immediately, then repeats every 5 hours for as long as the process stays alive.

Alternatively, run via Docker: `client/Dockerfile` is built specifically for this job (installs both the client and scheduled-publish dependencies, and runs the publish script). It expects volumes at `/app/data` (the SQLite database the server produces) and `/app/public/downloads` (thumbnails), plus the same environment variables passed in. It is not used for local `npm run dev`. The root `docker-compose.yml` wires this up alongside the server — see [Deploying with Docker](#deploying-with-docker).

As with local dev, `server/data/bird-data.db` must exist and contain data before running a publish.

## Deploying with Docker

The root `docker-compose.yml` runs both the server (`server/Dockerfile`) and the scheduled publisher (`client/Dockerfile`) on one host, sharing the database and media through named volumes. Environment variables are read from `server/.env` and `client/.env` when containers are created; they're excluded from the images by `.dockerignore`, so changing them never needs an image rebuild.

**First-time setup on the host:**

1. `git clone git@github.com:dstanich/winging-it-bird-id.git && cd winging-it-bird-id`
2. Create `server/.env` and `client/.env` from their `.env.example` files. Keep `DATA_DIR`, `DOWNLOAD_DIR`, and `UPLOAD_DIR` at their relative defaults (`./data`, `./downloads`, `./uploads`) so they land in the mounted volumes; `FTP_PASV_URL` is the host's LAN IP.
3. Create the volumes once (skip any that already exist — compose treats them as external and never creates or deletes them):
   ```bash
   docker volume create birdid-data
   docker volume create birdid-downloads
   docker volume create birdid-uploads
   ```
4. `docker compose up -d --build`

**Day to day:**

| Task | Command |
|---|---|
| Deploy new code | `git pull && docker compose up -d --build` |
| Apply `.env` changes | `docker compose up -d` (recreates only the containers whose config changed) |
| Follow logs | `docker compose logs -f server` (or `publish`) |
| Stop everything | `docker compose down` (volumes and data are kept) |

The FTP port mappings in `docker-compose.yml` (`2121`, `30100-30110`) are fixed; if you change `FTP_PORT` or `FTP_PASV_MIN`/`FTP_PASV_MAX`, update the compose file to match. Both containers set `TZ=America/Chicago` in the compose file; the server needs it to read the local-time timestamps in Reolink filenames correctly (and to decide when a day is complete for its daily image), so change it if your camera is in another time zone.

**Migrating from hand-run containers:** remove the old containers with `docker rm -f <name>` (no `-v`, so the named volumes are kept), then run `docker compose up -d --build`. They must be removed first because they hold the FTP ports.

## TODOs

- [ ] TypeScript
- [ ] Tests for client pages and the scheduled-publish script
- [ ] Linting
- [ ] Graphing and other nice visualizations


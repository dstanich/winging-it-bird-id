# winging-it-bird-id ![Winging It logo](client/public/images/winging-it-32x32.png)

Bird identification software intended on being used in conjunction with a 3d printable bird feeder with various compatible camera mounts.  The model is available on [Maker World by user Michele](https://makerworld.com/en/models/1239253-smart-bird-feeder-with-integrated-wifi-camera).

The current version of the `main` branch assumes you are using a Reolink camera with FTP upload capabilities.

The code can be easily adapted to fetch clips from Cloud services or other provides as needed.  A previous version of this tool that utilized the Blink ecosystem can be found in the [historical-blink-cameras](https://github.com/dstanich/blink-bird-id/tree/historical-blink-cameras) branch.  That branch is no longer maintained as Blink cameras are difficult to work with.

This repo is a mix of developer written and AI agent written code as a hobby project to experiment with AI such as GitHub Copilot and Claude.

## Overview

Node.js application that runs a local FTP server for a camera to push recorded clips to on motion, extracts a thumbnail from each clip via ffmpeg, then identifies what bird(s) are in it using Google Gemini.

Frontend written with Next.js intended to be built and exported as a static website with a built in scheduler to build the static files, upload to AWS S3, then invalidate cache.

## Example Deployed Instance

An example of the code running can be found at https://winging-it.org.

Winging-It is being hosted as a static site on AWS and will be updated as improvements are made to the repo.

## Running
### Server

The server is a Node.js application that runs a local FTP server for the camera to push recorded clips to, extracts thumbnails from those clips, communicates with the AI provider, and stores the results into storage.

#### Setup

1. `cd server && npm install`
2. Copy `.env.example` to `.env` and fill in `GOOGLE_API_KEY` plus the FTP settings: `FTP_HOST`, `FTP_PORT`, `FTP_USERNAME`, `FTP_PASSWORD`.
3. In the Reolink camera's own admin settings, configure FTP upload to point at this host/port with the same username/password, so it pushes recordings here on motion.
4. `npm start` — starts the FTP listener and the periodic clip-processing loop.

Alternatively, run via Docker: the `Dockerfile` exposes the FTP control port (`2121`) and passive port range (`30100-30110`), with volumes for `data/` and `downloads/`.


### Client

The client is a Next.js application that is statically exported into files then published to a hosting location.  The client code pulls data from the server via the thumbnail download directory and the persistent storage where AI result data is kept.

#### Setup

1. Make sure `server/data/bird-data.db` exists — run the server (`cd server && npm start`) at least once so it creates the SQLite schema. The client reads this database read-only via a committed symlink at `client/data/bird-data.db`.
2. `cd client && npm install`
3. `npm run dev` → http://localhost:3000 (no `.env` file needed for local dev)

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

Alternatively, run via Docker: `client/Dockerfile` is built specifically for this job (installs both the client and scheduled-publish dependencies, and runs the publish script). It expects volumes at `/app/data` (the SQLite database the server produces) and `/app/public/downloads` (thumbnails), plus the same environment variables passed in. It is not used for local `npm run dev`.

As with local dev, `server/data/bird-data.db` must exist and contain data before running a publish.

## TODOs

- [ ] TypeScript
- [ ] Tests
- [ ] Linting
- [ ] Graphing and other nice visualizations


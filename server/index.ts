/**
 * Main entry point
 */

import { startFtpListener } from './lib/ftp-listener.ts';
import { discoverNewClips } from './lib/ftp-clips.ts';
import { Storage } from './lib/storage.ts';
import { AIProvider } from './lib/ai-provider.ts';
import { BirdNetProvider } from './lib/birdnet-provider.ts';
import { pruneOldData } from './lib/retention.ts';
import { applyCooldown, processClips } from './lib/clip-processing.ts';
import { generateDailyImages } from './lib/daily-image.ts';
import type { Clip } from './lib/types.ts';
import * as fs from 'fs';
import 'dotenv/config'

// Configuration
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || '600000'); // 10 minutes default
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || '60');
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || './downloads';
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const FTP_HOST = process.env.FTP_HOST || '0.0.0.0';
const FTP_PORT = parseInt(process.env.FTP_PORT || '2121');
const FTP_USERNAME = process.env.FTP_USERNAME;
const FTP_PASSWORD = process.env.FTP_PASSWORD;
const FTP_PASV_URL = process.env.FTP_PASV_URL;
const FTP_PASV_MIN = parseInt(process.env.FTP_PASV_MIN || '30100');
const FTP_PASV_MAX = parseInt(process.env.FTP_PASV_MAX || '30110');
const BIRDNET_ENABLED = process.env.BIRDNET_ENABLED === 'true';
const BIRDNET_GO_URL = process.env.BIRDNET_GO_URL;
const BIRDNET_MIN_CONFIDENCE = parseFloat(process.env.BIRDNET_MIN_CONFIDENCE || '0.7');
const BIRDNET_LOOKBACK_HOURS = parseInt(process.env.BIRDNET_LOOKBACK_HOURS || '48');
const VIDEO_COOLDOWN_SECONDS = parseInt(process.env.VIDEO_COOLDOWN_SECONDS || '0'); // 0 = disabled
const DAILY_IMAGE_LOOKBACK_DAYS = parseInt(process.env.DAILY_IMAGE_LOOKBACK_DAYS || '7');
const PROCESS_DELAY = parseInt(process.env.PROCESS_DELAY || '30000');

// Persistence / AI
let downloadDir: string;
let storage: Storage;
let aiProvider: AIProvider;
let birdnetProvider: BirdNetProvider | undefined;
let isProcessing = false;

/**
 * Initialize application
 */
function initializeApp(): void {
  downloadDir = DOWNLOAD_DIR;
  const dirs = [DOWNLOAD_DIR, UPLOAD_DIR];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  }

  storage = new Storage();
  aiProvider = new AIProvider(storage);

  if (BIRDNET_ENABLED && BIRDNET_GO_URL) {
    birdnetProvider = new BirdNetProvider(storage, {
      baseUrl: BIRDNET_GO_URL,
      minConfidence: BIRDNET_MIN_CONFIDENCE,
      lookbackHours: BIRDNET_LOOKBACK_HOURS,
      downloadDir,
    });
  }
}

/**
 * Check for newly uploaded video files and extract thumbnails
 *
 * @returns List of new clips with thumbnails extracted
 */
async function checkForNewClips(): Promise<Clip[]> {
  try {
    console.log('\n=== Checking for new clips ===');
    return await discoverNewClips(storage, UPLOAD_DIR, downloadDir, process.env.CAMERA_NAME);
  } catch (error) {
    console.error('Error checking for new clips:', error);
    return [];
  }
}

/**
 * Check for new clips and process them
 */
async function checkAndProcessClips(): Promise<void> {
  try {
    await pruneOldData(storage, downloadDir, RETENTION_DAYS);
  } catch (error) {
    console.error('Error pruning old data:', error);
  }

  if (birdnetProvider) {
    try {
      await birdnetProvider.syncDetections();
    } catch (error) {
      console.error('Error syncing BirdNET-Go detections:', error);
    }
  }

  let clips = await checkForNewClips();
  const lastProcessedIso = storage.getMostRecentClipTimestamp();
  clips = applyCooldown(clips, lastProcessedIso ? Date.parse(lastProcessedIso) : null, VIDEO_COOLDOWN_SECONDS);
  clips = await processClips(clips, aiProvider, PROCESS_DELAY);

  // Add all successfully processed clips to storage and commit
  clips.forEach(clip => {
    storage.addClip(clip);
  });
  storage.commit();

  // Raw uploads are only needed to produce a thumbnail; once a clip is
  // successfully committed, remove its video to keep disk usage low. A clip
  // that failed processing keeps its video so the next tick retries it.
  clips.forEach(clip => {
    if (!clip.localVideoPath) return;
    try {
      fs.rmSync(clip.localVideoPath, { force: true });
    } catch (error) {
      console.error(`Error removing processed video ${clip.localVideoPath}:`, error);
    }
  });

  // Generate daily species images; generateDailyImages() works out which days are ready
  try {
    await generateDailyImages(storage, aiProvider, {
      downloadDir,
      lookbackDays: DAILY_IMAGE_LOOKBACK_DAYS,
      delayMs: PROCESS_DELAY,
    });
  } catch (error) {
    console.error('Error generating daily images:', error);
  }
}

/**
 * Guards against overlapping runs (e.g. if a check takes longer than
 * CHECK_INTERVAL due to the PROCESS_DELAY throttle in processClips()).
 */
async function triggerCheck(): Promise<void> {
  if (isProcessing) {
    console.log('Skipping check: already processing');
    return;
  }
  isProcessing = true;
  try {
    console.log(`\n=== Check: ${new Date().toISOString()} ===`);
    await checkAndProcessClips();
  } catch (error) {
    console.error('Error during check:', error);
  } finally {
    isProcessing = false;
  }
}

/**
 * Main application loop
 */
async function main(): Promise<void> {
  console.log('Winging It Bird ID Application');
  console.log('==============================');

  initializeApp();

  // FTP upload listener: the camera pushes recorded clips here on motion.
  // The timer loop below periodically scans for and processes new uploads.
  await startFtpListener({
    uploadDir: UPLOAD_DIR,
    host: FTP_HOST,
    port: FTP_PORT,
    username: FTP_USERNAME,
    password: FTP_PASSWORD,
    pasvUrl: FTP_PASV_URL,
    pasvMin: FTP_PASV_MIN,
    pasvMax: FTP_PASV_MAX,
  });

  // Initial check
  console.log('Initial clip check...');
  await triggerCheck();

  // Set up periodic checks
  console.log(`\nScheduling checks every ${CHECK_INTERVAL / 60000} minutes`);
  setInterval(() => {
    triggerCheck();
  }, CHECK_INTERVAL);

  console.log('Application running. Monitoring for new clips...\n');
}

// Run application
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

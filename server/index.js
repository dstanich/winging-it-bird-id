/**
 * Main entry point
 */

import { startFtpListener } from './lib/ftp-listener.js';
import { discoverNewClips } from './lib/ftp-clips.js';
import { Storage } from './lib/storage.js';
import { AIProvider } from './lib/ai-provider.js';
import { BirdNetProvider } from './lib/birdnet-provider.js';
import { pruneOldData } from './lib/retention.js';
import * as fs from 'fs';
import 'dotenv/config'

// Configuration
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || 600000); // 10 minutes default
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || 60);
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const FTP_HOST = process.env.FTP_HOST || '0.0.0.0';
const FTP_PORT = parseInt(process.env.FTP_PORT || 2121);
const FTP_USERNAME = process.env.FTP_USERNAME;
const FTP_PASSWORD = process.env.FTP_PASSWORD;
const FTP_PASV_URL = process.env.FTP_PASV_URL;
const FTP_PASV_MIN = parseInt(process.env.FTP_PASV_MIN || 30100);
const FTP_PASV_MAX = parseInt(process.env.FTP_PASV_MAX || 30110);
const BIRDNET_ENABLED = process.env.BIRDNET_ENABLED === 'true';
const BIRDNET_GO_URL = process.env.BIRDNET_GO_URL;
const BIRDNET_MIN_CONFIDENCE = parseFloat(process.env.BIRDNET_MIN_CONFIDENCE || 0.7);
const BIRDNET_LOOKBACK_HOURS = parseInt(process.env.BIRDNET_LOOKBACK_HOURS || 48);

// Persistence / AI
let storage;
let aiProvider;
let birdnetProvider;
let isProcessing = false;

/**
 * Initialize application
 */
function initializeApp() {
  const { DOWNLOAD_DIR } = process.env;
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
      downloadDir: process.env.DOWNLOAD_DIR,
    });
  }
}

/**
 * Check for newly uploaded video files and extract thumbnails
 *
 * @returns {Promise<Array>} List of new clips with thumbnails extracted
 */
async function checkForNewClips() {
  try {
    console.log('\n=== Checking for new clips ===');
    return await discoverNewClips(storage, UPLOAD_DIR, process.env.DOWNLOAD_DIR, process.env.CAMERA_NAME);
  } catch (error) {
    console.error('Error checking for new clips:', error);
    return [];
  }
}

/**
 * Process clips: identify birds using AI and save results to storage
 *
 * @param {*} clips
 * @returns
 */
async function processClips(clips) {
  const successfulClips = [];
  for (const clip of clips) {
    try {
      // Bird ID processing
      const { id, localThumbnailPath } = clip;
      console.log(`\nProcessing clip ${id} with thumbnail at ${localThumbnailPath}`);
      const aiResponse = await aiProvider.identifyBird(clip, localThumbnailPath);
      clip.birdIdentification = aiResponse;
      successfulClips.push(clip);
      console.log(`✓ Processed clip ${id} successfully`);

      // Delay for PROCESS_DELAY milliseconds to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, process.env.PROCESS_DELAY || 30000));
    } catch (error) {
      console.error(`Error processing clip ${clip.id}:`, error);
    }
  }
  return successfulClips
}

/**
 * Check for new clips and process them
 */
async function checkAndProcessClips() {
  try {
    await pruneOldData(storage, process.env.DOWNLOAD_DIR, RETENTION_DAYS);
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
  clips = await processClips(clips);

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
}

/**
 * Guards against overlapping runs (e.g. if a check takes longer than
 * CHECK_INTERVAL due to the PROCESS_DELAY throttle in processClips()).
 */
async function triggerCheck() {
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
async function main() {
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

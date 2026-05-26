/**
 * Blink Bird ID - Main Application
 */

import { authenticate, downloadFile, listClips } from './lib/blink-manager.js';
import { Storage } from './lib/storage.js';
import { AIProvider } from './lib/ai-provider.js';
import { pruneOldData } from './lib/retention.js';
import * as fs from 'fs';
import * as path from 'path';
import 'dotenv/config'

// Configuration
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || 600000); // 10 minutes default
const RETENTION_DAYS = parseInt(process.env.RETENTION_DAYS || 60);

// Persistence / AI
let storage;
let aiProvider;

/**
 * Initialize application
 */
function initializeApp() {
  const { DOWNLOAD_DIR } = process.env;
  const dirs = [DOWNLOAD_DIR];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  }

  storage = new Storage();
  aiProvider = new AIProvider(storage);
}

/**
 * Check for and download new thumbnails
 *
 * @returns {Promise<Array>} List of new clips with thumbnails downloaded
 */
async function checkForNewClips() {
  try {
    console.log('\n=== Checking for new clips ===');

    // Authenticate first
    console.log('Authenticating with Blink...');
    const authResult = await authenticate();
    if (!authResult.success) {
      console.error('Authentication failed:', authResult.error);
      return [];
    }
    console.log('✓ Authenticated with Blink Cloud');

    // Call blink and get latest clips
    const sinceTimestamp = Date.now() - 8 * 60 * 60 * 1000; // 8 hours in milliseconds
    const cmdResult = await listClips(process.env.CAMERA_NAME, new Date(sinceTimestamp).toISOString());
    if (!cmdResult.success) {
      console.error('Failed to list clips:', cmdResult.error);
      return [];
    }
    let clips = cmdResult.clips || [];
    console.log(`✓ Found ${clips.length} clip(s) in total`);

    // Filter out any 'deleted' clips since they may be returned by the API but the data may be bad
    clips = clips.filter(clip => !clip.deleted);
    console.log(`✓ ${clips.length} clip(s) after filtering deleted clips`);

    // Filter out any clips already in our database
    clips = clips.filter(clip => {
      const clipId = clip.id;
      if (storage.data(new Date(sinceTimestamp).toISOString())[clipId]) {
        console.log(`✓ Skipping already processed clip: ${clipId}`);
        return false;
      }
      return true;
    });
    console.log(`✓ ${clips.length} new clip(s) to download`);

    for (const clip of clips) {
      try {
        const clipDate = new Date(clip.created_at);
        console.log(`[Clip ${clip.id}] ${clip.created_at} / ${clipDate.getFullYear()} / ${clipDate.getMonth() + 1} / ${clipDate.getDate()}`);

        // Create directory structure based on clip date, if it doesn't exist
        const clipPath = path.join(`${process.env.DOWNLOAD_DIR}`, `${clipDate.getFullYear()}`, `${clipDate.getMonth() + 1}`, `${clipDate.getDate()}`);
        if (!fs.existsSync(clipPath)) {
          fs.mkdirSync(clipPath, { recursive: true });
          console.log(`Created directory for clip: ${clipPath}`);
        }

        // Download thumbnail for each clip, if it doesn't exist
        const thumbnailUrl = clip.thumbnail;
        const thumbnailPath = path.join(clipPath, `${clip.id}.jpg`);
        if (fs.existsSync(thumbnailPath)) {
          console.log(`Thumbnail already exists: ${thumbnailPath}`);
        } else {
          console.log(`Downloading thumbnail ${thumbnailUrl} to: ${thumbnailPath}`);
          await downloadFile(thumbnailUrl, thumbnailPath);
        }
        clip.localThumbnailPath = thumbnailPath;
      } catch (error) {
        console.error(`Error processing clip ${clip.id}:`, error);
      }
    }

    return clips;
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

  let clips = await checkForNewClips();
  clips = await processClips(clips);

  // Add all successfully processed clips to storage and commit
  clips.forEach(clip => {
    storage.addClip(clip);
  });
  storage.commit();
}


/**
 * Main application loop
 */
async function main() {
  console.log('Starting Blink Bird ID Application');
  console.log('==================================');

  initializeApp();

  // Initial check
  console.log('Initial clip check...');
  await checkAndProcessClips();

  // Set up periodic checks
  console.log(`\nScheduling checks every ${CHECK_INTERVAL / 60000} minutes`);
  setInterval(async () => {
    console.log(`\nScheduled check triggered: ${new Date().toISOString()}`);
    await checkAndProcessClips();
  }, CHECK_INTERVAL);

  console.log('Application running. Monitoring for new clips...\n');
}

// Run application
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

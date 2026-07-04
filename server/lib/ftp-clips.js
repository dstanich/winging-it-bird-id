/**
 * FTP clip discovery - scans the FTP upload directory for video files the
 * camera has pushed, parses camera/timestamp metadata from the Reolink FTP
 * filename convention, extracts a JPEG thumbnail via ffmpeg, and returns
 * clip objects shaped like the rest of the app expects.
 */

import * as fs from 'fs';
import * as path from 'path';
import ffmpegPath from 'ffmpeg-static';
import ffmpeg from 'fluent-ffmpeg';

ffmpeg.setFfmpegPath(ffmpegPath);

const VIDEO_EXTENSIONS = new Set(['mp4', '264', '265', 'h264', 'h265']);

// Reolink FTP filename convention: [CameraName]_[ChannelNumber]_[Timestamp].[Extension]
const FILENAME_PATTERN = /^(.+)_(\d+)_(\d{14})\.(\w+)$/i;

const TIMESTAMP_PATTERN = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;

/**
 * Parse a YYYYMMDDHHMMSS string into a local-time Date.
 * @param {string} timestamp
 * @returns {Date}
 */
function parseLocalTimestamp(timestamp) {
  // Done dependency-free to avoid pulling in moment.js or similar just for this.
  // Date() doesn't recognize YYYYMMDDHHMMSS, so we have to parse it manually and construct a Date.
  const [, year, month, day, hour, minute, second] = timestamp.match(TIMESTAMP_PATTERN).map(Number);
  return new Date(year, month - 1, day, hour, minute, second);
}

/**
 * Recursively list video files (one level of subdirectory nesting) under uploadDir.
 * @param {string} uploadDir
 * @returns {Array<{ filePath: string, fileName: string }>}
 */
function listVideoFiles(uploadDir) {
  const results = [];
  if (!fs.existsSync(uploadDir)) return results;

  const walk = (dir, depth) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 1) walk(entryPath, depth + 1);
        continue;
      }
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (VIDEO_EXTENSIONS.has(ext)) {
        results.push({ filePath: entryPath, fileName: entry.name });
      }
    }
  };
  walk(uploadDir, 0);
  return results;
}

/**
 * Parse camera name + recording timestamp out of an uploaded video's filename,
 * falling back to file mtime + a default camera name if it doesn't match the
 * expected Reolink FTP convention.
 *
 * @param {string} filePath
 * @param {string} fileName
 * @param {string} defaultCameraName
 * @returns {{ cameraName: string, timestamp: Date }}
 */
function parseClipMetadata(filePath, fileName, defaultCameraName) {
  const match = fileName.match(FILENAME_PATTERN);
  if (match) {
    const [, cameraName, , timestampStr] = match;
    return { cameraName, timestamp: parseLocalTimestamp(timestampStr) };
  }

  console.warn(`FTP upload "${fileName}" does not match the expected [Camera]_[Channel]_[Timestamp].[Ext] pattern; falling back to file mtime and CAMERA_NAME`);
  return { cameraName: defaultCameraName, timestamp: fs.statSync(filePath).mtime };
}

/**
 * Extract a single JPEG frame from a video file, unless the thumbnail already exists.
 * @param {string} videoPath
 * @param {string} thumbnailPath
 * @returns {Promise<void>}
 */
function extractThumbnail(videoPath, thumbnailPath) {
  if (fs.existsSync(thumbnailPath)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    // A fixed offset (rather than a "50%" timestamp) avoids fluent-ffmpeg's
    // duration probe, which requires ffprobe - a binary ffmpeg-static doesn't bundle.
    ffmpeg(videoPath)
      .on('end', resolve)
      .on('error', reject)
      .screenshots({
        timestamps: [1],
        filename: path.basename(thumbnailPath),
        folder: path.dirname(thumbnailPath),
      });
  });
}

/**
 * Scan uploadDir for new video files, parse metadata, extract thumbnails,
 * and return clip objects for anything not already in storage.
 *
 * @param {Object} storage
 * @param {string} uploadDir
 * @param {string} downloadDir
 * @param {string} defaultCameraName - fallback device_name if filename doesn't match the expected pattern
 * @returns {Promise<Array>} new clips, each with localThumbnailPath/localVideoPath set
 */
export async function discoverNewClips(storage, uploadDir, downloadDir, defaultCameraName) {
  const files = listVideoFiles(uploadDir);
  console.log(`✓ Found ${files.length} uploaded video file(s)`);

  const processedIds = storage.data();
  const clips = [];

  for (const { filePath, fileName } of files) {
    try {
      const { cameraName, timestamp } = parseClipMetadata(filePath, fileName, defaultCameraName);
      const id = Math.floor(timestamp.getTime() / 1000);

      if (processedIds[id]) {
        console.log(`✓ Skipping already processed clip: ${id} (${fileName})`);
        continue;
      }

      console.log(`[Clip ${id}] ${timestamp.toISOString()} / ${fileName}`);

      const clipDir = path.join(downloadDir, `${timestamp.getFullYear()}`, `${timestamp.getMonth() + 1}`, `${timestamp.getDate()}`);
      if (!fs.existsSync(clipDir)) {
        fs.mkdirSync(clipDir, { recursive: true });
        console.log(`Created directory for clip: ${clipDir}`);
      }

      const thumbnailPath = path.join(clipDir, `${id}.jpg`);
      console.log(`Extracting thumbnail for clip ${id} to: ${thumbnailPath}`);
      await extractThumbnail(filePath, thumbnailPath);

      clips.push({
        id,
        created_at: timestamp.toISOString(),
        updated_at: timestamp.toISOString(),
        device_name: cameraName,
        network_name: 'Reolink FTP',
        type: 'recording',
        source: 'ftp',
        thumbnail: 'ftp-frame',
        media: fileName,
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        localThumbnailPath: thumbnailPath,
        localVideoPath: filePath,
      });
    } catch (error) {
      console.error(`Error processing uploaded file ${fileName}:`, error);
    }
  }

  console.log(`✓ ${clips.length} new clip(s) to process`);
  return clips;
}

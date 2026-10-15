/**
 * FTP clip discovery - scans the FTP upload directory for video files the
 * camera has pushed, parses camera/timestamp metadata from the Reolink FTP
 * filename convention, extracts a JPEG thumbnail via ffmpeg, and returns
 * clip objects shaped like the rest of the app expects.
 */

import * as fs from 'fs';
import * as path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { FFMPEG_PATH } from './ffmpeg-path.ts';
import type { Storage } from './storage.ts';
import type { DiscoveredClip } from './types.ts';

ffmpeg.setFfmpegPath(FFMPEG_PATH);

const VIDEO_EXTENSIONS = new Set(['mp4', '264', '265', 'h264', 'h265']);

// Reolink FTP filename convention: [CameraName]_[ChannelNumber]_[Timestamp].[Extension]
const FILENAME_PATTERN = /^(.+)_(\d+)_(\d{14})\.(\w+)$/i;

const TIMESTAMP_PATTERN = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;

/**
 * Parse a YYYYMMDDHHMMSS string into a local-time Date.
 */
function parseLocalTimestamp(timestamp: string): Date {
  // Done dependency-free to avoid pulling in moment.js or similar just for this.
  // Date() doesn't recognize YYYYMMDDHHMMSS, so we have to parse it manually and construct a Date.
  const [, year, month, day, hour, minute, second] = timestamp.match(TIMESTAMP_PATTERN)!.map(Number) as number[];
  return new Date(year, month - 1, day, hour, minute, second);
}

/**
 * Recursively list video files (one level of subdirectory nesting) under uploadDir.
 */
function listVideoFiles(uploadDir: string): { filePath: string; fileName: string }[] {
  const results: { filePath: string; fileName: string }[] = [];
  if (!fs.existsSync(uploadDir)) return results;

  const walk = (dir: string, depth: number) => {
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
 */
function parseClipMetadata(filePath: string, fileName: string, defaultCameraName: string | undefined): { cameraName: string | undefined; timestamp: Date } {
  const match = fileName.match(FILENAME_PATTERN);
  if (match) {
    const [, cameraName, , timestampStr] = match as [string, string, string, string];
    return { cameraName, timestamp: parseLocalTimestamp(timestampStr) };
  }

  console.warn(`FTP upload "${fileName}" does not match the expected [Camera]_[Channel]_[Timestamp].[Ext] pattern; falling back to file mtime and CAMERA_NAME`);
  return { cameraName: defaultCameraName, timestamp: fs.statSync(filePath).mtime };
}

/**
 * Extract a single JPEG frame from a video file, unless the thumbnail already exists.
 */
function extractThumbnail(videoPath: string, thumbnailPath: string): Promise<void> {
  if (fs.existsSync(thumbnailPath)) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    // A fixed offset (rather than a "50%" timestamp) avoids fluent-ffmpeg's
    // duration probe, which requires ffprobe - a binary ffmpeg-static doesn't bundle.
    ffmpeg(videoPath)
      .on('end', () => resolve())
      .on('error', reject)
      .screenshots({
        timestamps: [1],
        filename: path.basename(thumbnailPath),
        folder: path.dirname(thumbnailPath),
      });
  });
}

/**
 * Delete an uploaded video that won't be processed, logging (not throwing) on failure.
 */
function removeUpload(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch (error) {
    console.error(`Error removing duplicate upload ${filePath}:`, error);
  }
}

/**
 * Scan uploadDir for new video files, parse metadata, extract thumbnails,
 * and return clip objects for anything not already in storage.
 *
 * Duplicate uploads are deleted rather than left to be rescanned every tick:
 * one whose clip ID is already in storage (e.g. a camera re-upload), or a
 * second upload in the same scan that resolves to the same clip ID (e.g. two
 * channels recording in the same second) - the first one that yields a
 * clip wins.
 *
 * @param defaultCameraName - fallback device_name if filename doesn't match the expected pattern
 * @returns new clips, each with localThumbnailPath/localVideoPath set
 */
export async function discoverNewClips(storage: Pick<Storage, 'data'>, uploadDir: string, downloadDir: string, defaultCameraName: string | undefined): Promise<DiscoveredClip[]> {
  const files = listVideoFiles(uploadDir);
  console.log(`✓ Found ${files.length} uploaded video file(s)`);

  const processedIds = storage.data();
  const seenIds = new Set<number>();
  const clips: DiscoveredClip[] = [];

  for (const { filePath, fileName } of files) {
    try {
      const { cameraName, timestamp } = parseClipMetadata(filePath, fileName, defaultCameraName);
      const id = Math.floor(timestamp.getTime() / 1000);

      if (processedIds[id]) {
        console.log(`✓ Skipping already processed clip: ${id} (${fileName}); removing upload`);
        removeUpload(filePath);
        continue;
      }
      if (seenIds.has(id)) {
        console.log(`✓ Skipping duplicate upload for clip ${id} in this batch (${fileName}); removing upload`);
        removeUpload(filePath);
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
      seenIds.add(id);
    } catch (error) {
      console.error(`Error processing uploaded file ${fileName}:`, error);
    }
  }

  console.log(`✓ ${clips.length} new clip(s) to process`);
  return clips;
}

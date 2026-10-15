/**
 * Shared test helpers.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach } from 'vitest';

/**
 * Returns a function that creates a fresh temp directory, and registers an
 * afterEach hook that removes every directory it created. Call at the top
 * level of a test file (or describe block).
 *
 * @returns {() => string}
 */
export function useTempDirs() {
  const created: string[] = [];
  afterEach(() => {
    for (const dir of created.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  return () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'winging-it-test-'));
    created.push(dir);
    return dir;
  };
}

/**
 * Formats a Date as the YYYYMMDDHHMMSS local-time string Reolink uses in FTP filenames.
 * @param {Date} date
 * @returns {string}
 */
export function reolinkTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/**
 * Types a partial stand-in (e.g. a fake Storage with only the methods a test
 * needs) as the real thing, for passing to code under test.
 */
export function fake<T>(value: object): T {
  return value as T;
}

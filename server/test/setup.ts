/**
 * Global test setup: silence the app's console output so test runs stay
 * readable. Tests that care about logging assert against these spies.
 */

import { beforeEach, vi } from 'vitest';

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

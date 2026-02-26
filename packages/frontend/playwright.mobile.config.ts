import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const enableTraceOnFailure = process.env.E2E_TRACE_ON_FAILURE === '1';
const DEFAULT_MOBILE_VIEWPORT_WIDTH = 375;
const DEFAULT_MOBILE_VIEWPORT_HEIGHT = 667;

function parseViewportDimension(
  envValue: string | undefined,
  defaultValue: number,
): number {
  if (!envValue) {
    return defaultValue;
  }
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

const width = parseViewportDimension(
  process.env.E2E_VIEWPORT_WIDTH,
  DEFAULT_MOBILE_VIEWPORT_WIDTH,
);
const height = parseViewportDimension(
  process.env.E2E_VIEWPORT_HEIGHT,
  DEFAULT_MOBILE_VIEWPORT_HEIGHT,
);

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  workers: 1,
  expect: {
    timeout: 20_000,
  },
  reporter: [['list']],
  use: {
    baseURL,
    viewport: { width, height },
    trace: enableTraceOnFailure ? 'retain-on-failure' : 'off',
    screenshot: 'off',
    video: 'off',
  },
});

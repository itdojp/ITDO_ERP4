import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const enableTraceOnFailure = process.env.E2E_TRACE_ON_FAILURE === '1';
const width = Number(process.env.E2E_VIEWPORT_WIDTH || '375');
const height = Number(process.env.E2E_VIEWPORT_HEIGHT || '667');

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

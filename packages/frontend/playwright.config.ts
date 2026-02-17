import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const enableTraceOnFailure = process.env.E2E_TRACE_ON_FAILURE === '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  expect: {
    timeout: 15_000,
  },
  reporter: [['list']],
  use: {
    baseURL,
    viewport: { width: 1280, height: 720 },
    trace: enableTraceOnFailure ? 'retain-on-failure' : 'off',
    screenshot: 'off',
    video: 'off',
  },
});

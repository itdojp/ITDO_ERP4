import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';

type CoverageThresholdConfig = Record<
  string,
  {
    files: string[];
  }
>;

const coverageThresholdConfig = JSON.parse(
  fs.readFileSync(
    new URL('./coverage-thresholds.json', import.meta.url),
    'utf8',
  ),
) as CoverageThresholdConfig;

const uiCoreCoverageInclude = coverageThresholdConfig['ui-core'].files;

const coverageInclude =
  process.env.FRONTEND_COVERAGE_SCOPE === 'ui-core'
    ? uiCoreCoverageInclude
    : ['src/**/*.{ts,tsx}'];
const coverageReportsDirectory =
  process.env.FRONTEND_COVERAGE_SCOPE === 'ui-core'
    ? './coverage/ui-core'
    : './coverage/full';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reportsDirectory: coverageReportsDirectory,
      reporter: ['text-summary', 'json-summary', 'lcov'],
      include: coverageInclude,
      exclude: ['src/**/*.test.{ts,tsx}', 'src/vite-env.d.ts', 'src/test/**'],
    },
  },
});

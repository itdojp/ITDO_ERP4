import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';

type CoverageThresholdScope = {
  files?: unknown;
};

type CoverageThresholdConfig = Record<string, CoverageThresholdScope>;

function readUiCoreCoverageInclude(): string[] {
  const coverageThresholdConfig = JSON.parse(
    fs.readFileSync(
      new URL('./coverage-thresholds.json', import.meta.url),
      'utf8',
    ),
  ) as CoverageThresholdConfig;
  const uiCoreScope = coverageThresholdConfig['ui-core'];
  if (!uiCoreScope || typeof uiCoreScope !== 'object') {
    throw new Error(
      'coverage-thresholds.json must define a ui-core coverage scope',
    );
  }
  const { files } = uiCoreScope;
  if (
    !Array.isArray(files) ||
    files.length === 0 ||
    files.some((file) => typeof file !== 'string' || file.length === 0)
  ) {
    throw new Error(
      'coverage-thresholds.json ui-core.files must be a non-empty string array',
    );
  }
  return files;
}

const isUiCoreCoverage = process.env.FRONTEND_COVERAGE_SCOPE === 'ui-core';
const coverageInclude = isUiCoreCoverage
  ? readUiCoreCoverageInclude()
  : ['src/**/*.{ts,tsx}'];
const coverageReportsDirectory = isUiCoreCoverage
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

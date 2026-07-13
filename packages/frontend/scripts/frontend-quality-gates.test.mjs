import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const FRONTEND_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const SCRIPT_PATH = path.join(
  FRONTEND_DIR,
  'scripts/check-coverage-thresholds.mjs',
);
const TEST_TEMP_DIR = path.join(
  FRONTEND_DIR,
  'tmp',
  'frontend-quality-gates-test',
);
const require = createRequire(import.meta.url);

afterEach(() => {
  rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
  rmSync(path.join(FRONTEND_DIR, 'src/__quality_gate_tmp__'), {
    recursive: true,
    force: true,
  });
});

function withTempDir(fn) {
  mkdirSync(TEST_TEMP_DIR, { recursive: true });
  const dir = mkdtempSync(path.join(TEST_TEMP_DIR, 'fixture-'));
  return fn(dir);
}

function readCoverageThresholdConfig() {
  return JSON.parse(
    readFileSync(path.join(FRONTEND_DIR, 'coverage-thresholds.json'), 'utf8'),
  );
}

function listSourceFilesRecursive(relativeDir) {
  const dir = path.join(FRONTEND_DIR, relativeDir);
  return readdirSync(dir)
    .flatMap((name) => {
      const absolutePath = path.join(dir, name);
      const relativePath = `${relativeDir}/${name}`;
      if (statSync(absolutePath).isDirectory()) {
        return listSourceFilesRecursive(relativePath);
      }
      return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)
        ? [relativePath]
        : [];
    })
    .sort();
}

function expectedServerStateCoverageFiles() {
  return [
    'src/sections/AdminSettings.tsx',
    'src/sections/RoomChat.tsx',
    ...listSourceFilesRecursive('src/sections/admin-settings'),
    ...listSourceFilesRecursive('src/sections/room-chat'),
  ].sort();
}

function assertUiCoreCoverageCompleteness(files) {
  const configured = new Set(files);
  const missing = expectedServerStateCoverageFiles().filter(
    (file) => !configured.has(file),
  );
  if (missing.length > 0) {
    throw new Error(
      `ui-core coverage scope is missing required server-state file(s): ${missing.join(', ')}`,
    );
  }
}

function metric(pct) {
  return {
    total: 100,
    covered: pct,
    skipped: 0,
    pct,
  };
}

function writeCoverageFixture(
  dir,
  {
    file = 'src/main.tsx',
    pct = 95,
    threshold = 90,
    includeSummaryFile = true,
  } = {},
) {
  const summaryPath = path.join(dir, 'coverage-summary.json');
  const configPath = path.join(dir, 'coverage-thresholds.json');
  const summary = {
    total: {
      statements: metric(pct),
      branches: metric(pct),
      functions: metric(pct),
      lines: metric(pct),
    },
  };
  if (includeSummaryFile) {
    summary[path.join(FRONTEND_DIR, file)] = {
      statements: metric(pct),
      branches: metric(pct),
      functions: metric(pct),
      lines: metric(pct),
    };
  }
  writeFileSync(summaryPath, JSON.stringify(summary));
  writeFileSync(
    configPath,
    JSON.stringify({
      'ui-core': {
        summary: summaryPath,
        thresholds: {
          statements: threshold,
          branches: threshold,
          functions: threshold,
          lines: threshold,
        },
        files: [file],
      },
    }),
  );

  return { configPath, summaryPath };
}

function runCoverageCheck(configPath) {
  return spawnSync(
    process.execPath,
    [SCRIPT_PATH, '--scope', 'ui-core', '--config', configPath],
    { cwd: FRONTEND_DIR, encoding: 'utf8' },
  );
}

test('frontend ESLint default max-lines gate stays at 2000 lines', () => {
  const eslintConfig = require('../eslint.config.cjs');
  const sourceConfig = eslintConfig.find((entry) =>
    entry.files?.includes('src/**/*.{ts,tsx,js,jsx}'),
  );

  assert.equal(sourceConfig?.rules?.['max-lines']?.[1]?.max, 2000);
});

test('lint fails for a production module above the 2000-line gate', () => {
  const dir = path.join(FRONTEND_DIR, 'src/__quality_gate_tmp__');
  mkdirSync(dir, { recursive: true });
  const oversizedFile = path.join(dir, 'Oversized.tsx');
  writeFileSync(
    oversizedFile,
    Array.from(
      { length: 2001 },
      (_, index) => `export const line${index} = ${index};`,
    ).join('\n'),
  );

  const result = spawnSync(
    process.execPath,
    [
      'node_modules/eslint/bin/eslint.js',
      'src/__quality_gate_tmp__/Oversized.tsx',
    ],
    { cwd: FRONTEND_DIR, encoding: 'utf8' },
  );

  assert.equal(result.status, 1);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /max-lines|Maximum allowed is 2000|too many lines/i,
  );
});

test('ui-core coverage includes AdminSettings and RoomChat server-state files', () => {
  const config = readCoverageThresholdConfig();

  assertUiCoreCoverageCompleteness(config['ui-core'].files);
});

test('ui-core coverage completeness detects a missing server-state target', () => {
  const config = readCoverageThresholdConfig();
  const reducedFiles = config['ui-core'].files.filter(
    (file) => file !== 'src/sections/room-chat/useRoomChatMessages.ts',
  );

  assert.throws(
    () => assertUiCoreCoverageCompleteness(reducedFiles),
    /useRoomChatMessages\.ts/,
  );
});

test('coverage threshold script passes when configured files meet thresholds', () =>
  withTempDir((dir) => {
    const { configPath } = writeCoverageFixture(dir);

    const result = runCoverageCheck(configPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ui-core statements: 95\.00% >= 90\.00% PASS/);
  }));

test('coverage threshold script fails when a major test removal drops coverage below threshold', () =>
  withTempDir((dir) => {
    const { configPath } = writeCoverageFixture(dir, {
      pct: 50,
      threshold: 90,
    });

    const result = runCoverageCheck(configPath);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /ui-core statements: 50\.00% >= 90\.00% FAIL/);
    assert.match(result.stderr, /coverage threshold failed for ui-core/);
  }));

test('coverage threshold script fails on stale configured files', () =>
  withTempDir((dir) => {
    const { configPath } = writeCoverageFixture(dir, {
      file: 'src/removed-ui-core-file.tsx',
    });

    const result = runCoverageCheck(configPath);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /coverage configured file does not exist: src\/removed-ui-core-file\.tsx/,
    );
  }));

test('coverage threshold script fails when a configured file is absent from summary', () =>
  withTempDir((dir) => {
    const { configPath } = writeCoverageFixture(dir, {
      file: 'src/main.tsx',
      includeSummaryFile: false,
    });

    const result = runCoverageCheck(configPath);

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /coverage summary is missing configured file\(s\): src\/main\.tsx/,
    );
  }));

test('ui-core coverage thresholds stay above the post-extraction baseline gate', () => {
  const config = readCoverageThresholdConfig();
  const minimums = {
    statements: 68.0,
    branches: 61.0,
    functions: 67.0,
    lines: 70.5,
  };

  for (const [metricName, minimum] of Object.entries(minimums)) {
    assert.ok(
      config['ui-core'].thresholds[metricName] >= minimum,
      `ui-core ${metricName} threshold should stay >= ${minimum}`,
    );
  }
});

test('coverage configured source files exist on disk', () => {
  const config = readCoverageThresholdConfig();

  for (const file of config['ui-core'].files) {
    assert.ok(
      existsSync(path.join(FRONTEND_DIR, file)),
      `ui-core coverage file should exist: ${file}`,
    );
  }
});

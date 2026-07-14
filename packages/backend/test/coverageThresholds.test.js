import assert from 'node:assert/strict';
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
import test, { after } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const BACKEND_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const SCRIPT_PATH = path.join(
  BACKEND_DIR,
  'scripts/check-coverage-thresholds.mjs',
);
const REPO_ROOT = path.resolve(BACKEND_DIR, '..', '..');
const TEST_TEMP_DIR = path.join(REPO_ROOT, 'tmp', 'coverage-thresholds-test');
const require = createRequire(import.meta.url);

after(() => {
  rmSync(TEST_TEMP_DIR, { recursive: true, force: true });
});

function withTempDir(fn) {
  mkdirSync(TEST_TEMP_DIR, { recursive: true });
  const dir = mkdtempSync(path.join(TEST_TEMP_DIR, 'coverage-thresholds-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    try {
      rmSync(TEST_TEMP_DIR);
    } catch {
      // Another concurrently running fixture may still own files in the base directory.
    }
  }
}

function writeFixture(dir, thresholds) {
  const summaryPath = path.join(dir, 'coverage-summary.json');
  const configPath = path.join(dir, 'coverage-thresholds.json');
  writeFileSync(
    summaryPath,
    JSON.stringify({
      total: {
        statements: { pct: 26.49 },
        branches: { pct: 65.83 },
        functions: { pct: 19.34 },
        lines: { pct: 26.49 },
      },
    }),
  );
  writeFileSync(
    configPath,
    JSON.stringify({
      auth: {
        summary: summaryPath,
        thresholds,
      },
    }),
  );
  return { configPath };
}

function readCoverageThresholdConfig() {
  const configPath = path.join(BACKEND_DIR, 'coverage-thresholds.json');
  return JSON.parse(readFileSync(configPath, 'utf8'));
}

function listSourceFiles(relativeDir) {
  return readdirSync(path.join(BACKEND_DIR, relativeDir))
    .filter((name) => name.endsWith('.ts'))
    .map((name) => `${relativeDir}/${name}`);
}

function listSourceFilesMatching(relativeDir, pattern) {
  return readdirSync(path.join(BACKEND_DIR, relativeDir))
    .filter((name) => name.endsWith('.ts') && pattern.test(name))
    .map((name) => `${relativeDir}/${name}`);
}

function listSourceFilesRecursive(relativeDir) {
  const dir = path.join(BACKEND_DIR, relativeDir);
  return readdirSync(dir)
    .flatMap((name) => {
      const absolutePath = path.join(dir, name);
      const relativePath = `${relativeDir}/${name}`;
      if (statSync(absolutePath).isDirectory()) {
        return listSourceFilesRecursive(relativePath);
      }
      return name.endsWith('.ts') ? [relativePath] : [];
    })
    .sort();
}

function listBackendSourceFiles() {
  return listSourceFilesRecursive('src');
}

function countNonBlankLines(relativePath) {
  const content = readFileSync(path.join(BACKEND_DIR, relativePath), 'utf8');
  return content.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

test('coverage threshold script passes when all metrics meet the scope threshold', () =>
  withTempDir((dir) => {
    const { configPath } = writeFixture(dir, {
      statements: 25,
      branches: 60,
      functions: 18,
      lines: 25,
    });

    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, '--scope', 'auth', '--config', configPath],
      { cwd: BACKEND_DIR, encoding: 'utf8' },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /auth statements: 26\.49% >= 25\.00% PASS/);
    assert.match(result.stdout, /auth branches: 65\.83% >= 60\.00% PASS/);
  }));

test('coverage threshold script fails when any metric is below threshold', () =>
  withTempDir((dir) => {
    const { configPath } = writeFixture(dir, {
      statements: 30,
      branches: 60,
      functions: 18,
      lines: 25,
    });

    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, '--scope', 'auth', '--config', configPath],
      { cwd: BACKEND_DIR, encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /auth statements: 26\.49% >= 30\.00% FAIL/);
    assert.match(result.stderr, /coverage threshold failed for auth/);
  }));

test('coverage threshold script reports missing option values clearly', () =>
  withTempDir((dir) => {
    const { configPath } = writeFixture(dir, {
      statements: 25,
    });

    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, '--scope', '--config', configPath],
      { cwd: BACKEND_DIR, encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing value for --scope/);
  }));

test('coverage threshold script reports invalid threshold metrics clearly', () =>
  withTempDir((dir) => {
    const { configPath } = writeFixture(dir, {
      statements: '25',
    });

    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, '--scope', 'auth', '--config', configPath],
      { cwd: BACKEND_DIR, encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /invalid threshold for metric statements: expected number/,
    );
  }));

test('coverage threshold script reports stale configured source files clearly', () =>
  withTempDir((dir) => {
    const summaryPath = path.join(dir, 'coverage-summary.json');
    const configPath = path.join(dir, 'coverage-thresholds.json');

    writeFileSync(
      summaryPath,
      JSON.stringify({
        total: {
          statements: { total: 1, covered: 1, pct: 100 },
          branches: { total: 1, covered: 1, pct: 100 },
          functions: { total: 1, covered: 1, pct: 100 },
          lines: { total: 1, covered: 1, pct: 100 },
        },
      }),
    );
    writeFileSync(
      configPath,
      JSON.stringify({
        auth: {
          summary: summaryPath,
          files: ['src/routes/auth/removedAuthRoute.ts'],
          thresholds: { statements: 100 },
        },
      }),
    );

    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, '--scope', 'auth', '--config', configPath],
      { cwd: BACKEND_DIR, encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /coverage configured file does not exist: src\/routes\/auth\/removedAuthRoute\.ts/,
    );
  }));

test('coverage threshold script aggregates configured files instead of repository total', () =>
  withTempDir((dir) => {
    const summaryPath = path.join(dir, 'coverage-summary.json');
    const configPath = path.join(dir, 'coverage-thresholds.json');
    const authFile = path.join(BACKEND_DIR, 'src/plugins/auth.ts');
    const unrelatedFile = path.join(BACKEND_DIR, 'src/unrelated.ts');

    writeFileSync(
      summaryPath,
      JSON.stringify({
        total: {
          statements: { total: 200, covered: 50, pct: 25 },
          branches: { total: 200, covered: 50, pct: 25 },
          functions: { total: 200, covered: 50, pct: 25 },
          lines: { total: 200, covered: 50, pct: 25 },
        },
        [authFile]: {
          statements: { total: 10, covered: 9, pct: 90 },
          branches: { total: 10, covered: 9, pct: 90 },
          functions: { total: 10, covered: 9, pct: 90 },
          lines: { total: 10, covered: 9, pct: 90 },
        },
        [unrelatedFile]: {
          statements: { total: 190, covered: 41, pct: 21.57 },
          branches: { total: 190, covered: 41, pct: 21.57 },
          functions: { total: 190, covered: 41, pct: 21.57 },
          lines: { total: 190, covered: 41, pct: 21.57 },
        },
      }),
    );
    writeFileSync(
      configPath,
      JSON.stringify({
        auth: {
          summary: summaryPath,
          files: ['src/plugins/auth.ts'],
          thresholds: {
            statements: 80,
            branches: 80,
            functions: 80,
            lines: 80,
          },
        },
      }),
    );

    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, '--scope', 'auth', '--config', configPath],
      { cwd: BACKEND_DIR, encoding: 'utf8' },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /auth statements: 90\.00% >= 80\.00% PASS/);
  }));

test('integrations coverage scope includes current integration route and service files', () => {
  const config = readCoverageThresholdConfig();
  const configuredFiles = [...config.integrations.files].sort();
  const integrationServicePattern =
    /^(accountingIcsExport|accountingMappingRules|attendanceClosings|integration[A-Z].*|statutoryAccountingActuals)\.ts$/;
  const expectedFiles = [
    'src/routes/integrations.ts',
    ...readdirSync(path.join(BACKEND_DIR, 'src/services'))
      .filter((name) => integrationServicePattern.test(name))
      .map((name) => `src/services/${name}`),
  ].sort();

  assert.deepEqual(configuredFiles, expectedFiles);
});

test('auth coverage scope includes all split auth routes, application services, and required auth services', () => {
  const config = readCoverageThresholdConfig();
  const configuredFiles = [...config.auth.files].sort();
  const expectedFiles = [
    'src/plugins/auth.ts',
    'src/routes/auth.ts',
    ...listSourceFiles('src/routes/auth'),
    ...listSourceFiles('src/application/auth'),
    'src/services/authContext.ts',
    'src/services/authGateway.ts',
    'src/services/envValidation.ts',
    'src/services/localCredentials.ts',
    'src/utils/authGroupToRoleMap.ts',
  ].sort();

  assert.deepEqual(configuredFiles, expectedFiles);
});

test('auth coverage thresholds stay above the post-split baseline gate', () => {
  const config = readCoverageThresholdConfig();
  const minimums = {
    statements: 89.7,
    branches: 70.5,
    functions: 97.9,
    lines: 89.7,
  };

  for (const [metric, minimum] of Object.entries(minimums)) {
    assert.ok(
      config.auth.thresholds[metric] >= minimum,
      `auth ${metric} threshold should stay >= ${minimum}`,
    );
  }
});

test('chat coverage scope includes current route modules, lifecycle services, notification effects, and default adapter', () => {
  const config = readCoverageThresholdConfig();
  const configuredFiles = [...config.chat.files].sort();
  const chatServicePattern = /^(chat[A-Z].*|personalGaChatRoom)\.ts$/;
  const expectedFiles = [
    ...listSourceFilesMatching('src/routes', /^chat[^/]*\.ts$/),
    ...listSourceFilesRecursive('src/routes/chat'),
    ...listSourceFilesRecursive('src/routes/chatRooms'),
    ...readdirSync(path.join(BACKEND_DIR, 'src/services'))
      .filter((name) => chatServicePattern.test(name))
      .map((name) => `src/services/${name}`),
    ...listSourceFilesRecursive('src/application/chat'),
    'src/adapters/notifications/chatNotificationAdapter.ts',
  ].sort();

  assert.deepEqual(configuredFiles, expectedFiles);
});

test('chat coverage thresholds stay above the route-split baseline gate', () => {
  const config = readCoverageThresholdConfig();
  const minimums = {
    statements: 53.4,
    branches: 59.4,
    functions: 70.1,
    lines: 53.4,
  };

  for (const [metric, minimum] of Object.entries(minimums)) {
    assert.ok(
      config.chat.thresholds[metric] >= minimum,
      `chat ${metric} threshold should stay >= ${minimum}`,
    );
  }
});

test('chat route and application modules stay within the default backend line gate', () => {
  const config = readCoverageThresholdConfig();
  const chatFiles = config.chat.files.filter(
    (file) =>
      file.startsWith('src/routes/chat') ||
      file.startsWith('src/application/chat'),
  );

  for (const file of chatFiles) {
    assert.ok(
      countNonBlankLines(file) <= 1500,
      `${file} should stay below the default 1500-line backend gate`,
    );
  }
});

test('chat route uses the default max-lines gate without a temporary allowance', () => {
  const eslintConfig = require('../eslint.config.cjs');
  const sourceConfig = eslintConfig.find((entry) =>
    entry.files?.includes('src/**/*.{ts,tsx}'),
  );
  const maxLinesRule = sourceConfig?.rules?.['max-lines'];
  assert.equal(maxLinesRule?.[1]?.max, 1500);

  const chatOverrides = eslintConfig.filter((entry) =>
    entry.files?.includes('src/routes/chat.ts'),
  );
  assert.deepEqual(chatOverrides, []);
});

test('projects coverage scope covers current Org & Project modules and shared project helpers', () => {
  const config = readCoverageThresholdConfig();
  const { contexts } = require('../bounded-context-registry.cjs');
  const orgProject = contexts.find((context) => context.name === 'org-project');
  assert.ok(orgProject, 'org-project context must exist');

  const orgProjectRegexes = orgProject.patterns.map(
    (pattern) => new RegExp(pattern),
  );
  const orgProjectFiles = listBackendSourceFiles().filter((file) =>
    orgProjectRegexes.some((regex) => regex.test(file)),
  );
  const expectedFiles = [
    ...orgProjectFiles,
    ...listSourceFilesRecursive('src/application/projects'),
    'src/services/dueDateRule.ts',
  ].sort();
  const configuredFiles = [...config.projects.files].sort();

  assert.deepEqual(configuredFiles, expectedFiles);
});

test('projects coverage thresholds stay above the route-split baseline gate', () => {
  const config = readCoverageThresholdConfig();
  const minimums = {
    statements: 66.2,
    branches: 59.5,
    functions: 77.8,
    lines: 66.2,
  };

  for (const [metric, minimum] of Object.entries(minimums)) {
    assert.ok(
      config.projects.thresholds[metric] >= minimum,
      `projects ${metric} threshold should stay >= ${minimum}`,
    );
  }
});

test('project route and application modules stay within the default backend line gate', () => {
  const config = readCoverageThresholdConfig();
  const projectFiles = config.projects.files.filter(
    (file) =>
      file.startsWith('src/routes/projects') ||
      file.startsWith('src/application/projects'),
  );

  for (const file of projectFiles) {
    assert.ok(
      countNonBlankLines(file) <= 1500,
      `${file} should stay below the default 1500-line backend gate`,
    );
  }
});

test('projects route uses the default max-lines gate without a temporary allowance', () => {
  const eslintConfig = require('../eslint.config.cjs');
  const sourceConfig = eslintConfig.find((entry) =>
    entry.files?.includes('src/**/*.{ts,tsx}'),
  );
  const maxLinesRule = sourceConfig?.rules?.['max-lines'];
  assert.equal(maxLinesRule?.[1]?.max, 1500);

  const projectOverrides = eslintConfig.filter((entry) =>
    entry.files?.includes('src/routes/projects.ts'),
  );
  assert.deepEqual(projectOverrides, []);
});

test('report subscriptions route uses the default max-lines gate without a temporary allowance', () => {
  assert.ok(
    countNonBlankLines('src/routes/reportSubscriptions.ts') <= 1500,
    'src/routes/reportSubscriptions.ts should stay below the default 1500-line backend gate',
  );

  const eslintConfig = require('../eslint.config.cjs');
  const sourceConfig = eslintConfig.find((entry) =>
    entry.files?.includes('src/**/*.{ts,tsx}'),
  );
  const maxLinesRule = sourceConfig?.rules?.['max-lines'];
  assert.equal(maxLinesRule?.[1]?.max, 1500);

  const reportSubscriptionOverrides = eslintConfig.filter((entry) =>
    entry.files?.includes('src/routes/reportSubscriptions.ts'),
  );
  assert.deepEqual(reportSubscriptionOverrides, []);
});

test('workflow coverage scope covers Workflow context plus application boundary and escalation service', () => {
  const config = readCoverageThresholdConfig();
  const { contexts } = require('../bounded-context-registry.cjs');
  const workflow = contexts.find((context) => context.name === 'workflow');
  assert.ok(workflow, 'workflow context must exist');

  const workflowRegexes = workflow.patterns.map(
    (pattern) => new RegExp(pattern),
  );
  const workflowContextFiles = listBackendSourceFiles().filter((file) =>
    workflowRegexes.some((regex) => regex.test(file)),
  );
  const expectedFiles = [
    ...workflowContextFiles,
    ...listSourceFilesRecursive('src/application/workflow'),
    'src/services/approvalEscalation.ts',
  ].sort();
  const configuredFiles = [...config.workflow.files].sort();

  assert.deepEqual(configuredFiles, expectedFiles);
  assert.equal(configuredFiles.length, 16);
});

test('workflow coverage thresholds stay above the initial focused baseline gate', () => {
  const config = readCoverageThresholdConfig();
  const minimums = {
    statements: 70.7,
    branches: 70.5,
    functions: 84.8,
    lines: 70.7,
  };

  for (const [metric, minimum] of Object.entries(minimums)) {
    assert.ok(
      config.workflow.thresholds[metric] >= minimum,
      `workflow ${metric} threshold should stay >= ${minimum}`,
    );
  }
});

test('workflow coverage threshold check fails when focused coverage drops below baseline', () =>
  withTempDir((dir) => {
    const summaryPath = path.join(dir, 'coverage-summary.json');
    const configPath = path.join(dir, 'coverage-thresholds.json');
    const workflowFile = path.join(BACKEND_DIR, 'src/services/actionPolicy.ts');

    writeFileSync(
      summaryPath,
      JSON.stringify({
        total: {
          statements: { total: 100, covered: 100, pct: 100 },
          branches: { total: 100, covered: 100, pct: 100 },
          functions: { total: 100, covered: 100, pct: 100 },
          lines: { total: 100, covered: 100, pct: 100 },
        },
        [workflowFile]: {
          statements: { total: 100, covered: 70, pct: 70 },
          branches: { total: 100, covered: 70, pct: 70 },
          functions: { total: 100, covered: 84, pct: 84 },
          lines: { total: 100, covered: 70, pct: 70 },
        },
      }),
    );
    writeFileSync(
      configPath,
      JSON.stringify({
        workflow: {
          summary: summaryPath,
          files: ['src/services/actionPolicy.ts'],
          thresholds: {
            statements: 70.7,
            branches: 70.5,
            functions: 84.8,
            lines: 70.7,
          },
        },
      }),
    );

    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, '--scope', 'workflow', '--config', configPath],
      { cwd: BACKEND_DIR, encoding: 'utf8' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /workflow statements: 70\.00% >= 70\.70% FAIL/);
    assert.match(result.stdout, /workflow branches: 70\.00% >= 70\.50% FAIL/);
    assert.match(result.stdout, /workflow functions: 84\.00% >= 84\.80% FAIL/);
    assert.match(result.stdout, /workflow lines: 70\.00% >= 70\.70% FAIL/);
    assert.match(result.stderr, /coverage threshold failed for workflow/);
  }));

test('coverage configured source files exist on disk', () => {
  const config = readCoverageThresholdConfig();

  for (const [scope, scopeConfig] of Object.entries(config)) {
    for (const file of scopeConfig.files || []) {
      assert.ok(
        existsSync(path.join(BACKEND_DIR, file)),
        `${scope} coverage file should exist: ${file}`,
      );
    }
  }
});

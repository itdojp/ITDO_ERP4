import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const BACKEND_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const ROOT_DIR = path.resolve(BACKEND_DIR, '../..');
const SCRIPT_PATH = path.join(
  BACKEND_DIR,
  'scripts/check-bounded-context-coverage.mjs',
);
const require = createRequire(import.meta.url);

function runCoverage(args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: BACKEND_DIR,
    env: process.env,
    encoding: 'utf8',
  });
}

function withFixtureBackend(fn) {
  const tmpRoot = path.join(ROOT_DIR, 'tmp');
  mkdirSync(tmpRoot, { recursive: true });
  const dir = mkdtempSync(path.join(tmpRoot, 'bounded-context-coverage-'));
  try {
    mkdirSync(path.join(dir, 'src/routes'), { recursive: true });
    mkdirSync(path.join(dir, 'src/services'), { recursive: true });
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeFile(baseDir, relativePath, content = 'export {};\n') {
  const filePath = path.join(baseDir, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

function writeRegistry(baseDir, content) {
  const registryPath = path.join(baseDir, 'bounded-context-registry.cjs');
  writeFileSync(registryPath, content);
  return registryPath;
}

function runFixture(baseDir, registryPath) {
  return runCoverage([
    '--backend-root',
    baseDir,
    '--registry',
    registryPath,
    '--format',
    'json',
  ]);
}

test('bounded-context coverage: current backend tree passes', () => {
  const res = runCoverage(['--format', 'json']);
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  const data = JSON.parse(res.stdout);
  assert.equal(data.status, 'pass');
  assert.equal(data.summary.unclassifiedFiles, 0);
  assert.equal(data.summary.duplicateBoundedContextFiles, 0);
  assert.equal(data.summary.stalePatterns, 0);
});

test('bounded-context coverage: integrations coverage files are classified as integrations context', () => {
  const { contexts } = require('../bounded-context-registry.cjs');
  const coverageThresholds = require('../coverage-thresholds.json');
  const integrations = contexts.find(
    (context) => context.name === 'integrations',
  );
  assert.ok(integrations, 'integrations context must exist');
  const regexes = integrations.patterns.map((pattern) => new RegExp(pattern));
  for (const file of coverageThresholds.integrations.files) {
    assert.ok(
      regexes.some((regex) => regex.test(file)),
      `${file} must be classified by integrations context`,
    );
  }
});

test('bounded-context coverage: new routes/example.ts fixture fails when unclassified', () => {
  withFixtureBackend((dir) => {
    writeFile(dir, 'src/routes/known.ts');
    writeFile(dir, 'src/routes/example.ts');
    const registry = writeRegistry(
      dir,
      `module.exports = { contexts: [{ name: 'known', displayName: 'Known', patterns: ['^src/routes/known\\\\.ts$'] }], layers: [] };\n`,
    );
    const res = runFixture(dir, registry);
    assert.notEqual(res.status, 0);
    const data = JSON.parse(res.stdout);
    assert.equal(data.status, 'fail');
    assert.deepEqual(data.problems.unclassifiedFiles, [
      'src/routes/example.ts',
    ]);
  });
});

test('bounded-context coverage: new application file fixture fails when unclassified', () => {
  withFixtureBackend((dir) => {
    writeFile(dir, 'src/application/expenses/useCases.ts');
    const registry = writeRegistry(
      dir,
      `module.exports = { contexts: [], layers: [] };
`,
    );
    const res = runFixture(dir, registry);
    assert.notEqual(res.status, 0);
    const data = JSON.parse(res.stdout);
    assert.deepEqual(data.problems.unclassifiedFiles, [
      'src/application/expenses/useCases.ts',
    ]);
  });
});

test('bounded-context coverage: application-orchestration layer classifies application files', () => {
  withFixtureBackend((dir) => {
    writeFile(dir, 'src/application/expenses/useCases.ts');
    const registry = writeRegistry(
      dir,
      `module.exports = { contexts: [], layers: [
        {
          name: 'application-orchestration',
          kind: 'application-orchestration',
          displayName: 'Application orchestration',
          patterns: ['^src/application/expenses/.+\\.ts$'],
        },
      ] };
`,
    );
    const res = runFixture(dir, registry);
    assert.equal(
      res.status,
      0,
      `${res.stdout}
${res.stderr}`,
    );
    const data = JSON.parse(res.stdout);
    assert.equal(data.status, 'pass');
    assert.equal(data.summary.unclassifiedFiles, 0);
  });
});

test('bounded-context coverage: duplicate bounded-context classification fails', () => {
  withFixtureBackend((dir) => {
    writeFile(dir, 'src/services/duplicate.ts');
    const registry = writeRegistry(
      dir,
      `module.exports = { contexts: [
        { name: 'alpha', displayName: 'Alpha', patterns: ['^src/services/duplicate\\\\.ts$'] },
        { name: 'beta', displayName: 'Beta', patterns: ['^src/services/duplicate\\\\.ts$'] },
      ], layers: [] };\n`,
    );
    const res = runFixture(dir, registry);
    assert.notEqual(res.status, 0);
    const data = JSON.parse(res.stdout);
    assert.deepEqual(data.problems.duplicateBoundedContextFiles, [
      { file: 'src/services/duplicate.ts', contexts: ['alpha', 'beta'] },
    ]);
  });
});

test('bounded-context coverage: overlapping patterns in the same context are not duplicate contexts', () => {
  withFixtureBackend((dir) => {
    writeFile(dir, 'src/routes/known.ts');
    const registry = writeRegistry(
      dir,
      `module.exports = { contexts: [
        {
          name: 'known',
          displayName: 'Known',
          patterns: ['^src/routes/known\\\\.ts$', '^src/routes/.+\\\\.ts$'],
        },
      ], layers: [] };\n`,
    );
    const res = runFixture(dir, registry);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const data = JSON.parse(res.stdout);
    assert.deepEqual(data.problems.duplicateBoundedContextFiles, []);
  });
});

test('bounded-context coverage: stale patterns fail deterministically', () => {
  withFixtureBackend((dir) => {
    writeFile(dir, 'src/routes/known.ts');
    const registry = writeRegistry(
      dir,
      `module.exports = { contexts: [
        { name: 'known', displayName: 'Known', patterns: ['^src/routes/known\\\\.ts$', '^src/services/missing\\\\.ts$'] },
      ], layers: [] };\n`,
    );
    const res = runFixture(dir, registry);
    assert.notEqual(res.status, 0);
    const data = JSON.parse(res.stdout);
    assert.deepEqual(data.problems.stalePatterns, [
      {
        entry: 'known',
        kind: 'bounded-context',
        pattern: '^src/services/missing\\.ts$',
      },
    ]);
  });
});

test('bounded-context coverage: unnamed entries report deterministically without crashing', () => {
  withFixtureBackend((dir) => {
    writeFile(dir, 'src/routes/known.ts');
    const registry = writeRegistry(
      dir,
      `module.exports = { contexts: [
        { displayName: 'Missing name', patterns: ['^src/routes/known\\\\.ts$'] },
      ], layers: [] };\n`,
    );
    const res = runFixture(dir, registry);
    assert.notEqual(res.status, 0);
    const data = JSON.parse(res.stdout);
    assert.deepEqual(data.problems.invalidEntries, [
      {
        entry: '<unnamed>',
        reason: 'entry requires name and at least one pattern',
      },
    ]);
  });
});

test('bounded-context coverage: explicit generated exclusion with reason passes', () => {
  withFixtureBackend((dir) => {
    writeFile(dir, 'src/services/generatedClient.ts');
    const registry = writeRegistry(
      dir,
      `module.exports = { contexts: [], layers: [
        {
          name: 'generated-client',
          kind: 'generated',
          displayName: 'Generated client',
          reason: 'Fixture generated client is outside domain/application ownership.',
          patterns: ['^src/services/generatedClient\\\\.ts$'],
        },
      ] };\n`,
    );
    const res = runFixture(dir, registry);
    assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
    const data = JSON.parse(res.stdout);
    assert.equal(data.status, 'pass');
    assert.equal(data.summary.unclassifiedFiles, 0);
  });
});

test('bounded-context coverage: explicit exclusion without reason fails', () => {
  withFixtureBackend((dir) => {
    writeFile(dir, 'src/services/generatedClient.ts');
    const registry = writeRegistry(
      dir,
      `module.exports = { contexts: [], layers: [
        {
          name: 'generated-client',
          kind: 'generated',
          displayName: 'Generated client',
          patterns: ['^src/services/generatedClient\\\\.ts$'],
        },
      ] };\n`,
    );
    const res = runFixture(dir, registry);
    assert.notEqual(res.status, 0);
    const data = JSON.parse(res.stdout);
    assert.deepEqual(data.problems.invalidEntries, [
      {
        entry: 'generated-client',
        reason: 'generated entries require a non-empty reason',
      },
    ]);
  });
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  formatPoCliHelp,
  parsePoCliRequest,
  parsePoInputFormat,
  parsePoOnlyScopes,
  requirePoApplyConfirm,
} from '../dist/migration/poCli.js';
import {
  runPoMigration,
  runPoMigrationCli,
} from '../dist/migration/poRunner.js';
import { existsCache } from '../dist/migration/poImporterState.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function source(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function emptyPoInputs() {
  return {
    users: [],
    customers: [],
    vendors: [],
    projects: [],
    tasks: [],
    milestones: [],
    estimates: [],
    invoices: [],
    purchase_orders: [],
    vendor_quotes: [],
    vendor_invoices: [],
    time_entries: [],
    expenses: [],
  };
}

const silentLogger = { log: () => {}, error: () => {} };

const expectedHelp = [
  'Usage: scripts/migrate-po.ts [--input-dir=DIR] [--input-format=json|csv] [--only=users,customers,...] [--apply]',
  '',
  'Options:',
  '  --input-dir=DIR   Input directory (default: tmp/migration/po)',
  '  --input-format=F  Input format: json|csv (default: json)',
  '  --only=LIST       Comma-separated scopes: users,customers,vendors,projects,tasks,milestones,estimates,invoices,purchase_orders,vendor_quotes,vendor_invoices,time_entries,expenses',
  '  --apply           Apply changes to DB (requires MIGRATION_CONFIRM=1)',
  '',
  'Examples:',
  '  npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts',
  '  MIGRATION_CONFIRM=1 npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts --apply',
].join('\n');

test('po CLI help snapshot preserves existing options and text', async () => {
  assert.equal(formatPoCliHelp(), expectedHelp);

  const logs = [];
  const result = await runPoMigrationCli(
    ['--help'],
    {},
    { log: (msg) => logs.push(msg), error: () => {} },
  );
  assert.deepEqual(result, { exitCode: 0 });
  assert.deepEqual(logs, [expectedHelp]);
});

test('po CLI parser preserves defaults, aliases, only scopes, and apply confirmation', () => {
  assert.deepEqual(parsePoCliRequest([], {}), {
    kind: 'run',
    options: {
      inputDir: 'tmp/migration/po',
      inputFormat: 'json',
      apply: false,
      only: null,
    },
  });

  const parsed = parsePoCliRequest(
    [
      '--inputDir=custom/po',
      '--inputFormat=csv',
      '--only=users, projects',
      '--apply',
    ],
    { MIGRATION_CONFIRM: '1' },
  );
  assert.equal(parsed.kind, 'run');
  assert.equal(parsed.options.inputDir, 'custom/po');
  assert.equal(parsed.options.inputFormat, 'csv');
  assert.equal(parsed.options.apply, true);
  assert.deepEqual([...parsed.options.only], ['users', 'projects']);

  assert.throws(
    () => parsePoCliRequest(['--apply'], {}),
    /MIGRATION_CONFIRM=1 is required/,
  );
  assert.doesNotThrow(() =>
    requirePoApplyConfirm(true, { MIGRATION_CONFIRM: '1' }),
  );
});

test('po CLI parser preserves format and scope normalization semantics', () => {
  assert.equal(parsePoInputFormat(undefined), 'json');
  assert.equal(parsePoInputFormat(' JSON '), 'json');
  assert.equal(parsePoInputFormat('csv'), 'csv');
  assert.throws(
    () => parsePoInputFormat('yaml'),
    /invalid --input-format: yaml/,
  );

  assert.equal(parsePoOnlyScopes(undefined), null);
  assert.equal(parsePoOnlyScopes(' , '), null);
  assert.deepEqual(
    [...parsePoOnlyScopes('users,,projects, ')],
    ['users', 'projects'],
  );
});

test('migrate-po composition roots stay thin and delegate implementation modules', () => {
  const rootScript = source('scripts/migrate-po.ts');
  const builtEntrySource = source(
    'packages/backend/src/migration/poCliEntry.ts',
  );
  const combined = `${rootScript}\n${builtEntrySource}`;
  const rootLineCount = rootScript.trimEnd().split(/\r?\n/).length;
  const builtEntryLineCount = builtEntrySource.trimEnd().split(/\r?\n/).length;

  assert.ok(
    rootLineCount <= 1200,
    `scripts/migrate-po.ts line count ${rootLineCount} exceeds 1200`,
  );
  assert.ok(
    builtEntryLineCount <= 1200,
    `poCliEntry.ts line count ${builtEntryLineCount} exceeds 1200`,
  );
  assert.match(combined, /runPoMigrationCli/);
  assert.match(builtEntrySource, /prisma\.\$disconnect/);
  assert.doesNotMatch(
    combined,
    /readFileSync|parsePoCsvRecords|mapPo[A-Z]|nextNumber/,
  );
  assert.doesNotMatch(
    combined,
    /prisma\.(customer|project|invoice|purchaseOrder|vendorInvoice|timeEntry|expense)/,
  );
});

test('po migration run clears existence cache at invocation boundary', async () => {
  existsCache.project.set('stale-project', true);

  const result = await runPoMigration(
    {
      inputDir: 'tmp/migration/po',
      inputFormat: 'json',
      apply: false,
      only: null,
    },
    emptyPoInputs(),
    [],
    { logger: silentLogger, env: {} },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(existsCache.project.size, 0);
});

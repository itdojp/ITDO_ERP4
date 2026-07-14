import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readPoMigrationInputs } from '../dist/migration/poInputReader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const fixtureRoot = path.join(repoRoot, 'scripts/fixtures/po-migration');

function options(inputDir, inputFormat = 'json') {
  return { inputDir, inputFormat, apply: false, only: null };
}

function walkFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(abs));
    else if (entry.isFile()) files.push(abs);
  }
  return files.sort();
}

test('po input reader loads the synthetic all-entity JSON fixture without errors', () => {
  const errors = [];
  const inputs = readPoMigrationInputs(
    options(path.join(fixtureRoot, 'minimal-valid-json')),
    errors,
  );

  assert.deepEqual(errors, []);
  assert.equal(inputs.users.length, 1);
  assert.equal(inputs.customers.length, 1);
  assert.equal(inputs.vendors.length, 1);
  assert.equal(inputs.projects.length, 1);
  assert.equal(inputs.tasks.length, 1);
  assert.equal(inputs.milestones.length, 1);
  assert.equal(inputs.estimates.length, 1);
  assert.equal(inputs.invoices.length, 1);
  assert.equal(inputs.purchase_orders.length, 1);
  assert.equal(inputs.vendor_quotes.length, 1);
  assert.equal(inputs.vendor_invoices.length, 1);
  assert.equal(inputs.time_entries.length, 1);
  assert.equal(inputs.expenses.length, 1);
  assert.equal(inputs.estimates[0].lines.length, 1);
  assert.equal(inputs.invoices[0].lines.length, 1);
  assert.equal(inputs.purchase_orders[0].lines.length, 1);
});

test('po input reader preserves CSV shape for blocking validation fixture', () => {
  const errors = [];
  const inputs = readPoMigrationInputs(
    options(path.join(fixtureRoot, 'invalid-project-csv'), 'csv'),
    errors,
  );

  assert.deepEqual(errors, []);
  assert.deepEqual(inputs.projects, [
    {
      legacyId: 'fixture-project-invalid',
      code: 'PO-FIX-BAD',
      name: 'PO Fixture Invalid Project',
      startDate: '2026-07-31',
      endDate: '2026-07-01',
    },
  ]);
});

test('po input reader propagates parse errors for malformed JSON fixtures', () => {
  const errors = [];
  assert.throws(
    () =>
      readPoMigrationInputs(
        options(path.join(fixtureRoot, 'parse-error-json')),
        errors,
      ),
    SyntaxError,
  );
  assert.deepEqual(errors, []);
});

test('committed PO migration fixtures are synthetic and do not contain obvious secrets or real emails', () => {
  const files = walkFiles(fixtureRoot);
  assert.ok(files.length >= 1, 'expected committed PO migration fixtures');

  const secretPattern =
    /(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|GOCSPX-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{80,}|-----BEGIN ((RSA|EC|OPENSSH) )?PRIVATE KEY-----)/;
  const disallowedEmailPattern =
    /[A-Z0-9._%+-]+@(?!example\.invalid\b)[A-Z0-9.-]+\.[A-Z]{2,}/i;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      text,
      secretPattern,
      `secret-like value found in ${file}`,
    );
    assert.doesNotMatch(
      text,
      disallowedEmailPattern,
      `non-example.invalid email found in ${file}`,
    );
  }
});

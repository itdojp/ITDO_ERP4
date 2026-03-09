import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..', '..');
const DEMO_SEED_SQL_PATH = path.join(repoRoot, 'scripts', 'seed-demo.sql');

const DEMO_ACTION_POLICY_SPECS = [
  ['estimate', 'submit'],
  ['estimate', 'send'],
  ['invoice', 'submit'],
  ['invoice', 'send'],
  ['invoice', 'mark_paid'],
  ['expense', 'submit'],
  ['expense', 'mark_paid'],
  ['expense', 'unmark_paid'],
  ['leave', 'submit'],
  ['time', 'edit'],
  ['time', 'submit'],
  ['purchase_order', 'submit'],
  ['purchase_order', 'send'],
  ['vendor_invoice', 'update_allocations'],
  ['vendor_invoice', 'update_lines'],
  ['vendor_invoice', 'link_po'],
  ['vendor_invoice', 'unlink_po'],
  ['vendor_invoice', 'submit'],
  ['estimate', 'approve'],
  ['estimate', 'reject'],
  ['invoice', 'approve'],
  ['invoice', 'reject'],
  ['expense', 'approve'],
  ['expense', 'reject'],
  ['leave', 'approve'],
  ['leave', 'reject'],
  ['time', 'approve'],
  ['time', 'reject'],
  ['purchase_order', 'approve'],
  ['purchase_order', 'reject'],
  ['vendor_invoice', 'approve'],
  ['vendor_invoice', 'reject'],
  ['vendor_quote', 'approve'],
  ['vendor_quote', 'reject'],
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('demo seed includes local phase3 ActionPolicy rows for smoke/e2e flows', () => {
  const sql = fs.readFileSync(DEMO_SEED_SQL_PATH, 'utf8');

  for (const [flowType, actionKey] of DEMO_ACTION_POLICY_SPECS) {
    const pattern = new RegExp(
      `'${escapeRegExp(flowType)}'\\s*,\\s*'${escapeRegExp(
        actionKey,
      )}'\\s*,\\s*0\\s*,\\s*true\\s*,\\s*null\\s*,\\s*null\\s*,\\s*false\\s*,\\s*null`,
      'm',
    );
    assert.match(sql, pattern);
  }
});

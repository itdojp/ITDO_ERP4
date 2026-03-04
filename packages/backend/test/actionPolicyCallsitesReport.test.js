import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectCallsites,
  collectCallsitesFromSource,
  parseOptionsFromArgv,
} from '../../../scripts/report-action-policy-callsites.mjs';

test('parseOptionsFromArgv: defaults to routes root and text format', () => {
  const options = parseOptionsFromArgv([]);
  assert.equal(options.format, 'text');
  assert.ok(options.root.endsWith('packages/backend/src/routes'));
});

test('parseOptionsFromArgv: validates format', () => {
  assert.throws(
    () => parseOptionsFromArgv(['--format=csv']),
    /format must be text or json/,
  );
});

test('collectCallsitesFromSource: parses flowType/actionKey and classifies risk', () => {
  const source = `
async function run() {
  const policyRes = await evaluateActionPolicyWithFallback({
    prisma,
    actor,
    flowType: FlowTypeValue.invoice,
    actionKey: 'send',
    targetTable: 'invoices',
  });
  return policyRes;
}
`;
  const rows = collectCallsitesFromSource(source, '/tmp/sample.ts');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].flowType, 'invoice');
  assert.equal(rows[0].actionKey, 'send');
  assert.equal(rows[0].targetTable, 'invoices');
  assert.equal(rows[0].risk, 'high');
});

test('collectCallsites: scans backend route callsites', () => {
  const rootDir = parseOptionsFromArgv([]).root;
  const rows = collectCallsites(rootDir);
  assert.ok(rows.length >= 19);

  const vendorSubmit = rows.find(
    (row) =>
      row.flowType === 'vendor_invoice' &&
      row.actionKey === 'submit' &&
      row.file.endsWith('vendorDocs.ts'),
  );
  assert.ok(vendorSubmit);

  const dynamicApprove = rows.find(
    (row) =>
      row.file.endsWith('approvalRules.ts') &&
      row.actionKeyExpr === 'body.action',
  );
  assert.ok(dynamicApprove);
  assert.equal(dynamicApprove.risk, 'high');
});

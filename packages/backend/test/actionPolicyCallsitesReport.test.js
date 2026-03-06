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

test('collectCallsitesFromSource: expands wildcard static directive for dynamic approval actions', () => {
  const source = `
async function run(instance, body) {
  // action-policy-static-callsites: *:approve,*:reject
  return evaluateActionPolicyWithFallback({
    flowType: instance.flowType,
    actionKey: body.action,
    targetTable: 'approval_instances',
  });
}
`;
  const rows = collectCallsitesFromSource(source, '/tmp/approvalRules.ts');
  assert.deepEqual(
    rows.map((row) => ({
      flowType: row.flowType,
      actionKey: row.actionKey,
      flowTypeExpr: row.flowTypeExpr,
      actionKeyExpr: row.actionKeyExpr,
      risk: row.risk,
    })),
    [
      {
        flowType: '*',
        actionKey: 'approve',
        flowTypeExpr: "'*'",
        actionKeyExpr: "'approve'",
        risk: 'high',
      },
      {
        flowType: '*',
        actionKey: 'reject',
        flowTypeExpr: "'*'",
        actionKeyExpr: "'reject'",
        risk: 'high',
      },
    ],
  );
});

test('collectCallsites: scans backend route callsites', () => {
  const rootDir = parseOptionsFromArgv([]).root;
  const rows = collectCallsites(rootDir);
  assert.ok(rows.length > 0);

  const vendorSubmit = rows.find(
    (row) =>
      row.flowType === 'vendor_invoice' &&
      row.actionKey === 'submit' &&
      row.file.endsWith('vendorDocs.ts'),
  );
  assert.ok(vendorSubmit);

  const wildcardApprove = rows.find(
    (row) =>
      row.file.endsWith('approvalRules.ts') &&
      row.flowType === '*' &&
      row.actionKey === 'approve',
  );
  assert.ok(wildcardApprove);
  assert.equal(wildcardApprove.risk, 'high');
});

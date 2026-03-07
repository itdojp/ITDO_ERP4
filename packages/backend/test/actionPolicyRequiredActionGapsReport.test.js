import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  compareCallsitesAgainstRequiredActions,
  parseOptionsFromArgv,
  parsePhase2CoreRequiredActionsFromSource,
} from '../../../scripts/report-action-policy-required-action-gaps.mjs';
import { collectCallsites } from '../../../scripts/report-action-policy-callsites.mjs';

test('parseOptionsFromArgv: defaults and format validation', () => {
  const options = parseOptionsFromArgv([]);
  assert.equal(options.format, 'text');
  assert.ok(options.callsiteRoot.endsWith('packages/backend/src/routes'));
  assert.ok(
    options.presetFile.endsWith(
      'packages/backend/src/services/policyEnforcementPreset.ts',
    ),
  );

  assert.throws(
    () => parseOptionsFromArgv(['--format=csv']),
    /format must be text or json/,
  );
});

test('parsePhase2CoreRequiredActionsFromSource: extracts csv keys', () => {
  const source = `
const PHASE2_CORE_ACTION_POLICY_REQUIRED_ACTIONS = [
  'invoice:send',
  'expense:submit',
  '*:approve',
];
`;
  const actions = parsePhase2CoreRequiredActionsFromSource(source);
  assert.deepEqual(actions, ['invoice:send', 'expense:submit', '*:approve']);
});

test('compareCallsitesAgainstRequiredActions: identifies missing/stale and dynamic', () => {
  const callsites = [
    {
      flowType: 'invoice',
      actionKey: 'send',
      flowTypeExpr: 'FlowTypeValue.invoice',
      actionKeyExpr: "'send'",
      file: 'a.ts',
      line: 10,
    },
    {
      flowType: 'expense',
      actionKey: 'submit',
      flowTypeExpr: 'FlowTypeValue.expense',
      actionKeyExpr: "'submit'",
      file: 'b.ts',
      line: 20,
    },
    {
      flowType: 'instance.flowType',
      actionKey: 'body.action',
      flowTypeExpr: 'instance.flowType',
      actionKeyExpr: 'body.action',
      file: 'c.ts',
      line: 30,
    },
  ];

  const report = compareCallsitesAgainstRequiredActions(callsites, [
    'invoice:send',
    '*:approve',
    'leave:submit',
  ]);

  assert.equal(report.missingStaticCallsites.length, 1);
  assert.equal(report.missingStaticCallsites[0].flowType, 'expense');
  assert.deepEqual(report.staleRequiredActions, ['leave:submit']);
  assert.equal(report.dynamicCallsites.length, 1);
});

test('integration: phase2_core covers static route callsites without missing keys', () => {
  const options = parseOptionsFromArgv([]);
  const presetFile = options.presetFile;
  const presetSource = fs.readFileSync(presetFile, 'utf8');
  const requiredActions =
    parsePhase2CoreRequiredActionsFromSource(presetSource);
  const callsites = collectCallsites(options.callsiteRoot);
  const report = compareCallsitesAgainstRequiredActions(
    callsites,
    requiredActions,
  );

  assert.equal(report.missingStaticCallsites.length, 0);
  assert.equal(report.dynamicCallsites.length, 0);
  assert.ok(report.uniqueStaticKeys.includes('*:approve'));
  assert.ok(report.uniqueStaticKeys.includes('*:reject'));
});

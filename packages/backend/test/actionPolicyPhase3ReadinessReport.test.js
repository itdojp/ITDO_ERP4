import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildJsonReport,
  evaluatePhase3Readiness,
  parseOptionsFromArgv,
  renderTextReport,
} from '../../../scripts/report-action-policy-phase3-readiness.mjs';

test('parseOptionsFromArgv: defaults merge fallback and gap options', () => {
  const now = new Date('2026-03-08T00:00:00.000Z');
  const options = parseOptionsFromArgv([], now);

  assert.equal(options.format, 'text');
  assert.equal(options.take, 1000);
  assert.equal(options.to.toISOString(), '2026-03-08T00:00:00.000Z');
  assert.equal(options.from.toISOString(), '2026-03-07T00:00:00.000Z');
  assert.ok(options.callsiteRoot.endsWith('packages/backend/src/routes'));
  assert.ok(
    options.presetFile.endsWith(
      'packages/backend/src/services/policyEnforcementPreset.ts',
    ),
  );
});

test('parseOptionsFromArgv: validates format and time range', () => {
  assert.throws(
    () => parseOptionsFromArgv(['--format=csv']),
    /format must be text or json/,
  );
  assert.throws(
    () =>
      parseOptionsFromArgv([
        '--from=2026-03-08T00:00:00.000Z',
        '--to=2026-03-08T00:00:00.000Z',
      ]),
    /from must be earlier than to/,
  );
});

test('evaluatePhase3Readiness: returns ready when no blockers exist', () => {
  const report = evaluatePhase3Readiness({
    requiredActionReport: {
      totals: {
        callsites: 2,
        staticCallsites: 2,
        dynamicCallsites: 0,
        requiredActions: 2,
      },
      uniqueStaticKeys: ['invoice:submit', 'invoice:send'],
      missingStaticCallsites: [],
      staleRequiredActions: [],
      dynamicCallsites: [],
    },
    fallbackReport: {
      totals: { events: 0, uniqueKeys: 0 },
      keys: [],
    },
    callsites: [
      {
        flowType: 'invoice',
        actionKey: 'submit',
        targetTable: 'invoices',
        risk: 'high',
      },
    ],
  });

  assert.equal(report.ready, true);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.fallbackSummary.totals.highRiskKeys, 0);
});

test('renderTextReport/buildJsonReport: output contract is stable', () => {
  const options = {
    from: new Date('2026-03-07T00:00:00.000Z'),
    to: new Date('2026-03-08T00:00:00.000Z'),
    callsiteRoot: '/tmp/routes',
    presetFile: '/tmp/preset.ts',
  };
  const report = evaluatePhase3Readiness({
    requiredActionReport: {
      totals: {
        callsites: 2,
        staticCallsites: 2,
        dynamicCallsites: 0,
        requiredActions: 2,
      },
      uniqueStaticKeys: ['invoice:submit', 'invoice:send'],
      missingStaticCallsites: [],
      staleRequiredActions: [],
      dynamicCallsites: [],
    },
    fallbackReport: {
      totals: { events: 0, uniqueKeys: 0 },
      keys: [],
    },
    callsites: [],
  });

  const text = renderTextReport(report, options);
  assert.match(text, /^action policy phase3 readiness report\n/);
  assert.match(text, /ready: yes/);
  assert.match(text, /fallback_unique_keys: 0/);
  assert.match(text, /## blockers\n\(none\)\n/);

  assert.deepEqual(buildJsonReport(report, options), {
    ready: true,
    from: '2026-03-07T00:00:00.000Z',
    to: '2026-03-08T00:00:00.000Z',
    callsiteRoot: '/tmp/routes',
    presetFile: '/tmp/preset.ts',
    blockers: [],
    requiredActionGaps: report.requiredActionGaps,
    fallbackSummary: report.fallbackSummary,
  });
});

test('evaluatePhase3Readiness: reports blockers for gaps and fallback keys', () => {
  const report = evaluatePhase3Readiness({
    requiredActionReport: {
      totals: {
        callsites: 3,
        staticCallsites: 2,
        dynamicCallsites: 1,
        requiredActions: 2,
      },
      uniqueStaticKeys: ['invoice:submit', 'invoice:send'],
      missingStaticCallsites: [
        {
          flowType: 'expense',
          actionKey: 'submit',
          file: 'a.ts',
          line: 1,
        },
      ],
      staleRequiredActions: ['leave:submit'],
      dynamicCallsites: [
        {
          flowTypeExpr: 'instance.flowType',
          actionKeyExpr: 'body.action',
          file: 'b.ts',
          line: 2,
        },
      ],
    },
    fallbackReport: {
      totals: { events: 2, uniqueKeys: 2 },
      keys: [
        {
          flowType: 'invoice',
          actionKey: 'submit',
          targetTable: 'invoices',
          count: 1,
          firstSeen: '2026-03-08T00:00:00.000Z',
          lastSeen: '2026-03-08T00:00:00.000Z',
          sampleTargetId: 'inv-001',
        },
        {
          flowType: 'unknown_flow',
          actionKey: 'submit',
          targetTable: 'mystery',
          count: 1,
          firstSeen: '2026-03-08T00:01:00.000Z',
          lastSeen: '2026-03-08T00:01:00.000Z',
          sampleTargetId: 'm-001',
        },
      ],
    },
    callsites: [
      {
        flowType: 'invoice',
        actionKey: 'submit',
        targetTable: 'invoices',
        risk: 'high',
      },
      {
        flowType: 'leave',
        actionKey: 'submit',
        targetTable: 'leave_requests',
        risk: 'medium',
      },
    ],
  });

  assert.equal(report.ready, false);
  assert.deepEqual(
    report.blockers.map((item) => item.code),
    [
      'missing_static_callsites',
      'stale_required_actions',
      'dynamic_callsites',
      'fallback_keys_detected',
    ],
  );
  assert.equal(report.fallbackSummary.totals.highRiskKeys, 1);
  assert.equal(report.fallbackSummary.totals.unknownRiskKeys, 1);
  assert.equal(report.fallbackSummary.keys[1].risk, 'unknown');
});

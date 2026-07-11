import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IntegrationRunServiceError,
  buildIntegrationRunAuditMetadata,
  buildIntegrationRunMetricsResponse,
  computeNextRetryAt,
  executeIntegration,
  executeManualIntegrationRun,
  getRetryPolicy,
  runIntegrationSetting,
  runDueIntegrationJobs,
} from '../dist/services/integrationRuns.js';

function integrationRunClient(overrides = {}) {
  return {
    integrationSetting: {
      findUnique: async () => null,
      findMany: async () => [],
      update: async (args) => ({ id: args?.where?.id }),
      ...(overrides.integrationSetting ?? {}),
    },
    integrationRun: {
      findMany: async () => [],
      create: async (args) => ({
        id: 'run-created',
        retryCount: 0,
        ...args?.data,
      }),
      update: async (args) => ({
        id: args?.where?.id,
        retryCount: 0,
        nextRetryAt: null,
        message: null,
        ...args?.data,
      }),
      ...(overrides.integrationRun ?? {}),
    },
    customer: { count: async () => 0, ...(overrides.customer ?? {}) },
    vendor: { count: async () => 0, ...(overrides.vendor ?? {}) },
    contact: { count: async () => 0, ...(overrides.contact ?? {}) },
    userAccount: { count: async () => 0, ...(overrides.userAccount ?? {}) },
    wellbeingEntry: {
      count: async () => 0,
      ...(overrides.wellbeingEntry ?? {}),
    },
    alertSetting: {
      findMany: async () => [],
      ...(overrides.alertSetting ?? {}),
    },
    alert: {
      updateMany: async () => ({ count: 0 }),
      ...(overrides.alert ?? {}),
    },
  };
}

test('getRetryPolicy and computeNextRetryAt preserve bounded exponential retry policy', () => {
  assert.deepEqual(getRetryPolicy(null), {
    retryMax: 3,
    retryBaseMinutes: 60,
  });
  assert.deepEqual(
    getRetryPolicy({ retryMax: 999, retryBaseMinutes: 999999 }),
    {
      retryMax: 10,
      retryBaseMinutes: 1440,
    },
  );
  assert.deepEqual(getRetryPolicy({ retryMax: -1, retryBaseMinutes: 0 }), {
    retryMax: 0,
    retryBaseMinutes: 1,
  });
  assert.equal(
    computeNextRetryAt(
      new Date('2026-03-01T00:00:00.000Z'),
      3,
      5,
    )?.toISOString(),
    '2026-03-01T00:20:00.000Z',
  );
  assert.equal(
    computeNextRetryAt(new Date('2026-03-01T00:00:00.000Z'), 0, 5),
    null,
  );
});

test('buildIntegrationRunMetricsResponse aggregates statuses, durations, failures and type breakdown', () => {
  const response = buildIntegrationRunMetricsResponse({
    from: new Date('2026-02-01T00:00:00.000Z'),
    to: new Date('2026-02-15T00:00:00.000Z'),
    days: 14,
    limit: 100,
    runs: [
      {
        status: 'success',
        startedAt: new Date('2026-02-10T10:00:00.000Z'),
        finishedAt: new Date('2026-02-10T10:00:10.000Z'),
        nextRetryAt: null,
        message: null,
        setting: { id: 'crm-1', type: 'crm', name: 'CRM' },
      },
      {
        status: 'failed',
        startedAt: new Date('2026-02-10T10:10:00.000Z'),
        finishedAt: new Date('2026-02-10T10:10:30.000Z'),
        nextRetryAt: new Date('2026-02-10T11:10:00.000Z'),
        message: 'timeout',
        setting: { id: 'crm-1', type: 'crm', name: 'CRM' },
      },
      {
        status: 'running',
        startedAt: new Date('2026-02-10T10:20:00.000Z'),
        finishedAt: null,
        nextRetryAt: null,
        message: null,
        setting: { id: 'hr-1', type: 'hr', name: 'HR' },
      },
      {
        status: 'failed',
        startedAt: new Date('2026-02-10T10:30:00.000Z'),
        finishedAt: new Date('2026-02-10T10:30:05.000Z'),
        nextRetryAt: null,
        message: 'timeout',
        setting: { id: 'hr-1', type: 'hr', name: 'HR' },
      },
    ],
  });

  assert.deepEqual(response.summary, {
    totalRuns: 4,
    successRuns: 1,
    failedRuns: 2,
    runningRuns: 1,
    retryScheduledRuns: 1,
    successRate: 25,
    avgDurationMs: 15000,
    p95DurationMs: 30000,
  });
  assert.deepEqual(response.failureReasons, [{ reason: 'timeout', count: 2 }]);
  assert.deepEqual(response.byType, [
    {
      type: 'crm',
      totalRuns: 2,
      successRuns: 1,
      failedRuns: 1,
      runningRuns: 0,
      successRate: 50,
    },
    {
      type: 'hr',
      totalRuns: 2,
      successRuns: 0,
      failedRuns: 1,
      runningRuns: 1,
      successRate: 0,
    },
  ]);
});

test('buildIntegrationRunAuditMetadata keeps truncated message within audit cap', () => {
  const metadata = buildIntegrationRunAuditMetadata({
    trigger: 'manual',
    settingId: 'setting-long-message',
    settingType: 'crm',
    run: {
      id: 'run-long-message',
      status: 'failed',
      retryCount: 1,
      nextRetryAt: null,
      startedAt: new Date('2026-03-01T00:00:00.000Z'),
      finishedAt: new Date('2026-03-01T00:01:00.000Z'),
      message: 'x'.repeat(600),
    },
  });

  assert.equal(metadata.message.length, 500);
  assert.equal(metadata.message.endsWith('...'), true);
});

test('executeManualIntegrationRun maps missing and disabled settings to service errors', async () => {
  await assert.rejects(
    () =>
      executeManualIntegrationRun(
        { settingId: 'missing' },
        { client: integrationRunClient() },
      ),
    (error) => {
      assert.ok(error instanceof IntegrationRunServiceError);
      assert.equal(error.code, 'not_found');
      assert.equal(error.statusCode, 404);
      return true;
    },
  );

  await assert.rejects(
    () =>
      executeManualIntegrationRun(
        { settingId: 'disabled' },
        {
          client: integrationRunClient({
            integrationSetting: {
              findUnique: async () => ({
                id: 'disabled',
                type: 'crm',
                status: 'disabled',
                config: {},
              }),
            },
          }),
        },
      ),
    (error) => {
      assert.ok(error instanceof IntegrationRunServiceError);
      assert.equal(error.code, 'disabled');
      assert.equal(error.statusCode, 409);
      return true;
    },
  );
});

test('executeIntegration counts CRM delta metrics via injected client and rejects malformed updatedSince', async () => {
  const countCalls = [];
  const client = integrationRunClient({
    customer: {
      count: async (args) => {
        countCalls.push(['customer', args]);
        return 3;
      },
    },
    vendor: {
      count: async (args) => {
        countCalls.push(['vendor', args]);
        return 2;
      },
    },
    contact: {
      count: async (args) => {
        countCalls.push(['contact', args]);
        return 1;
      },
    },
  });

  const result = await executeIntegration(
    {
      id: 'setting-crm-delta',
      type: 'crm',
      config: { updatedSince: '2026-02-01T00:00:00.000Z' },
    },
    { client },
  );

  assert.equal(result.message, 'exported_delta');
  assert.deepEqual(result.metrics, {
    customers: 3,
    vendors: 2,
    contacts: 1,
    updatedSince: '2026-02-01T00:00:00.000Z',
  });
  assert.equal(countCalls.length, 3);
  for (const [, args] of countCalls) {
    assert.equal(
      args.where.updatedAt.gt.toISOString(),
      '2026-02-01T00:00:00.000Z',
    );
  }

  await assert.rejects(
    () =>
      executeIntegration(
        {
          id: 'setting-crm-invalid',
          type: 'crm',
          config: { updatedSince: 'not-a-date' },
        },
        { client },
      ),
    /invalid_updatedSince/,
  );
});

test('runIntegrationSetting records failure retry metadata and triggers integration failure alerts', async () => {
  const runUpdateCalls = [];
  const settingUpdateCalls = [];
  const alertTriggers = [];
  const client = integrationRunClient({
    integrationRun: {
      create: async (args) => ({
        id: 'run-failed-service',
        retryCount: 0,
        ...args.data,
      }),
      update: async (args) => {
        runUpdateCalls.push(args);
        return {
          id: args.where.id,
          retryCount: args.data.retryCount ?? 0,
          nextRetryAt: args.data.nextRetryAt ?? null,
          message: args.data.message ?? null,
          startedAt:
            args.data.startedAt ?? new Date('2026-03-01T00:00:00.000Z'),
          finishedAt:
            args.data.finishedAt ?? new Date('2026-03-01T00:10:00.000Z'),
          status: args.data.status,
        };
      },
    },
    integrationSetting: {
      update: async (args) => {
        settingUpdateCalls.push(args);
        return { id: args.where.id };
      },
    },
    alertSetting: {
      findMany: async () => [
        {
          id: 'alert-setting-1',
          recipients: ['ops@example.com'],
          channels: ['email'],
          remindAfterHours: 24,
          remindMaxCount: 3,
        },
      ],
    },
  });

  const result = await runIntegrationSetting(
    {
      id: 'setting-failure',
      type: 'crm',
      status: 'active',
      schedule: null,
      config: {
        simulateFailure: true,
        retryMax: 2,
        retryBaseMinutes: 5,
      },
    },
    { actorUserId: 'admin-user' },
    {
      client,
      now: () => new Date('2026-03-01T00:00:00.000Z'),
      triggerAlert: async (...args) => alertTriggers.push(args),
    },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.retryCount, 1);
  assert.equal(result.message, 'simulate_failure');
  assert.equal(result.nextRetryAt.toISOString(), '2026-03-01T00:05:00.000Z');
  assert.deepEqual(
    runUpdateCalls.map((call) => call.data.status),
    ['failed'],
  );
  assert.equal(settingUpdateCalls.length, 1);
  assert.equal(settingUpdateCalls[0].data.lastRunStatus, 'failed');
  assert.equal(settingUpdateCalls[0].data.updatedBy, 'admin-user');
  assert.equal(alertTriggers.length, 1);
  assert.equal(alertTriggers[0][3], 'integration:setting-failure');
});

test('executeManualIntegrationRun records success audit and closes open failure alerts', async () => {
  const runUpdateCalls = [];
  const settingUpdateCalls = [];
  const alertUpdateCalls = [];
  const auditEntries = [];
  const client = integrationRunClient({
    integrationSetting: {
      findUnique: async () => ({
        id: 'setting-success',
        type: 'crm',
        status: 'active',
        config: {},
      }),
      update: async (args) => {
        settingUpdateCalls.push(args);
        return { id: args.where.id };
      },
    },
    integrationRun: {
      create: async (args) => ({
        id: 'run-success-service',
        retryCount: 0,
        ...args.data,
      }),
      update: async (args) => {
        runUpdateCalls.push(args);
        return {
          id: args.where.id,
          retryCount: 0,
          nextRetryAt: args.data.nextRetryAt ?? null,
          message: args.data.message ?? null,
          startedAt: new Date('2026-03-02T00:00:00.000Z'),
          finishedAt: args.data.finishedAt,
          status: args.data.status,
        };
      },
    },
    customer: { count: async () => 3 },
    vendor: { count: async () => 2 },
    contact: { count: async () => 1 },
    alertSetting: {
      findMany: async () => [{ id: 'alert-setting-open' }],
    },
    alert: {
      updateMany: async (args) => {
        alertUpdateCalls.push(args);
        return { count: 1 };
      },
    },
  });

  const result = await executeManualIntegrationRun(
    {
      settingId: 'setting-success',
      actorUserId: 'admin-user',
      auditContext: { userId: 'admin-user', requestId: 'req-manual-success' },
    },
    {
      client,
      now: () => new Date('2026-03-02T00:00:00.000Z'),
      logAudit: async (entry) => auditEntries.push(entry),
    },
  );

  assert.equal(result.id, 'run-success-service');
  assert.equal(result.status, 'success');
  assert.deepEqual(
    runUpdateCalls.map((call) => call.data.status),
    ['success'],
  );
  assert.equal(settingUpdateCalls.length, 1);
  assert.equal(settingUpdateCalls[0].data.lastRunStatus, 'success');
  assert.equal(settingUpdateCalls[0].data.updatedBy, 'admin-user');
  assert.equal(alertUpdateCalls.length, 1);
  assert.deepEqual(alertUpdateCalls[0].where, {
    status: 'open',
    targetRef: 'integration:setting-success',
    settingId: { in: ['alert-setting-open'] },
  });
  assert.equal(auditEntries.length, 1);
  assert.equal(auditEntries[0].action, 'integration_run_executed');
  assert.equal(auditEntries[0].targetTable, 'integration_runs');
  assert.equal(auditEntries[0].targetId, 'run-success-service');
  assert.equal(auditEntries[0].metadata.trigger, 'manual');
  assert.equal(auditEntries[0].metadata.settingId, 'setting-success');
  assert.equal(auditEntries[0].metadata.status, 'success');
});

test('runDueIntegrationJobs retries eligible runs, skips over-limit runs, runs schedules and audits summary', async () => {
  const retryEligibleRun = {
    id: 'run-retry-eligible',
    status: 'failed',
    retryCount: 0,
    nextRetryAt: new Date('2026-02-23T18:00:00.000Z'),
    setting: {
      id: 'setting-crm-retry',
      type: 'crm',
      config: { retryMax: 2, retryBaseMinutes: 5 },
    },
  };
  const overLimitRun = {
    id: 'run-retry-over-limit',
    status: 'failed',
    retryCount: 2,
    nextRetryAt: new Date('2026-02-23T18:00:00.000Z'),
    setting: {
      id: 'setting-crm-over-limit',
      type: 'crm',
      config: { retryMax: 2, retryBaseMinutes: 5 },
    },
  };
  const scheduledSetting = {
    id: 'setting-hr-scheduled',
    type: 'hr',
    status: 'active',
    schedule: 'daily',
    config: {},
  };

  const runUpdateCalls = [];
  const settingUpdateCalls = [];
  const auditEntries = [];
  const client = integrationRunClient({
    integrationRun: {
      findMany: async () => [retryEligibleRun, overLimitRun],
      create: async (args) => ({
        id: 'run-scheduled-created',
        retryCount: 0,
        ...args.data,
      }),
      update: async (args) => {
        runUpdateCalls.push(args);
        return {
          id: args.where.id,
          retryCount: args.data.retryCount ?? 0,
          nextRetryAt: args.data.nextRetryAt ?? null,
          message: args.data.message ?? null,
          startedAt:
            args.data.startedAt ?? new Date('2026-02-23T18:00:00.000Z'),
          finishedAt:
            args.data.finishedAt ?? new Date('2026-02-23T18:00:00.000Z'),
          status: args.data.status,
        };
      },
    },
    integrationSetting: {
      findMany: async () => [scheduledSetting],
      update: async (args) => {
        settingUpdateCalls.push(args);
        return { id: args.where.id };
      },
    },
    customer: { count: async () => 3 },
    vendor: { count: async () => 2 },
    contact: { count: async () => 1 },
    userAccount: { count: async () => 4 },
    wellbeingEntry: { count: async () => 5 },
  });

  const result = await runDueIntegrationJobs(
    {
      actorUserId: 'admin-user',
      auditContext: { userId: 'admin-user', requestId: 'req-run-jobs' },
    },
    {
      client,
      now: () => new Date('2026-02-23T18:00:00.000Z'),
      logAudit: async (entry) => auditEntries.push(entry),
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.retryCount, 1);
  assert.equal(result.scheduledCount, 1);
  assert.deepEqual(result.retries, [
    { id: 'run-retry-eligible', status: 'success' },
  ]);
  assert.deepEqual(result.scheduled, [
    { id: 'run-scheduled-created', status: 'success' },
  ]);

  const updatedRunIds = runUpdateCalls.map((call) => call.where.id);
  assert.equal(updatedRunIds.includes('run-retry-eligible'), true);
  assert.equal(updatedRunIds.includes('run-retry-over-limit'), false);
  assert.equal(settingUpdateCalls.length, 2);
  assert.deepEqual(
    auditEntries.map((entry) => entry.action),
    [
      'integration_run_executed',
      'integration_run_executed',
      'integration_jobs_run_executed',
    ],
  );
  assert.equal(auditEntries[0].metadata.trigger, 'retry');
  assert.equal(auditEntries[1].metadata.trigger, 'scheduled');
  assert.equal(auditEntries[2].metadata.retryCount, 1);
  assert.equal(auditEntries[2].metadata.scheduledCount, 1);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessBackupReadiness,
  assessDriveReadiness,
  assessRestoreEvidence,
  buildStorageReadinessReport,
  renderStorageReadinessMarkdown,
  STORAGE_READINESS_COMPONENTS,
} from '../dist/application/backup/storageReadiness.js';
import { resolveStorageReadinessConfig } from '../dist/infrastructure/backup/storageReadinessConfig.js';

const now = new Date('2026-07-22T10:00:00.000Z');
const backupPolicy = {
  freshnessClass: 'hourly',
  maxAgeMs: 2 * 60 * 60 * 1000,
  minimums: { hourly: 1, daily: 1, weekly: 1, monthly: 1 },
};

test('Drive readiness fixes warning, critical, and unknown quota semantics', () => {
  const base = {
    configured: true,
    folderAccessible: true,
    permissionEntries: 1,
    writeProbe: 'not_requested',
  };
  assert.equal(
    assessDriveReadiness(
      'app_gdrive_chat',
      { ...base, quota: { state: 'available', usagePercent: 69.99 } },
      { warningPercent: 70, criticalPercent: 80 },
    ).status,
    'pass',
  );
  assert.equal(
    assessDriveReadiness(
      'app_gdrive_chat',
      { ...base, quota: { state: 'available', usagePercent: 70 } },
      { warningPercent: 70, criticalPercent: 80 },
    ).status,
    'warn',
  );
  assert.equal(
    assessDriveReadiness(
      'app_gdrive_chat',
      { ...base, quota: { state: 'available', usagePercent: 80 } },
      { warningPercent: 70, criticalPercent: 80 },
    ).status,
    'fail',
  );
  assert.deepEqual(
    assessDriveReadiness(
      'app_gdrive_chat',
      { ...base, quota: { state: 'unknown' } },
      { warningPercent: 70, criticalPercent: 80 },
    ),
    {
      component: 'app_gdrive_chat',
      metrics: {
        folderAccessible: true,
        permissionEntries: 1,
        quota: 'unknown',
        writeProbe: 'not_requested',
      },
      reasons: ['drive_quota_unknown'],
      status: 'unknown',
    },
  );
});

test('Drive errors distinguish transient unknown from permanent fail', () => {
  assert.equal(
    assessDriveReadiness(
      'app_gdrive_pdf',
      { configured: true, errorCode: 'timeout' },
      { warningPercent: 70, criticalPercent: 80 },
    ).status,
    'unknown',
  );
  assert.equal(
    assessDriveReadiness(
      'app_gdrive_pdf',
      { configured: true, errorCode: 'auth_expired' },
      { warningPercent: 70, criticalPercent: 80 },
    ).status,
    'fail',
  );
  assert.deepEqual(
    assessDriveReadiness(
      'app_gdrive_pdf',
      {
        configured: true,
        folderAccessible: false,
        quota: { state: 'available', usagePercent: 1 },
      },
      { warningPercent: 70, criticalPercent: 80 },
    ),
    {
      component: 'app_gdrive_pdf',
      metrics: {
        folderAccessible: false,
        permissionEntries: 0,
        writeProbe: 'not_requested',
      },
      reasons: ['drive_folder_unavailable'],
      status: 'fail',
    },
  );
});

test('backup readiness rejects stale, future, anomalous, and under-retained copies', () => {
  const observation = {
    configured: true,
    anomalyCounts: { checksum_mismatch: 1, zero_size: 1 },
    classCounts: { hourly: 1, daily: 0, weekly: 1, monthly: 1 },
    classTimestamps: {
      hourly: {
        oldestGeneratedAt: '2026-07-22T07:59:59.000Z',
        latestGeneratedAt: '2026-07-22T07:59:59.000Z',
      },
    },
    latestGeneratedAt: '2026-07-22T07:59:59.000Z',
    retentionCandidates: 2,
  };
  const stale = assessBackupReadiness(
    'backup_sakura_primary',
    observation,
    backupPolicy,
    now,
  );
  assert.equal(stale.status, 'fail');
  assert.deepEqual(stale.reasons, [
    'backup_checksum_mismatch',
    'backup_freshness_exceeded',
    'backup_zero_size',
    'retention_daily_insufficient',
  ]);
  assert.equal(
    assessBackupReadiness(
      'backup_local',
      {
        ...observation,
        anomalyCounts: {},
        latestGeneratedAt: '2026-07-22T10:00:01.000Z',
      },
      backupPolicy,
      now,
    ).reasons.includes('backup_time_future'),
    true,
  );
});

test('backup class timestamps expose oldest/newest and reject a future class', () => {
  const result = assessBackupReadiness(
    'backup_local',
    {
      configured: true,
      anomalyCounts: {},
      classCounts: { hourly: 1, daily: 1, weekly: 1, monthly: 1 },
      classTimestamps: {
        hourly: {
          oldestGeneratedAt: '2026-07-22T09:00:00.000Z',
          latestGeneratedAt: '2026-07-22T09:00:00.000Z',
        },
        daily: {
          oldestGeneratedAt: '2026-07-22T10:00:01.000Z',
          latestGeneratedAt: '2026-07-22T10:00:01.000Z',
        },
      },
      latestGeneratedAt: '2026-07-22T09:00:00.000Z',
      retentionCandidates: 0,
    },
    backupPolicy,
    now,
  );
  assert.equal(result.status, 'fail');
  assert.ok(result.reasons.includes('backup_time_future'));
  assert.equal(
    result.metrics.hourlyOldestGeneratedAt,
    '2026-07-22T09:00:00.000Z',
  );
  assert.equal(
    result.metrics.dailyLatestGeneratedAt,
    '2026-07-22T10:00:01.000Z',
  );
});

test('storage readiness config fixes defaults and rejects inverted thresholds', () => {
  const config = resolveStorageReadinessConfig({});
  assert.equal(config.drive.warningPercent, 70);
  assert.equal(config.drive.criticalPercent, 80);
  assert.equal(config.backup.local.freshnessClass, 'hourly');
  assert.equal(config.backup.local.maxAgeMs, 2 * 60 * 60 * 1000);
  assert.equal(config.backup.driveSecondary.freshnessClass, 'daily');
  assert.equal(config.backup.driveSecondary.maxAgeMs, 30 * 60 * 60 * 1000);
  assert.equal(config.restoreMaxAgeMs, 30 * 24 * 60 * 60 * 1000);
  assert.throws(
    () =>
      resolveStorageReadinessConfig({
        STORAGE_READINESS_DRIVE_WARNING_PERCENT: '80',
        STORAGE_READINESS_DRIVE_CRITICAL_PERCENT: '80',
      }),
    /storage_readiness_configuration_invalid/,
  );
  assert.throws(
    () =>
      resolveStorageReadinessConfig({
        STORAGE_READINESS_LOCAL_MAX_AGE_HOURS: '2e1',
      }),
    /storage_readiness_configuration_invalid/,
  );
});

test('restore evidence rejects old, future, environment, backup, and failed evidence', () => {
  const result = assessRestoreEvidence(
    {
      configured: true,
      backupIdMatches: false,
      completedAt: '2026-06-01T00:00:00.000Z',
      environmentMatches: false,
      result: 'fail',
    },
    30 * 24 * 60 * 60 * 1000,
    now,
  );
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.reasons, [
    'restore_backup_id_mismatch',
    'restore_environment_mismatch',
    'restore_freshness_exceeded',
    'restore_result_not_pass',
  ]);
});

test('overall result has fixed precedence and partial backup failure signal', () => {
  const components = STORAGE_READINESS_COMPONENTS.map((component) => ({
    component,
    metrics: {},
    reasons: [],
    status: 'pass',
  }));
  components.find((item) => item.component === 'backup_sakura_primary').status =
    'fail';
  const report = buildStorageReadinessReport({
    components,
    generatedAt: now,
    mode: 'read',
  });
  assert.deepEqual(report.overall, {
    exitCode: 2,
    reasons: ['backup_partial_failure'],
    status: 'fail',
  });
  const markdown = renderStorageReadinessMarkdown(report);
  assert.match(markdown, /backup_sakura_primary \| fail/);
  assert.match(markdown, /Overall reasons: `backup_partial_failure`/);
  assert.doesNotMatch(markdown, /undefined/);

  const localOnly = STORAGE_READINESS_COMPONENTS.map((component) => ({
    component,
    metrics: {},
    reasons: ['provider_not_configured'],
    status: 'not_configured',
  }));
  const local = localOnly.find((item) => item.component === 'backup_local');
  local.status = 'pass';
  local.reasons = [];
  assert.deepEqual(
    buildStorageReadinessReport({
      components: localOnly,
      generatedAt: now,
      mode: 'read',
    }).overall.reasons,
    [],
  );
});

test('all pass, warning, unknown, and all not-configured map to stable exits', () => {
  const make = (status) =>
    STORAGE_READINESS_COMPONENTS.map((component) => ({
      component,
      metrics: {},
      reasons: [],
      status,
    }));
  assert.equal(
    buildStorageReadinessReport({
      components: make('pass'),
      generatedAt: now,
      mode: 'read',
    }).overall.exitCode,
    0,
  );
  assert.equal(
    buildStorageReadinessReport({
      components: make('warn'),
      generatedAt: now,
      mode: 'read',
    }).overall.exitCode,
    1,
  );
  assert.equal(
    buildStorageReadinessReport({
      components: make('unknown'),
      generatedAt: now,
      mode: 'read',
    }).overall.exitCode,
    3,
  );
  assert.deepEqual(
    buildStorageReadinessReport({
      components: make('not_configured'),
      generatedAt: now,
      mode: 'read',
    }).overall,
    { exitCode: 3, reasons: [], status: 'not_configured' },
  );
  assert.throws(
    () =>
      buildStorageReadinessReport({
        components: [...make('pass'), make('pass')[0]],
        generatedAt: now,
        mode: 'read',
      }),
    /storage_readiness_component_duplicate_or_unknown/,
  );
});

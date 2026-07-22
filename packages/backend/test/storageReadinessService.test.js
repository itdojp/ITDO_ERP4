import assert from 'node:assert/strict';
import test from 'node:test';

import { runStorageReadiness } from '../dist/cli/storageReadinessService.js';

const now = new Date('2026-07-22T10:00:00.000Z');

function makeBackupSource() {
  const entries = [];
  const manifests = new Map();
  const stats = new Map();
  for (const [index, retentionClass] of [
    'hourly',
    'daily',
    'weekly',
    'monthly',
  ].entries()) {
    const hour = 9 - index;
    const backupId = `erp4-20260722-0${hour}0000-abcdef0`;
    for (const type of ['database', 'globals', 'metadata']) {
      const name = `${backupId}-${type}.gpg`;
      const digest = String(index + 1).padEnd(
        64,
        { database: 'a', globals: 'b', metadata: 'c' }[type],
      );
      entries.push(
        { key: name, sizeBytes: 10 },
        { key: `${name}.manifest.json`, sizeBytes: 100 },
      );
      stats.set(name, { sha256: digest, sizeBytes: 10 });
      manifests.set(`${name}.manifest.json`, {
        schemaVersion: 'erp4.backup.manifest.v1',
        backupId,
        generatedAt: `2026-07-22T0${hour}:00:00.000Z`,
        environment: 'prod',
        retentionClass,
        artifact: {
          type,
          name,
          sourceName: `${type}.source`,
          sourceSizeBytes: 9,
          sizeBytes: 10,
          sha256: digest,
        },
        encryption: { algorithm: 'openpgp' },
        application: { commitSha: 'abcdef0' },
      });
    }
  }
  return {
    list: async () => entries,
    readManifest: async (key) => structuredClone(manifests.get(key)),
    statArtifact: async (key) => structuredClone(stats.get(key)),
  };
}

function makeDrive(calls) {
  return {
    about: {
      get: async (params, requestOptions) => {
        calls.push({ method: 'about.get', params, requestOptions });
        return { data: { storageQuota: { limit: '100', usage: '10' } } };
      },
    },
    createResumable: async () => assert.fail('not expected'),
    files: {
      get: async (params, requestOptions) => {
        calls.push({ method: 'files.get', params, requestOptions });
        return {
          data: {
            id: 'sensitive-folder-id',
            mimeType: 'application/vnd.google-apps.folder',
            driveId: 'sensitive-shared-drive-id',
            trashed: false,
          },
        };
      },
      list: async (params, requestOptions) => {
        calls.push({ method: 'files.list', params, requestOptions });
        return { data: { files: [] } };
      },
      create: async (params, requestOptions) => {
        calls.push({ method: 'files.create', params, requestOptions });
        return { data: { id: 'sensitive-probe-id' } };
      },
      update: async (params, requestOptions) => {
        calls.push({ method: 'files.update', params, requestOptions });
        return { data: { id: 'sensitive-probe-id', trashed: true } };
      },
    },
    permissions: {
      list: async (params, requestOptions) => {
        calls.push({ method: 'permissions.list', params, requestOptions });
        return {
          data: {
            permissions: [
              {
                type: 'group',
                permissionDetails: [{ inherited: true }],
              },
            ],
          },
        };
      },
    },
  };
}

const env = {
  CHAT_ATTACHMENT_PROVIDER: 'gdrive',
  PDF_PROVIDER: 'gdrive',
  EVIDENCE_ARCHIVE_PROVIDER: 'gdrive',
  REPORT_PROVIDER: 'gdrive',
  CHAT_ATTACHMENT_GDRIVE_FOLDER_ID: 'sensitive-chat-folder',
  PDF_GDRIVE_FOLDER_ID: 'sensitive-pdf-folder',
  EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID: 'sensitive-evidence-folder',
  REPORT_GDRIVE_FOLDER_ID: 'sensitive-report-folder',
  ERP4_GDRIVE_CLIENT_ID: 'sensitive-client',
  ERP4_GDRIVE_CLIENT_SECRET: 'sensitive-secret',
  ERP4_GDRIVE_REFRESH_TOKEN: 'sensitive-refresh',
  ERP4_GDRIVE_SHARED_DRIVE_ID: 'sensitive-shared-drive-id',
  BACKUP_DIR: '/private/backup-placeholder',
  BACKUP_PREFIX: 'erp4',
  ENVIRONMENT: 'prod',
  S3_PROVIDER: 'sakura',
  STORAGE_READINESS_RESTORE_EVIDENCE_FILE: '/private/restore-placeholder',
  STORAGE_READINESS_RESTORE_EXPECTED_BACKUP_ID: 'backup-placeholder',
  STORAGE_READINESS_MIN_HOURLY: '1',
  STORAGE_READINESS_MIN_DAILY: '1',
  STORAGE_READINESS_MIN_WEEKLY: '1',
  STORAGE_READINESS_MIN_MONTHLY: '1',
};

function dependencies(calls) {
  const source = makeBackupSource();
  return {
    createDriveApi: () => makeDrive(calls),
    createLocalSource: () => source,
    inspectRestore: async () => ({
      configured: true,
      backupIdMatches: true,
      completedAt: '2026-07-22T09:00:00.000Z',
      environmentMatches: true,
      result: 'pass',
    }),
    now: () => now,
    probeDriveSecondary: async () => ({
      anomalyCounts: {},
      classCounts: { daily: 1, weekly: 1, monthly: 1 },
      classTimestamps: {
        daily: {
          oldestGeneratedAt: '2026-07-22T09:00:00.000Z',
          latestGeneratedAt: '2026-07-22T09:00:00.000Z',
        },
        weekly: {
          oldestGeneratedAt: '2026-07-22T09:00:00.000Z',
          latestGeneratedAt: '2026-07-22T09:00:00.000Z',
        },
        monthly: {
          oldestGeneratedAt: '2026-07-22T09:00:00.000Z',
          latestGeneratedAt: '2026-07-22T09:00:00.000Z',
        },
      },
      configured: true,
      latestGeneratedAt: '2026-07-22T09:00:00.000Z',
      retentionCandidates: 0,
    }),
    resolveSakuraSource: () => ({ configured: true, source }),
  };
}

test('one orchestration command returns all components pass without write access', async () => {
  const calls = [];
  const report = await runStorageReadiness({
    dependencies: dependencies(calls),
    env,
  });
  assert.equal(report.overall.status, 'pass');
  assert.equal(report.overall.exitCode, 0);
  assert.equal(report.components.length, 8);
  assert.equal(
    report.components.every((item) => item.status === 'pass'),
    true,
  );
  assert.equal(
    calls.some((call) => call.method === 'files.create'),
    false,
  );
  assert.equal(calls.filter((call) => call.method === 'about.get').length, 4);
  assert.equal(
    calls.every(
      (call) =>
        call.method === 'about.get' || call.params.supportsAllDrives === true,
    ),
    true,
  );
  assert.doesNotMatch(JSON.stringify(report), /sensitive-|private\//);
});

test('quota lookup failure preserves successful folder checks as quota unknown', async () => {
  const calls = [];
  const privateMessage = 'sensitive-quota-provider-detail';
  const testDependencies = dependencies(calls);
  testDependencies.createDriveApi = () => {
    const drive = makeDrive(calls);
    drive.about.get = async (params, requestOptions) => {
      calls.push({ method: 'about.get', params, requestOptions });
      throw new Error(privateMessage);
    };
    return drive;
  };
  const report = await runStorageReadiness({
    dependencies: testDependencies,
    env,
  });
  const driveComponents = report.components.filter((component) =>
    component.component.startsWith('app_gdrive_'),
  );
  assert.equal(report.overall.status, 'unknown');
  assert.equal(report.overall.exitCode, 3);
  assert.equal(driveComponents.length, 4);
  assert.equal(
    driveComponents.every(
      (component) =>
        component.status === 'unknown' &&
        component.reasons.includes('drive_quota_unknown') &&
        component.metrics.folderAccessible === true &&
        component.metrics.quota === 'unknown',
    ),
    true,
  );
  assert.equal(calls.filter((call) => call.method === 'about.get').length, 4);
  assert.doesNotMatch(JSON.stringify(report), new RegExp(privateMessage));
});

test('write probe is explicit and trashes one probe per configured app folder', async () => {
  const calls = [];
  const report = await runStorageReadiness({
    dependencies: dependencies(calls),
    env,
    writeProbe: true,
  });
  assert.equal(report.mode, 'write_probe');
  assert.equal(
    calls.filter((call) => call.method === 'files.create').length,
    4,
  );
  assert.equal(
    calls.filter((call) => call.method === 'files.update').length,
    4,
  );
  assert.equal(
    calls
      .filter((call) => call.method === 'files.update')
      .every(
        (call) =>
          call.params.supportsAllDrives === true &&
          call.params.requestBody.trashed === true,
      ),
    true,
  );
});

test('unconfigured default environment returns stable incomplete result', async () => {
  const report = await runStorageReadiness({
    env: {},
    dependencies: { now: () => now },
  });
  assert.equal(report.overall.status, 'not_configured');
  assert.equal(report.overall.exitCode, 3);
  assert.equal(
    report.components.every((item) => item.status === 'not_configured'),
    true,
  );
});

test('an unsupported application provider is a configuration failure', async () => {
  const report = await runStorageReadiness({
    env: { PDF_PROVIDER: 'unexpected-provider' },
    dependencies: { now: () => now },
  });
  const pdf = report.components.find(
    (component) => component.component === 'app_gdrive_pdf',
  );
  assert.deepEqual(pdf, {
    component: 'app_gdrive_pdf',
    metrics: {},
    reasons: ['drive_configuration_invalid'],
    status: 'fail',
  });
  assert.equal(report.overall.exitCode, 2);
});

test('valid non-Drive providers remain not configured for Drive monitoring', async () => {
  const report = await runStorageReadiness({
    env: {
      CHAT_ATTACHMENT_PROVIDER: 'LOCAL',
      PDF_PROVIDER: 'EXTERNAL',
      EVIDENCE_ARCHIVE_PROVIDER: 'S3',
      REPORT_PROVIDER: 'LOCAL',
    },
    dependencies: { now: () => now },
  });
  assert.equal(report.overall.status, 'not_configured');
  assert.equal(
    report.components
      .filter((component) => component.component.startsWith('app_gdrive_'))
      .every((component) => component.status === 'not_configured'),
    true,
  );
});

test('Sakura timeout is normalized without exposing provider error details', async () => {
  const privateMessage = 'private-endpoint-placeholder';
  const report = await runStorageReadiness({
    env: { ENVIRONMENT: 'prod', S3_PROVIDER: 'sakura' },
    dependencies: {
      now: () => now,
      resolveSakuraSource: () => {
        const error = new Error(privateMessage);
        error.name = 'TimeoutError';
        throw error;
      },
    },
  });
  const sakura = report.components.find(
    (component) => component.component === 'backup_sakura_primary',
  );
  assert.deepEqual(sakura, {
    component: 'backup_sakura_primary',
    metrics: {},
    reasons: ['backup_timeout'],
    status: 'unknown',
  });
  assert.doesNotMatch(JSON.stringify(report), new RegExp(privateMessage));
});

test('Sakura permanent client failures are fail-closed and sanitized', async () => {
  const privateMessage = 'private-bucket-placeholder';
  const report = await runStorageReadiness({
    env: { ENVIRONMENT: 'prod', S3_PROVIDER: 'sakura' },
    dependencies: {
      now: () => now,
      resolveSakuraSource: () => {
        const error = new Error(privateMessage);
        error.$metadata = { httpStatusCode: 400 };
        throw error;
      },
    },
  });
  const sakura = report.components.find(
    (component) => component.component === 'backup_sakura_primary',
  );
  assert.deepEqual(sakura, {
    component: 'backup_sakura_primary',
    metrics: {},
    reasons: ['backup_permanent'],
    status: 'fail',
  });
  assert.doesNotMatch(JSON.stringify(report), new RegExp(privateMessage));
});

test('unsafe environment labels fail backup configuration closed', async () => {
  const report = await runStorageReadiness({
    env: { BACKUP_DIR: '/private/backup-placeholder', ENVIRONMENT: '../prod' },
    dependencies: { now: () => now },
  });
  const local = report.components.find(
    (component) => component.component === 'backup_local',
  );
  assert.deepEqual(local, {
    component: 'backup_local',
    metrics: {},
    reasons: ['backup_configuration_invalid'],
    status: 'fail',
  });
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { runGoogleDriveCheck } from '../dist/cli/googleDriveCheckService.js';
import {
  provisionGoogleDriveFolder,
  reconcileGoogleDriveProvision,
} from '../dist/cli/googleDriveProvisionService.js';

const backendDir = resolve(import.meta.dirname, '..');

function runCli(entrypoint, env = {}) {
  return spawnSync(process.execPath, [`dist/cli/${entrypoint}.js`], {
    cwd: backendDir,
    encoding: 'utf8',
    env,
  });
}

const tuning = {
  timeoutMs: 1234,
  maxRetries: 0,
  retryBaseDelayMs: 1,
  resumableUploadThresholdBytes: 5,
};

function makeProvisionDrive(overrides = {}) {
  return {
    createResumable: async () => assert.fail('not expected'),
    files: {
      create: async () => ({ data: { id: 'folder-id-placeholder' } }),
      get: async () => assert.fail('not expected'),
      list: async () => ({ data: { files: [] } }),
      update: async () => assert.fail('not expected'),
      ...overrides,
    },
    permissions: {
      list: async () => assert.fail('not expected'),
    },
  };
}

test('Google Drive check CLI fails closed with key names and no credential values', () => {
  const result = runCli('googleDriveCheck', {
    CHAT_ATTACHMENT_GDRIVE_FOLDER_ID: 'sensitive-folder-value',
    ERP4_GDRIVE_CLIENT_ID: 'sensitive-client-value',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ERP4_GDRIVE_CLIENT_SECRET/);
  assert.match(result.stderr, /ERP4_GDRIVE_REFRESH_TOKEN/);
  assert.doesNotMatch(result.stderr, /sensitive-/);
});

test('Google Drive provision CLI requires protected output destination before API access', () => {
  const result = runCli('googleDriveProvisionFolder', {
    ERP4_GDRIVE_CLIENT_ID: 'sensitive-client-value',
    ERP4_GDRIVE_CLIENT_SECRET: 'sensitive-secret-value',
    ERP4_GDRIVE_REFRESH_TOKEN: 'sensitive-refresh-value',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GDRIVE_FOLDER_ID_OUTPUT_FILE/);
  assert.doesNotMatch(result.stderr, /sensitive-/);
});

test('Google Drive provision validates local configuration before reserving output', async () => {
  const scratchRoot = resolve(process.cwd(), '../..', '.codex-local', 'tmp');
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(join(scratchRoot, 'gdrive-provision-'));
  const outputFile = join(scratch, 'folder.env');
  try {
    const result = runCli('googleDriveProvisionFolder', {
      GDRIVE_FOLDER_ID_OUTPUT_FILE: outputFile,
      ERP4_GDRIVE_CLIENT_ID: 'client-placeholder',
      ERP4_GDRIVE_CLIENT_SECRET: 'secret-placeholder',
      ERP4_GDRIVE_REFRESH_TOKEN: 'refresh-placeholder',
      ERP4_GDRIVE_TIMEOUT_MS: '0',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ERP4_GDRIVE_TIMEOUT_MS/);
    await assert.rejects(stat(outputFile), { code: 'ENOENT' });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('Google Drive provision writes protected state and safe create parameters', async () => {
  const scratchRoot = resolve(process.cwd(), '../..', '.codex-local', 'tmp');
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(join(scratchRoot, 'gdrive-provision-success-'));
  const outputFile = join(scratch, 'folder.env');
  let call;
  const logs = [];
  try {
    await provisionGoogleDriveFolder({
      drive: makeProvisionDrive({
        create: async (params, options) => {
          call = { params, options };
          return { data: { id: 'folder-id-placeholder' } };
        },
      }),
      folderName: 'ERP4 Chat Attachments',
      outputFile,
      sharedDriveId: 'shared-drive-placeholder',
      tuning,
      marker: '00000000-0000-4000-8000-000000000001',
      log: (message) => logs.push(message),
    });

    assert.equal(call.params.supportsAllDrives, true);
    assert.equal(call.params.ignoreDefaultVisibility, true);
    assert.deepEqual(call.params.requestBody.parents, [
      'shared-drive-placeholder',
    ]);
    assert.equal(
      call.params.requestBody.appProperties.erp4ProvisionMarker,
      '00000000-0000-4000-8000-000000000001',
    );
    assert.equal(call.options.retry, false);
    assert.equal(call.options.timeout, 1234);
    assert.equal((await stat(outputFile)).mode & 0o077, 0);
    const state = await readFile(outputFile, 'utf8');
    assert.match(state, /ERP4_GDRIVE_PROVISION_STATE=COMPLETE/);
    assert.match(state, /CHAT_ATTACHMENT_GDRIVE_FOLDER_ID=/);
    assert.doesNotMatch(logs.join('\n'), /folder-id|shared-drive/i);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('Google Drive provision writes an allowlisted non-Chat folder key', async () => {
  const scratchRoot = resolve(process.cwd(), '../..', '.codex-local', 'tmp');
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(join(scratchRoot, 'gdrive-provision-pdf-'));
  const outputFile = join(scratch, 'folder.env');
  try {
    await provisionGoogleDriveFolder({
      drive: makeProvisionDrive(),
      folderName: 'ERP4 PDF Artifacts',
      outputFile,
      outputKey: 'PDF_GDRIVE_FOLDER_ID',
      tuning,
      marker: '00000000-0000-4000-8000-000000000010',
      log: () => {},
    });

    const state = await readFile(outputFile, 'utf8');
    assert.match(state, /^PDF_GDRIVE_FOLDER_ID=/m);
    assert.match(
      state,
      /^ERP4_GDRIVE_PROVISION_OUTPUT_KEY=PDF_GDRIVE_FOLDER_ID$/m,
    );
    assert.doesNotMatch(state, /^CHAT_ATTACHMENT_GDRIVE_FOLDER_ID=/m);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('Google Drive provision preserves marker state after an ambiguous create failure', async () => {
  const scratchRoot = resolve(process.cwd(), '../..', '.codex-local', 'tmp');
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(join(scratchRoot, 'gdrive-provision-unknown-'));
  const outputFile = join(scratch, 'folder.env');
  const rawError = new Error('sensitive response');
  rawError.response = { status: 503 };
  try {
    await assert.rejects(
      provisionGoogleDriveFolder({
        drive: makeProvisionDrive({
          create: async () => {
            throw rawError;
          },
        }),
        folderName: 'ERP4 Chat Attachments',
        outputFile,
        tuning,
        marker: '00000000-0000-4000-8000-000000000002',
        log: () => {},
      }),
      rawError,
    );

    const state = await readFile(outputFile, 'utf8');
    assert.match(state, /ERP4_GDRIVE_PROVISION_STATE=CREATE_STARTED/);
    assert.match(state, /00000000-0000-4000-8000-000000000002/);
    assert.doesNotMatch(state, /sensitive/);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('Google Drive provision reconciliation completes one protected marker match', async () => {
  const scratchRoot = resolve(process.cwd(), '../..', '.codex-local', 'tmp');
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(join(scratchRoot, 'gdrive-reconcile-'));
  const outputFile = join(scratch, 'folder.env');
  const marker = '00000000-0000-4000-8000-000000000003';
  const logs = [];
  let listCall;
  try {
    await writeFile(
      outputFile,
      `ERP4_GDRIVE_PROVISION_MARKER=${marker}\nERP4_GDRIVE_PROVISION_STATE=CREATE_STARTED\n`,
      { mode: 0o600 },
    );
    await chmod(outputFile, 0o600);
    await reconcileGoogleDriveProvision({
      drive: makeProvisionDrive({
        list: async (params, options) => {
          listCall = { params, options };
          return { data: { files: [{ id: 'folder-id-placeholder' }] } };
        },
      }),
      outputFile,
      sharedDriveId: 'shared-drive-placeholder',
      tuning,
      log: (message) => logs.push(message),
    });

    assert.match(listCall.params.q, /erp4ProvisionMarker/);
    assert.equal(listCall.params.supportsAllDrives, true);
    assert.equal(listCall.params.includeItemsFromAllDrives, true);
    assert.equal(listCall.params.corpora, 'drive');
    assert.equal(listCall.params.driveId, 'shared-drive-placeholder');
    const state = await readFile(outputFile, 'utf8');
    assert.match(state, /ERP4_GDRIVE_PROVISION_STATE=COMPLETE/);
    assert.match(state, /CHAT_ATTACHMENT_GDRIVE_FOLDER_ID=/);
    assert.doesNotMatch(logs.join('\n'), /folder-id|shared-drive|00000000/i);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('Google Drive write preflight checks privacy, creates, and trashes without logging IDs', async () => {
  const calls = [];
  const logs = [];
  const drive = {
    createResumable: async () => assert.fail('not expected'),
    files: {
      get: async (params, options) => {
        calls.push({ method: 'get', params, options });
        return {
          data: {
            id: 'sensitive-folder-id',
            mimeType: 'application/vnd.google-apps.folder',
            driveId: 'sensitive-shared-drive-id',
            trashed: false,
          },
        };
      },
      list: async (params, options) => {
        calls.push({ method: 'list', params, options });
        return { data: { files: [{ id: 'sensitive-existing-id' }] } };
      },
      create: async (params, options) => {
        calls.push({ method: 'create', params, options });
        const chunks = [];
        for await (const chunk of params.media.body) chunks.push(chunk);
        assert.equal(Buffer.concat(chunks).toString(), 'erp4 gdrive check');
        return { data: { id: 'sensitive-probe-id' } };
      },
      update: async (params, options) => {
        calls.push({ method: 'update', params, options });
        return { data: { id: 'sensitive-probe-id', trashed: true } };
      },
    },
    permissions: {
      list: async (params, options) => {
        calls.push({ method: 'permissions.list', params, options });
        return {
          data: {
            permissions: [
              {
                id: 'sensitive-permission-id',
                type: 'user',
                permissionDetails: [{ inherited: true }],
              },
            ],
          },
        };
      },
    },
  };

  await runGoogleDriveCheck({
    drive,
    folderId: 'sensitive-folder-id',
    sharedDriveId: 'sensitive-shared-drive-id',
    mode: 'write',
    tuning,
    now: () => new Date('2026-07-22T00:00:00.000Z'),
    log: (message) => logs.push(message),
  });

  const create = calls.find((call) => call.method === 'create');
  const update = calls.find((call) => call.method === 'update');
  assert.equal(create.params.supportsAllDrives, true);
  assert.equal(create.params.ignoreDefaultVisibility, true);
  assert.deepEqual(create.params.requestBody.parents, ['sensitive-folder-id']);
  assert.equal(update.params.fileId, 'sensitive-probe-id');
  assert.equal(update.params.supportsAllDrives, true);
  assert.deepEqual(update.params.requestBody, { trashed: true });
  assert.equal(
    calls.find((call) => call.method === 'permissions.list').params
      .supportsAllDrives,
    true,
  );
  assert.doesNotMatch(logs.join('\n'), /sensitive-/);
});

test('Google Drive Shared Drive preflight allows inherited or empty permissions only', async () => {
  for (const permissions of [
    [],
    [
      {
        id: 'inherited-group-placeholder',
        type: 'group',
        permissionDetails: [{ inherited: true }],
      },
    ],
  ]) {
    const drive = {
      createResumable: async () => assert.fail('not expected'),
      files: {
        get: async () => ({
          data: {
            id: 'folder-placeholder',
            mimeType: 'application/vnd.google-apps.folder',
            driveId: 'shared-drive-placeholder',
            trashed: false,
          },
        }),
        list: async () => ({ data: { files: [] } }),
        create: async () => assert.fail('not expected'),
        update: async () => assert.fail('not expected'),
      },
      permissions: {
        list: async () => ({ data: { permissions } }),
      },
    };
    await runGoogleDriveCheck({
      drive,
      folderId: 'folder-placeholder',
      sharedDriveId: 'shared-drive-placeholder',
      mode: 'read',
      tuning,
      log: () => {},
    });
  }
});

test('Google Drive Shared Drive preflight rejects direct folder permission', async () => {
  const drive = {
    createResumable: async () => assert.fail('not expected'),
    files: {
      get: async () => ({
        data: {
          id: 'folder-placeholder',
          mimeType: 'application/vnd.google-apps.folder',
          driveId: 'shared-drive-placeholder',
          trashed: false,
        },
      }),
      list: async () => ({ data: { files: [] } }),
      create: async () => assert.fail('not expected'),
      update: async () => assert.fail('not expected'),
    },
    permissions: {
      list: async () => ({
        data: {
          permissions: [
            {
              id: 'direct-user-placeholder',
              type: 'user',
              permissionDetails: [{ inherited: false }],
            },
          ],
        },
      }),
    },
  };

  await assert.rejects(
    runGoogleDriveCheck({
      drive,
      folderId: 'folder-placeholder',
      sharedDriveId: 'shared-drive-placeholder',
      mode: 'read',
      tuning,
      log: () => {},
    }),
    /google_drive_forbidden/,
  );
});

test('Google Drive preflight escapes backslashes and quotes in list query literals', async () => {
  let query;
  const drive = {
    createResumable: async () => assert.fail('not expected'),
    files: {
      get: async () => ({
        data: {
          id: 'folder-placeholder',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false,
        },
      }),
      list: async (params) => {
        query = params.q;
        return { data: { files: [] } };
      },
      create: async () => assert.fail('not expected'),
      update: async () => assert.fail('not expected'),
    },
    permissions: {
      list: async () => ({
        data: { permissions: [{ id: 'owner-placeholder', type: 'user' }] },
      }),
    },
  };

  await runGoogleDriveCheck({
    drive,
    folderId: "folder\\'placeholder",
    mode: 'read',
    tuning,
    log: () => {},
  });
  assert.equal(
    query,
    "'folder\\\\\\'placeholder' in parents and trashed=false",
  );
});

test('Google Drive preflight rejects broad folder permissions before write', async () => {
  let creates = 0;
  const drive = {
    createResumable: async () => assert.fail('not expected'),
    files: {
      get: async () => ({
        data: {
          id: 'folder-placeholder',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false,
        },
      }),
      list: async () => ({ data: { files: [] } }),
      create: async () => {
        creates += 1;
        return { data: { id: 'probe-placeholder' } };
      },
      update: async () => ({ data: {} }),
    },
    permissions: {
      list: async (params) =>
        params.pageToken
          ? {
              data: {
                permissions: [{ id: 'domain-placeholder', type: 'domain' }],
              },
            }
          : {
              data: {
                nextPageToken: 'second-page-placeholder',
                permissions: [{ id: 'owner-placeholder', type: 'user' }],
              },
            },
    },
  };

  await assert.rejects(
    runGoogleDriveCheck({
      drive,
      folderId: 'folder-placeholder',
      mode: 'write',
      tuning,
      log: () => {},
    }),
    /google_drive_forbidden/,
  );
  assert.equal(creates, 0);
});

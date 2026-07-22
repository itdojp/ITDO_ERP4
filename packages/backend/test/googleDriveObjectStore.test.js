import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  createGoogleDriveResumableCreate,
  GoogleDriveObjectStore,
  GoogleDriveObjectStoreError,
  normalizeGoogleDriveError,
} from '../dist/infrastructure/storage/googleDriveObjectStore.js';

const baseOptions = {
  folderId: 'folder-placeholder',
  timeoutMs: 1234,
  maxRetries: 2,
  retryBaseDelayMs: 100,
  resumableUploadThresholdBytes: 5,
};

function makeDrive(overrides = {}) {
  return {
    createResumable: async () => ({
      data: { id: 'resumable-placeholder' },
    }),
    files: {
      create: async () => ({ data: { id: 'created-placeholder' } }),
      get: async (params) => ({
        data:
          params.fileId === 'folder-placeholder'
            ? {
                id: 'folder-placeholder',
                mimeType: 'application/vnd.google-apps.folder',
                trashed: false,
              }
            : {
                id: 'stat-placeholder',
                parents: ['folder-placeholder'],
              },
      }),
      list: async () => ({ data: { files: [] } }),
      update: async () => ({ data: { id: 'updated-placeholder' } }),
      ...overrides,
    },
  };
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function readBody(body, start = 0) {
  return readAll(
    Buffer.isBuffer(body) ? Readable.from(body.subarray(start)) : body(start),
  );
}

test('put uploads multipart data to a dedicated folder with safe metadata', async () => {
  const calls = [];
  const drive = makeDrive({
    create: async (params, options) => {
      calls.push({ params, options, body: await readAll(params.media.body) });
      return {
        data: {
          id: 'file-placeholder',
          name: 'invoice.pdf',
          mimeType: 'application/pdf',
          size: '4',
          md5Checksum: 'md5-placeholder',
          appProperties: { erp4Sha256: 'sha-placeholder' },
        },
      };
    },
  });
  const store = new GoogleDriveObjectStore(drive, baseOptions);

  const result = await store.put({
    body: Buffer.from('data'),
    contentType: 'application/pdf',
    originalName: 'invoice.pdf',
    sha256: 'sha-placeholder',
    sizeBytes: 4,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.supportsAllDrives, true);
  assert.equal(calls[0].params.ignoreDefaultVisibility, true);
  assert.equal(calls[0].params.uploadType, undefined);
  assert.deepEqual(calls[0].params.requestBody.parents, ['folder-placeholder']);
  assert.deepEqual(calls[0].params.requestBody.appProperties, {
    erp4Sha256: 'sha-placeholder',
  });
  assert.equal(calls[0].params.requestBody.webViewLink, undefined);
  assert.equal(calls[0].params.requestBody.permissions, undefined);
  assert.equal(calls[0].options.retry, false);
  assert.equal(calls[0].options.timeout, 1234);
  assert.equal(calls[0].body.toString(), 'data');
  assert.equal(result.key, 'file-placeholder');
  assert.equal(result.checksum.sha256, 'sha-placeholder');
});

test('put selects resumable transport at the configured threshold', async () => {
  let call;
  const store = new GoogleDriveObjectStore(
    {
      ...makeDrive(),
      createResumable: async (input, options) => {
        call = { input, options, body: await readBody(input.media.body) };
        return { data: { id: 'large-placeholder' } };
      },
    },
    baseOptions,
  );

  await store.put({
    body: Buffer.from('large'),
    contentType: null,
    originalName: 'large.bin',
    sha256: 'sha-placeholder',
    sizeBytes: 5,
  });

  assert.equal(call.input.media.sizeBytes, 5);
  assert.equal(call.input.media.mimeType, undefined);
  assert.deepEqual(call.input.requestBody.parents, ['folder-placeholder']);
  assert.equal(
    call.input.requestBody.appProperties.erp4Sha256,
    'sha-placeholder',
  );
  assert.equal(call.options.retry, false);
  assert.equal(call.options.timeout, 1234);
  assert.equal(call.body.toString(), 'large');
});

test('idempotent put reuses one scoped object with matching hash and size', async () => {
  const calls = [];
  const idempotencyKey = 'pdf:migration:source-placeholder';
  const digest = createHash('sha256').update(idempotencyKey).digest('hex');
  const store = new GoogleDriveObjectStore(
    makeDrive({
      list: async (params, options) => {
        calls.push({ params, options });
        return {
          data: {
            files: [
              {
                id: 'existing-placeholder',
                name: 'pdf-a.pdf',
                size: '4',
                appProperties: {
                  erp4Sha256: 'sha-placeholder',
                  erp4IdempotencyKey: digest,
                },
                parents: ['folder-placeholder'],
              },
            ],
          },
        };
      },
      create: async () => assert.fail('existing object must be reused'),
    }),
    baseOptions,
  );

  const result = await store.put({
    body: Buffer.from('data'),
    contentType: 'application/pdf',
    idempotencyKey,
    originalName: 'pdf-a.pdf',
    sha256: 'sha-placeholder',
    sizeBytes: 4,
  });

  assert.equal(result.key, 'existing-placeholder');
  assert.equal(calls.length, 1);
  assert.match(calls[0].params.q, /erp4IdempotencyKey/);
  assert.match(calls[0].params.q, new RegExp(digest));
  assert.doesNotMatch(calls[0].params.q, /source-placeholder/);
  assert.equal(calls[0].params.supportsAllDrives, true);
  assert.equal(calls[0].params.includeItemsFromAllDrives, true);
  assert.equal(calls[0].params.corpora, 'user');
  assert.equal(calls[0].params.driveId, undefined);
  assert.deepEqual(calls[0].options, { retry: false, timeout: 1234 });
});

test('idempotent put uses Shared Drive corpus and writes only hashed private metadata', async () => {
  let listCall;
  let createCall;
  const idempotencyKey = 'report:migration:source-placeholder';
  const digest = createHash('sha256').update(idempotencyKey).digest('hex');
  const store = new GoogleDriveObjectStore(
    makeDrive({
      get: async (params) => ({
        data:
          params.fileId === 'folder-placeholder'
            ? {
                id: 'folder-placeholder',
                driveId: 'shared-placeholder',
                mimeType: 'application/vnd.google-apps.folder',
                trashed: false,
              }
            : { id: params.fileId },
      }),
      list: async (params, options) => {
        listCall = { params, options };
        return { data: { files: [] } };
      },
      create: async (params, options) => {
        createCall = { params, options };
        return {
          data: {
            id: 'new-placeholder',
            size: '4',
            appProperties: params.requestBody.appProperties,
          },
        };
      },
    }),
    { ...baseOptions, sharedDriveId: 'shared-placeholder' },
  );

  await store.put({
    appProperties: { erp4Context: 'report' },
    body: Buffer.from('data'),
    contentType: 'text/csv',
    idempotencyKey,
    originalName: 'report.csv',
    sha256: 'sha-placeholder',
    sizeBytes: 4,
  });

  assert.equal(listCall.params.corpora, 'drive');
  assert.equal(listCall.params.driveId, 'shared-placeholder');
  assert.deepEqual(createCall.params.requestBody.appProperties, {
    erp4Context: 'report',
    erp4Sha256: 'sha-placeholder',
    erp4IdempotencyKey: digest,
  });
  assert.doesNotMatch(
    JSON.stringify(createCall.params.requestBody.appProperties),
    /source-placeholder/,
  );
});

test('put rejects caller overrides for adapter-owned private metadata', async () => {
  for (const appProperties of [
    { erp4Sha256: 'caller-value' },
    { erp4IdempotencyKey: 'caller-value' },
  ]) {
    const store = new GoogleDriveObjectStore(
      makeDrive({
        create: async () => assert.fail('reserved metadata must be rejected'),
      }),
      baseOptions,
    );
    await assert.rejects(
      store.put({
        appProperties,
        body: Buffer.from('data'),
        contentType: null,
        originalName: 'object.bin',
        sha256: 'sha-placeholder',
        sizeBytes: 4,
      }),
      (error) =>
        error instanceof GoogleDriveObjectStoreError &&
        error.operation === 'upload' &&
        error.code === 'permanent',
    );
  }
});

test('idempotent put fails closed for ambiguous or mismatched lookup results', async () => {
  for (const data of [
    {
      files: [
        {
          id: 'mismatch-placeholder',
          size: '5',
          appProperties: { erp4Sha256: 'sha-placeholder' },
          parents: ['folder-placeholder'],
        },
      ],
    },
    { files: [], incompleteSearch: true },
    { files: [], nextPageToken: 'opaque-placeholder' },
  ]) {
    const store = new GoogleDriveObjectStore(
      makeDrive({ list: async () => ({ data }) }),
      baseOptions,
    );
    await assert.rejects(
      store.put({
        body: Buffer.from('data'),
        contentType: null,
        idempotencyKey: 'opaque-idempotency-key',
        originalName: 'object.bin',
        sha256: 'sha-placeholder',
        sizeBytes: 4,
      }),
      (error) =>
        error instanceof GoogleDriveObjectStoreError &&
        error.code === 'permanent' &&
        error.operation === 'upload',
    );
  }
});

test('resumable transport starts a Drive session and uploads to its validated URL', async () => {
  const calls = [];
  const createResumable = createGoogleDriveResumableCreate(async (options) => {
    calls.push(options);
    if (calls.length === 1) {
      return {
        data: null,
        headers: new Headers({
          location:
            'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=opaque-placeholder',
        }),
      };
    }
    return { data: { id: 'uploaded-placeholder' } };
  });

  const response = await createResumable(
    {
      fields: 'id,appProperties',
      requestBody: {
        name: 'large.bin',
        parents: ['folder-placeholder'],
        appProperties: { erp4Sha256: 'sha-placeholder' },
      },
      media: {
        body: () => Readable.from('content'),
        mimeType: 'application/octet-stream',
        sizeBytes: 7,
      },
    },
    { timeout: 1234 },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'POST');
  assert.equal(
    calls[0].url,
    'https://www.googleapis.com/upload/drive/v3/files',
  );
  assert.deepEqual(calls[0].params, {
    uploadType: 'resumable',
    supportsAllDrives: true,
    ignoreDefaultVisibility: true,
    fields: 'id,appProperties',
  });
  assert.equal(calls[0].headers['X-Upload-Content-Length'], '7');
  assert.equal(calls[0].retry, false);
  assert.equal(calls[1].method, 'PUT');
  assert.match(calls[1].url, /^https:\/\/www\.googleapis\.com\/upload\//);
  assert.equal(calls[1].headers['Content-Length'], '7');
  assert.equal(calls[1].headers['Content-Range'], 'bytes 0-6/7');
  assert.equal((await readAll(calls[1].data)).toString(), 'content');
  assert.deepEqual(response.data, { id: 'uploaded-placeholder' });
});

test('resumable transport rejects an untrusted session URL without sending content', async () => {
  let calls = 0;
  const createResumable = createGoogleDriveResumableCreate(async () => {
    calls += 1;
    return {
      data: null,
      headers: { location: 'https://attacker.invalid/upload/session' },
    };
  });

  await assert.rejects(
    createResumable({
      fields: 'id',
      requestBody: {
        name: 'large.bin',
        parents: ['folder-placeholder'],
        appProperties: { erp4Sha256: 'sha-placeholder' },
      },
      media: {
        body: () => Readable.from('content'),
        sizeBytes: 7,
      },
    }),
    (error) =>
      error instanceof GoogleDriveObjectStoreError &&
      error.code === 'permanent' &&
      error.operation === 'upload',
  );
  assert.equal(calls, 1);
});

test('resumable transport resumes the same session from the acknowledged offset', async () => {
  const calls = [];
  const starts = [];
  const sleeps = [];
  const createResumable = createGoogleDriveResumableCreate(
    async (options) => {
      const call = { ...options };
      if (options.data instanceof Readable) {
        call.uploaded = await readAll(options.data);
      }
      calls.push(call);
      if (calls.length === 1) {
        return {
          data: null,
          headers: {
            location:
              'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=opaque-placeholder',
          },
        };
      }
      if (calls.length === 2) {
        const error = new Error('sensitive transport failure');
        error.response = { status: 503 };
        throw error;
      }
      if (calls.length === 3) {
        return {
          data: null,
          headers: { range: 'bytes=0-2' },
          status: 308,
        };
      }
      return { data: { id: 'uploaded-placeholder' }, status: 200 };
    },
    { random: () => 0, sleep: async (delay) => sleeps.push(delay) },
  );

  const response = await createResumable(
    {
      fields: 'id',
      requestBody: {
        name: 'large.bin',
        parents: ['folder-placeholder'],
        appProperties: { erp4Sha256: 'sha-placeholder' },
      },
      media: {
        body: (start = 0) => {
          starts.push(start);
          return Readable.from(Buffer.from('content').subarray(start));
        },
        sizeBytes: 7,
      },
    },
    { maxRetries: 2, retryBaseDelayMs: 100, timeout: 1234 },
  );

  assert.deepEqual(response.data, { id: 'uploaded-placeholder' });
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
  assert.equal(calls[2].headers['Content-Range'], 'bytes */7');
  assert.equal(calls[3].headers['Content-Range'], 'bytes 3-6/7');
  assert.equal(calls[3].uploaded.toString(), 'tent');
  assert.deepEqual(starts, [0, 3]);
  assert.deepEqual(sleeps, [100]);
});

test('put validates the configured Shared Drive target once', async () => {
  const calls = [];
  const drive = makeDrive({
    get: async (params, options) => {
      calls.push({ method: 'get', params, options });
      return {
        data: {
          id: 'folder-placeholder',
          driveId: 'shared-placeholder',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false,
        },
      };
    },
    create: async (params, options) => {
      calls.push({ method: 'create', params, options });
      return { data: { id: 'file-placeholder' } };
    },
  });
  const store = new GoogleDriveObjectStore(drive, {
    ...baseOptions,
    sharedDriveId: 'shared-placeholder',
  });
  const input = {
    body: Buffer.from('x'),
    contentType: null,
    originalName: 'x',
    sha256: 'sha-placeholder',
    sizeBytes: 1,
  };

  await store.put(input);
  await store.put(input);

  const targetChecks = calls.filter((call) => call.method === 'get');
  assert.equal(targetChecks.length, 1);
  assert.equal(targetChecks[0].params.supportsAllDrives, true);
  assert.equal(targetChecks[0].options.retry, false);
  assert.equal(calls.filter((call) => call.method === 'create').length, 2);
});

test('Shared Drive target mismatch fails without exposing identifiers', async () => {
  const store = new GoogleDriveObjectStore(
    makeDrive({
      get: async () => ({
        data: {
          id: 'sensitive-folder-id',
          driveId: 'different-sensitive-drive-id',
          mimeType: 'application/vnd.google-apps.folder',
        },
      }),
    }),
    { ...baseOptions, sharedDriveId: 'sensitive-shared-drive-id' },
  );

  await assert.rejects(
    store.put({
      body: Buffer.from('x'),
      contentType: null,
      originalName: 'x',
      sha256: 'sha',
      sizeBytes: 1,
    }),
    (error) => {
      assert.ok(error instanceof GoogleDriveObjectStoreError);
      assert.equal(error.code, 'permanent');
      assert.equal(error.operation, 'target_check');
      assert.doesNotMatch(JSON.stringify(error), /sensitive-/);
      return true;
    },
  );
});

test('put never repeats files.create after an ambiguous retryable failure', async () => {
  let calls = 0;
  const store = new GoogleDriveObjectStore(
    makeDrive({
      create: async () => {
        calls += 1;
        const error = new Error('request failed with sensitive-refresh-token');
        error.response = {
          status: 503,
          data: { error: { message: 'sensitive-secret' } },
        };
        throw error;
      },
    }),
    baseOptions,
    { sleep: async () => assert.fail('upload retry must not sleep') },
  );

  await assert.rejects(
    store.put({
      body: Buffer.from('x'),
      contentType: null,
      originalName: 'x',
      sha256: 'sha',
      sizeBytes: 1,
    }),
    (error) => {
      assert.ok(error instanceof GoogleDriveObjectStoreError);
      assert.equal(error.code, 'retryable');
      assert.equal(error.operation, 'upload');
      assert.doesNotMatch(JSON.stringify(error), /sensitive-/);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('get returns a proxy stream and sanitizes later stream errors', async () => {
  const source = new Readable({ read() {} });
  let call;
  const store = new GoogleDriveObjectStore(
    makeDrive({
      get: async (params, options) => {
        if (params.alt !== 'media') {
          return {
            data: {
              id: 'file-placeholder',
              parents: ['folder-placeholder'],
            },
          };
        }
        call = { params, options };
        return { data: source };
      },
    }),
    baseOptions,
  );
  const opened = await store.get('file-placeholder');
  const streamError = new Promise((resolve) =>
    opened.stream.once('error', resolve),
  );

  const raw = new Error('sensitive bearer token');
  raw.code = 'ECONNRESET';
  source.destroy(raw);
  const error = await streamError;

  assert.equal(call.params.fileId, 'file-placeholder');
  assert.equal(call.params.alt, 'media');
  assert.equal(call.params.supportsAllDrives, true);
  assert.deepEqual(call.options, {
    responseType: 'stream',
    retry: false,
    timeout: 1234,
  });
  assert.ok(error instanceof GoogleDriveObjectStoreError);
  assert.equal(error.code, 'retryable');
  assert.doesNotMatch(JSON.stringify(error), /sensitive|bearer/i);
});

test('get streams downloaded content with Shared Drive support', async () => {
  let call;
  const store = new GoogleDriveObjectStore(
    makeDrive({
      get: async (params, options) => {
        if (params.alt !== 'media') {
          return {
            data: {
              id: 'file-placeholder',
              parents: ['folder-placeholder'],
            },
          };
        }
        call = { params, options };
        return { data: Readable.from('download-content') };
      },
    }),
    baseOptions,
  );

  const opened = await store.get('file-placeholder');

  assert.equal((await readAll(opened.stream)).toString(), 'download-content');
  assert.deepEqual(call.params, {
    fileId: 'file-placeholder',
    alt: 'media',
    supportsAllDrives: true,
  });
  assert.deepEqual(call.options, {
    responseType: 'stream',
    retry: false,
    timeout: 1234,
  });
});

test('stat maps Drive checksum and metadata using Shared Drive parameters', async () => {
  let call;
  const store = new GoogleDriveObjectStore(
    makeDrive({
      get: async (params, options) => {
        call = { params, options };
        return {
          data: {
            id: 'file-placeholder',
            name: 'fallback-name',
            originalFilename: 'original-name.pdf',
            mimeType: 'application/pdf',
            size: '42',
            md5Checksum: 'md5-placeholder',
            sha1Checksum: 'sha1-placeholder',
            sha256Checksum: 'sha256-placeholder',
            trashed: false,
            createdTime: '2026-07-01T00:00:00Z',
            modifiedTime: '2026-07-02T00:00:00Z',
            parents: ['folder-placeholder'],
          },
        };
      },
    }),
    baseOptions,
  );

  const result = await store.stat('file-placeholder');

  assert.equal(call.params.supportsAllDrives, true);
  assert.match(call.params.fields, /sha256Checksum/);
  assert.equal(call.options.retry, false);
  assert.deepEqual(result.checksum, {
    md5: 'md5-placeholder',
    sha1: 'sha1-placeholder',
    sha256: 'sha256-placeholder',
  });
  assert.equal(result.originalName, 'original-name.pdf');
  assert.equal(result.sizeBytes, 42);
});

test('list scopes every page to the configured Shared Drive and private properties', async () => {
  const calls = [];
  const store = new GoogleDriveObjectStore(
    makeDrive({
      get: async () => ({
        data: {
          id: 'folder-placeholder',
          driveId: 'shared-placeholder',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false,
        },
      }),
      list: async (params, options) => {
        calls.push({ params, options });
        return {
          data: {
            files: [
              {
                id: `file-${calls.length}`,
                name: `backup-${calls.length}.gpg`,
                size: '42',
                appProperties: {
                  erp4BackupSchema: 'v1',
                  erp4Sha256: 'a'.repeat(64),
                },
                driveId: 'shared-placeholder',
                parents: ['folder-placeholder'],
              },
            ],
            incompleteSearch: false,
            nextPageToken: calls.length === 1 ? 'next-placeholder' : null,
          },
        };
      },
    }),
    { ...baseOptions, sharedDriveId: 'shared-placeholder' },
  );

  const result = await store.list({
    appProperties: { erp4BackupSchema: 'v1' },
    pageSize: 100,
  });

  assert.equal(result.items.length, 2);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.params.supportsAllDrives, true);
    assert.equal(call.params.includeItemsFromAllDrives, true);
    assert.equal(call.params.corpora, 'drive');
    assert.equal(call.params.driveId, 'shared-placeholder');
    assert.match(call.params.q, /'folder-placeholder' in parents/);
    assert.match(call.params.q, /erp4BackupSchema/);
    assert.equal(call.options.retry, false);
  }
  assert.equal(calls[1].params.pageToken, 'next-placeholder');
  assert.equal(result.items[0].appProperties.erp4BackupSchema, 'v1');
  assert.equal(result.items[0].checksum.sha256, 'a'.repeat(64));
});

test('list rejects an incomplete Shared Drive search', async () => {
  const store = new GoogleDriveObjectStore(
    makeDrive({
      get: async () => ({
        data: {
          id: 'folder-placeholder',
          driveId: 'shared-placeholder',
          mimeType: 'application/vnd.google-apps.folder',
          trashed: false,
        },
      }),
      list: async () => ({
        data: { files: [], incompleteSearch: true },
      }),
    }),
    { ...baseOptions, sharedDriveId: 'shared-placeholder' },
  );

  await assert.rejects(
    store.list({ appProperties: { erp4BackupSchema: 'v1' } }),
    (error) =>
      error instanceof GoogleDriveObjectStoreError &&
      error.operation === 'list' &&
      error.code === 'permanent',
  );
});

test('trash uses files.update rather than permanent deletion', async () => {
  let call;
  const store = new GoogleDriveObjectStore(
    makeDrive({
      update: async (params, options) => {
        call = { params, options };
        return { data: { id: 'file-placeholder', trashed: true } };
      },
    }),
    baseOptions,
  );

  await store.trash('file-placeholder');

  assert.deepEqual(call.params.requestBody, { trashed: true });
  assert.equal(call.params.supportsAllDrives, true);
  assert.equal(call.options.retry, false);
});

test('download and trash fail closed for an object outside the configured folder', async () => {
  let mediaCalls = 0;
  let updateCalls = 0;
  const store = new GoogleDriveObjectStore(
    makeDrive({
      get: async (params) => {
        if (params.alt === 'media') mediaCalls += 1;
        return {
          data: {
            id: 'outside-placeholder',
            parents: ['different-folder-placeholder'],
          },
        };
      },
      update: async () => {
        updateCalls += 1;
        return { data: { id: 'outside-placeholder' } };
      },
    }),
    baseOptions,
  );

  for (const operation of [
    () => store.get('outside-placeholder'),
    () => store.trash('outside-placeholder'),
  ]) {
    await assert.rejects(
      operation(),
      (error) =>
        error instanceof GoogleDriveObjectStoreError &&
        error.code === 'permanent',
    );
  }
  assert.equal(mediaCalls, 0);
  assert.equal(updateCalls, 0);
});

test('stat fails closed for an object from a different Shared Drive', async () => {
  const store = new GoogleDriveObjectStore(
    makeDrive({
      get: async () => ({
        data: {
          id: 'outside-placeholder',
          driveId: 'different-shared-placeholder',
          parents: ['folder-placeholder'],
        },
      }),
    }),
    { ...baseOptions, sharedDriveId: 'shared-placeholder' },
  );

  await assert.rejects(
    store.stat('outside-placeholder'),
    (error) =>
      error instanceof GoogleDriveObjectStoreError &&
      error.code === 'permanent' &&
      error.operation === 'stat',
  );
});

test('idempotent stat retries with bounded exponential delay', async () => {
  let calls = 0;
  const sleeps = [];
  const store = new GoogleDriveObjectStore(
    makeDrive({
      get: async () => {
        calls += 1;
        if (calls < 3) {
          const error = new Error('temporary');
          error.response = { status: 503 };
          throw error;
        }
        return {
          data: {
            id: 'file-placeholder',
            parents: ['folder-placeholder'],
          },
        };
      },
    }),
    baseOptions,
    { sleep: async (delay) => sleeps.push(delay), random: () => 0 },
  );

  const result = await store.stat('file-placeholder');

  assert.equal(result.key, 'file-placeholder');
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [100, 200]);
});

const errorCases = [
  ['auth_expired', { response: { status: 401 } }, false],
  ['auth_expired', { code: 'invalid_grant' }, false],
  ['forbidden', { response: { status: 403 } }, false],
  [
    'quota',
    {
      response: {
        status: 403,
        data: { error: { errors: [{ reason: 'storageQuotaExceeded' }] } },
      },
    },
    false,
  ],
  ['not_found', { response: { status: 404 } }, false],
  ['quota', { response: { status: 429 } }, true],
  [
    'quota',
    {
      response: {
        status: 403,
        data: { error: { errors: [{ reason: 'userRateLimitExceeded' }] } },
      },
    },
    true,
  ],
  ['retryable', { response: { status: 503 } }, true],
  ['timeout', { response: { status: 408 } }, true],
  ['timeout', { code: 'ECONNABORTED' }, true],
  ['timeout', { code: 'ETIMEDOUT' }, true],
  ['permanent', { response: { status: 400 } }, false],
];

for (const [expectedCode, raw, retryable] of errorCases) {
  test(`normalizes Google Drive errors as ${expectedCode}`, () => {
    const error = normalizeGoogleDriveError(raw, 'stat');
    assert.equal(error.code, expectedCode);
    assert.equal(error.retryable, retryable);
    assert.equal(error.message, `google_drive_${expectedCode}`);
  });
}

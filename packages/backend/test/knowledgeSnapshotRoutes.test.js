import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import multipart from '@fastify/multipart';
import Fastify from 'fastify';

import { registerKnowledgeSnapshotRoutes } from '../dist/routes/knowledgeSnapshots.js';
import { knowledgeSnapshotLimits } from '../dist/application/knowledge/knowledgeSnapshotPorts.js';
import { mapErrorToResponse } from '../dist/services/errors.js';

const capturedAt = new Date('2026-08-05T12:00:00.000Z');
const readyAt = new Date('2026-08-05T12:00:01.000Z');
const updatedAt = new Date('2026-08-05T12:00:02.000Z');

function snapshot(overrides = {}) {
  return {
    id: 'snapshot-1',
    knowledgeItemId: 'item-1',
    artifactId: 'artifact-internal-1',
    version: 1,
    status: 'ready',
    captureMethod: 'text',
    sourceUrl: null,
    originalName: 'snapshot.txt',
    contentType: 'text/plain',
    sizeBytes: 12,
    sha256: 'a'.repeat(64),
    extractedText: 'snapshot body',
    requestKeyHash: 'b'.repeat(64),
    requestPayloadHash: 'c'.repeat(64),
    failureCode: null,
    capturedAt,
    capturedBy: 'owner-1',
    readyAt,
    failedAt: null,
    createdAt: capturedAt,
    updatedAt,
    providerKey: 'provider-key-must-not-leak',
    downloadUrl: 'https://drive.example.invalid/private',
    ...overrides,
  };
}

function serviceStub(overrides = {}) {
  return {
    capture: async () => ({
      ok: true,
      value: { replayed: false, snapshot: snapshot() },
    }),
    list: async () => ({ ok: true, value: { items: [snapshot()] } }),
    detail: async () => ({ ok: true, value: snapshot() }),
    reconcile: async () => ({ ok: true, value: snapshot() }),
    openDownload: async () => ({
      ok: true,
      value: {
        snapshot: snapshot(),
        opened: {
          artifact: {
            artifactId: 'artifact-internal-1',
            contentType: 'text/plain',
            createdAt: capturedAt.toISOString(),
            originalName: 'snapshot.txt',
            provider: 'local',
            sha256: 'a'.repeat(64),
            sizeBytes: 12,
          },
          stream: Readable.from(Buffer.from('snapshot body')),
        },
      },
    }),
    ...overrides,
  };
}

async function buildServer(service, user = {}, options = {}) {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    const mapped = mapErrorToResponse(error, { env: 'test' });
    return reply.status(mapped.statusCode).send(mapped.body);
  });
  app.addHook('onRequest', async (request) => {
    request.user = {
      userId: 'owner-1',
      roles: ['user'],
      orgId: 'org-1',
      groupAccountIds: ['group-1'],
      auth: {
        principalUserId: 'principal-1',
        actorUserId: 'owner-1',
        scopes: ['knowledge:write'],
        delegated: false,
        providerType: 'header',
      },
      ...user,
    };
    if (options.fileOverride) {
      request.file = options.fileOverride;
    }
  });
  await app.register(multipart);
  await registerKnowledgeSnapshotRoutes(app, { service });
  await app.ready();
  return app;
}

function multipartPayload(boundary, file) {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType}\r\n\r\n`,
    ),
    file.body,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

function assertNoInternalStorageFields(value) {
  const serialized = JSON.stringify(value);
  for (const secret of [
    'artifactId',
    'requestKeyHash',
    'requestPayloadHash',
    'providerKey',
    'downloadUrl',
    'artifact-internal-1',
    'provider-key-must-not-leak',
    'drive.example.invalid',
  ]) {
    assert.equal(serialized.includes(secret), false, `${secret} leaked`);
  }
}

test('text and URL capture map the canonical actor and audit context with create/replay statuses', async (t) => {
  const captured = [];
  const app = await buildServer(
    serviceStub({
      capture: async (input) => {
        captured.push(input);
        return {
          ok: true,
          value: {
            replayed: input.captureMethod === 'url',
            snapshot: snapshot({
              captureMethod: input.captureMethod,
              sourceUrl: input.url ?? null,
              originalName:
                input.captureMethod === 'url' ? 'source.html' : 'note.txt',
              contentType:
                input.captureMethod === 'url' ? 'text/html' : 'text/plain',
            }),
          },
        };
      },
    }),
  );
  t.after(() => app.close());

  const textResponse = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/snapshots',
    payload: {
      captureMethod: 'text',
      requestKey: 'text-request-1',
      originalName: 'note.txt',
      text: 'snapshot body',
    },
  });
  assert.equal(textResponse.statusCode, 201, textResponse.body);
  assert.equal(textResponse.json().captureMethod, 'text');
  assert.equal(textResponse.json().readyAt, readyAt.toISOString());
  assertNoInternalStorageFields(textResponse.json());

  const urlResponse = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/snapshots',
    payload: {
      captureMethod: 'url',
      requestKey: 'url-request-1',
      url: 'https://example.invalid/article',
    },
  });
  assert.equal(urlResponse.statusCode, 200, urlResponse.body);
  assert.equal(urlResponse.json().captureMethod, 'url');
  assert.equal(urlResponse.json().sourceUrl, 'https://example.invalid/article');
  assertNoInternalStorageFields(urlResponse.json());

  assert.deepEqual(captured[0].actor, {
    userId: 'owner-1',
    organizationId: 'org-1',
    groupAccountIds: ['group-1'],
  });
  assert.equal(captured[0].auditActor.source, 'api');
  assert.match(captured[0].auditActor.requestId, /^[A-Za-z0-9._-]{1,128}$/);
  assert.equal(captured[0].itemId, 'item-1');
  assert.equal(captured[0].text, 'snapshot body');
  assert.equal(captured[1].url, 'https://example.invalid/article');
});

test('capture schema requires the payload selected by captureMethod before the service', async (t) => {
  let calls = 0;
  const app = await buildServer(
    serviceStub({
      capture: async () => {
        calls += 1;
        assert.fail('schema-invalid capture must not reach the service');
      },
    }),
  );
  t.after(() => app.close());

  const invalidPayloads = [
    {
      captureMethod: 'text',
      requestKey: 'missing-text',
    },
    {
      captureMethod: 'url',
      requestKey: 'missing-url',
    },
    {
      captureMethod: 'text',
      requestKey: 'text-with-url',
      text: 'snapshot body',
      url: 'https://example.invalid/article',
    },
    {
      captureMethod: 'url',
      requestKey: 'url-with-text',
      url: 'https://example.invalid/article',
      text: 'snapshot body',
    },
  ];

  for (const payload of invalidPayloads) {
    const response = await app.inject({
      method: 'POST',
      url: '/knowledge/items/item-1/snapshots',
      payload,
    });
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal(calls, 0);
});

test('text capture accepts the documented UTF-8 byte limit with worst-case JSON escaping', async (t) => {
  let captured;
  const app = await buildServer(
    serviceStub({
      capture: async (input) => {
        captured = input;
        return {
          ok: true,
          value: { replayed: false, snapshot: snapshot() },
        };
      },
    }),
  );
  t.after(() => app.close());

  const text = '\u0000'.repeat(knowledgeSnapshotLimits.maxTextBytes);
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/snapshots',
    payload: {
      captureMethod: 'text',
      requestKey: 'text-at-byte-limit',
      text,
    },
  });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(
    Buffer.byteLength(captured.text, 'utf8'),
    knowledgeSnapshotLimits.maxTextBytes,
  );
});

test('text capture rejects a multi-byte body over the UTF-8 limit before the service', async (t) => {
  let calls = 0;
  const app = await buildServer(
    serviceStub({
      capture: async () => {
        calls += 1;
        assert.fail('oversized UTF-8 text must not reach snapshot capture');
      },
    }),
  );
  t.after(() => app.close());

  const text = 'é'.repeat(
    Math.floor(knowledgeSnapshotLimits.maxTextBytes / 2) + 1,
  );
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/snapshots',
    payload: {
      captureMethod: 'text',
      requestKey: 'text-over-byte-limit',
      text,
    },
  });

  assert.equal(response.statusCode, 413, response.body);
  assert.equal(response.json().error?.code, 'snapshot_content_too_large');
  assert.equal(calls, 0);
});

test('multipart upload accepts one bounded file and maps only file metadata and bytes', async (t) => {
  let captured;
  const app = await buildServer(
    serviceStub({
      capture: async (input) => {
        captured = input;
        return {
          ok: true,
          value: {
            replayed: false,
            snapshot: snapshot({
              captureMethod: 'upload',
              originalName: input.upload.originalName,
              contentType: input.upload.contentType,
              sizeBytes: input.upload.body.length,
            }),
          },
        };
      },
    }),
  );
  t.after(() => app.close());

  const boundary = '----erp4-knowledge-snapshot';
  const body = Buffer.from('uploaded snapshot');
  const payload = multipartPayload(boundary, {
    filename: 'capture.txt',
    contentType: 'text/plain',
    body,
  });
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/snapshots/upload?requestKey=upload-1',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(payload.length),
    },
    payload,
  });

  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().captureMethod, 'upload');
  assert.deepEqual(captured.upload, {
    body,
    contentType: 'text/plain',
    originalName: 'capture.txt',
  });
  assert.equal(captured.requestKey, 'upload-1');
  assert.equal(captured.itemId, 'item-1');
  assertNoInternalStorageFields(response.json());
});

test('multipart upload rejects a missing file and schema rejects a missing request key before capture', async (t) => {
  let calls = 0;
  const app = await buildServer(
    serviceStub({
      capture: async () => {
        calls += 1;
        return {
          ok: true,
          value: { replayed: false, snapshot: snapshot() },
        };
      },
    }),
  );
  t.after(() => app.close());

  const boundary = '----erp4-empty-upload';
  const emptyMultipart = Buffer.from(`--${boundary}--\r\n`);
  const noFile = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/snapshots/upload?requestKey=upload-1',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: emptyMultipart,
  });
  assert.equal(noFile.statusCode, 400, noFile.body);
  assert.equal(noFile.json().error?.code, 'invalid_request');

  const noRequestKey = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/snapshots/upload',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: emptyMultipart,
  });
  assert.equal(noRequestKey.statusCode, 400, noRequestKey.body);
  assert.equal(calls, 0);
});

test('multipart parser size errors map to a sanitized content-too-large response', async (t) => {
  let calls = 0;
  const parserError = Object.assign(new Error('private parser detail'), {
    code: 'FST_REQ_FILE_TOO_LARGE',
  });
  const app = await buildServer(
    serviceStub({
      capture: async () => {
        calls += 1;
        assert.fail('parser-rejected upload must not reach snapshot capture');
      },
    }),
    {},
    {
      fileOverride: async () => {
        throw parserError;
      },
    },
  );
  t.after(() => app.close());

  const boundary = '----erp4-parser-limit-upload';
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/snapshots/upload?requestKey=parser-limit',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(`--${boundary}--\r\n`),
  });

  assert.equal(response.statusCode, 413, response.body);
  assert.equal(response.json().error?.code, 'snapshot_content_too_large');
  assert.equal(response.json().error?.message, 'Snapshot content is too large');
  assert.doesNotMatch(response.body, /private parser detail/);
  assert.equal(calls, 0);
});

test('multipart truncation destroys the upload stream before returning 413', async (t) => {
  let calls = 0;
  let destroyCalls = 0;
  const truncatedStream = new Readable({
    autoDestroy: false,
    read() {
      this.push(Buffer.from('truncated upload'));
      this.push(null);
    },
  });
  truncatedStream.truncated = true;
  const originalDestroy = truncatedStream.destroy.bind(truncatedStream);
  truncatedStream.destroy = (error) => {
    destroyCalls += 1;
    return originalDestroy(error);
  };
  const app = await buildServer(
    serviceStub({
      capture: async () => {
        calls += 1;
        assert.fail('truncated upload must not reach snapshot capture');
      },
    }),
    {},
    {
      fileOverride: async () => ({
        mimetype: 'text/plain',
        filename: 'truncated.txt',
        file: truncatedStream,
      }),
    },
  );
  t.after(() => app.close());

  const boundary = '----erp4-truncated-upload';
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/snapshots/upload?requestKey=truncated',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(`--${boundary}--\r\n`),
  });

  assert.equal(response.statusCode, 413, response.body);
  assert.equal(response.json().error?.code, 'snapshot_content_too_large');
  assert.equal(destroyCalls, 1);
  assert.equal(truncatedStream.destroyed, true);
  assert.equal(calls, 0);
});

test('multipart upload enforces the text-specific byte limit before capture', async (t) => {
  let calls = 0;
  const app = await buildServer(
    serviceStub({
      capture: async () => {
        calls += 1;
        assert.fail('oversized text must not reach snapshot capture');
      },
    }),
  );
  t.after(() => app.close());

  const boundary = '----erp4-oversized-text-upload';
  const payload = multipartPayload(boundary, {
    filename: 'oversized.txt',
    contentType: 'text/plain',
    body: Buffer.alloc(knowledgeSnapshotLimits.maxTextBytes + 1, 0x61),
  });
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/snapshots/upload?requestKey=oversized-text',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload,
  });

  assert.equal(response.statusCode, 413, response.body);
  assert.equal(response.json().error?.code, 'snapshot_content_too_large');
  assert.equal(calls, 0);
});

test('multipart upload maps non-size stream failures to a sanitized invalid request', async (t) => {
  let calls = 0;
  const brokenStream = new Readable({
    read() {
      this.destroy(new Error('private transport detail'));
    },
  });
  const app = await buildServer(
    serviceStub({
      capture: async () => {
        calls += 1;
        assert.fail('unreadable upload must not reach snapshot capture');
      },
    }),
    {},
    {
      fileOverride: async () => ({
        mimetype: 'text/plain',
        filename: 'broken.txt',
        file: brokenStream,
      }),
    },
  );
  t.after(() => app.close());

  const boundary = '----erp4-broken-upload';
  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/snapshots/upload?requestKey=broken-upload',
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(`--${boundary}--\r\n`),
  });

  assert.equal(response.statusCode, 400, response.body);
  assert.equal(response.json().error?.code, 'invalid_request');
  assert.doesNotMatch(response.body, /private transport detail/);
  assert.equal(calls, 0);
});

test('list and detail serialize pending, ready, and failed states without internal metadata', async (t) => {
  const statuses = [
    snapshot({
      id: 'snapshot-pending',
      artifactId: null,
      status: 'pending',
      contentType: null,
      sizeBytes: null,
      sha256: null,
      extractedText: null,
      readyAt: null,
    }),
    snapshot({ id: 'snapshot-ready' }),
    snapshot({
      id: 'snapshot-failed',
      artifactId: null,
      status: 'failed',
      contentType: null,
      sizeBytes: null,
      sha256: null,
      extractedText: null,
      failureCode: 'snapshot_capture_failed',
      readyAt: null,
      failedAt: readyAt,
    }),
  ];
  const captured = [];
  const app = await buildServer(
    serviceStub({
      list: async (input) => {
        captured.push(['list', input]);
        return { ok: true, value: { items: statuses } };
      },
      detail: async (input) => {
        captured.push(['detail', input]);
        return { ok: true, value: statuses[1] };
      },
    }),
  );
  t.after(() => app.close());

  const list = await app.inject({
    method: 'GET',
    url: '/knowledge/items/item-1/snapshots?limit=3',
  });
  assert.equal(list.statusCode, 200, list.body);
  assert.deepEqual(
    list.json().items.map((item) => item.status),
    ['pending', 'ready', 'failed'],
  );
  assert.equal('extractedText' in list.json().items[1], false);
  assertNoInternalStorageFields(list.json());

  const detailResponse = await app.inject({
    method: 'GET',
    url: '/knowledge/items/item-1/snapshots/snapshot-ready',
  });
  assert.equal(detailResponse.statusCode, 200, detailResponse.body);
  assert.equal(detailResponse.json().extractedText, 'snapshot body');
  assertNoInternalStorageFields(detailResponse.json());
  assert.equal(captured[0][1].limit, 3);
  assert.equal(captured[1][1].snapshotId, 'snapshot-ready');
});

test('reconcile maps actor, audit context, ids, and request key without leaking storage metadata', async (t) => {
  let captured;
  const app = await buildServer(
    serviceStub({
      reconcile: async (input) => {
        captured = input;
        return { ok: true, value: snapshot() };
      },
    }),
  );
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/snapshots/snapshot-1/reconcile',
    payload: { requestKey: 'reconcile-1' },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(captured.itemId, 'item-1');
  assert.equal(captured.snapshotId, 'snapshot-1');
  assert.equal(captured.requestKey, 'reconcile-1');
  assert.equal(captured.actor.userId, 'owner-1');
  assert.equal(captured.auditActor.source, 'api');
  assertNoInternalStorageFields(response.json());
});

test('download is attachment-only, disables sniffing/caching/active content, and sanitizes the filename', async (t) => {
  let captured;
  const app = await buildServer(
    serviceStub({
      openDownload: async (input) => {
        captured = input;
        return {
          ok: true,
          value: {
            snapshot: snapshot({ originalName: 'report"\n.html' }),
            opened: {
              artifact: {
                artifactId: 'artifact-internal-1',
                contentType: 'text/html',
                createdAt: capturedAt.toISOString(),
                originalName: 'report.html',
                provider: 'gdrive',
                sha256: 'a'.repeat(64),
                sizeBytes: 25,
              },
              stream: Readable.from(Buffer.from('<script>private()</script>')),
            },
          },
        };
      },
    }),
  );
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/knowledge/items/item-1/snapshots/snapshot-1/download',
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.headers['content-type'], 'application/octet-stream');
  assert.equal(
    response.headers['content-disposition'],
    'attachment; filename="report__.html"',
  );
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(
    response.headers['content-security-policy'],
    "sandbox; default-src 'none'",
  );
  assert.equal(response.headers['content-length'], '25');
  assert.equal(response.body, '<script>private()</script>');
  assert.equal(captured.actor.userId, 'owner-1');
  assert.equal(captured.snapshotId, 'snapshot-1');
  assert.equal(
    JSON.stringify(response.headers).includes('artifact-internal-1'),
    false,
  );
});

test('download maps an authorized provider failure to a sanitized 502 response', async (t) => {
  const app = await buildServer(
    serviceStub({
      openDownload: async () => ({
        ok: false,
        statusCode: 502,
        code: 'snapshot_download_failed',
        message: 'Snapshot download failed',
      }),
    }),
  );
  t.after(() => app.close());

  const response = await app.inject({
    method: 'GET',
    url: '/knowledge/items/item-1/snapshots/snapshot-1/download',
  });
  assert.equal(response.statusCode, 502, response.body);
  assert.equal(response.json().error?.code, 'snapshot_download_failed');
  assert.doesNotMatch(response.body, /provider|credential|artifact-internal/);
});

test('canonical actor and allowed role checks fail closed before any service method', async (t) => {
  let calls = 0;
  const called = async () => {
    calls += 1;
    return { ok: true, value: { items: [] } };
  };
  const base = serviceStub({
    capture: called,
    list: called,
    detail: called,
    reconcile: called,
    openDownload: called,
  });

  const missingCanonical = await buildServer(base, {
    userId: 'raw-provider-subject',
    auth: {
      principalUserId: 'raw-provider-subject',
      actorUserId: 'raw-provider-subject',
      scopes: ['knowledge:write'],
      delegated: false,
      providerType: 'google_oidc',
    },
  });
  t.after(() => missingCanonical.close());
  const missingCanonicalResponse = await missingCanonical.inject({
    method: 'GET',
    url: '/knowledge/items/item-1/snapshots',
  });
  assert.equal(missingCanonicalResponse.statusCode, 403);
  assert.equal(
    missingCanonicalResponse.json().error?.details?.reason,
    'canonical_account_required',
  );

  const deniedRole = await buildServer(base, { roles: ['auditor'] });
  t.after(() => deniedRole.close());
  const deniedRoleResponse = await deniedRole.inject({
    method: 'GET',
    url: '/knowledge/items/item-1/snapshots',
  });
  assert.equal(deniedRoleResponse.statusCode, 403);
  assert.equal(deniedRoleResponse.json().error?.code, 'forbidden');
  assert.equal(calls, 0);
});

test('non-header actors use the stable canonical account id and all documented roles are accepted', async (t) => {
  for (const role of ['admin', 'mgmt', 'exec', 'user']) {
    let captured;
    const app = await buildServer(
      serviceStub({
        list: async (input) => {
          captured = input;
          return { ok: true, value: { items: [] } };
        },
      }),
      {
        userId: 'raw-provider-subject',
        roles: [role],
        auth: {
          principalUserId: 'raw-provider-subject',
          actorUserId: 'raw-provider-subject',
          scopes: ['knowledge:read'],
          delegated: false,
          providerType: 'google_oidc',
          userAccountId: 'stable-account-1',
          identityId: 'identity-1',
        },
      },
    );
    t.after(() => app.close());

    const response = await app.inject({
      method: 'GET',
      url: '/knowledge/items/item-1/snapshots',
    });
    assert.equal(response.statusCode, 200, `${role}: ${response.body}`);
    assert.equal(captured.actor.userId, 'stable-account-1');
  }
});

test('request validation rejects unknown status fields before the capture service', async (t) => {
  let captureCalls = 0;
  const app = await buildServer(
    serviceStub({
      capture: async () => {
        captureCalls += 1;
        return { ok: true, value: { replayed: false, snapshot: snapshot() } };
      },
    }),
  );
  t.after(() => app.close());

  const invalid = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/snapshots',
    payload: {
      captureMethod: 'text',
      requestKey: 'request-1',
      text: 'not captured',
      status: 'ready',
    },
  });
  assert.equal(invalid.statusCode, 400, invalid.body);
  assert.equal(captureCalls, 0);
});

test('request validation rejects unknown fields before the reconcile service', async (t) => {
  let reconcileCalls = 0;
  const app = await buildServer(
    serviceStub({
      reconcile: async () => {
        reconcileCalls += 1;
        return { ok: true, value: snapshot() };
      },
    }),
  );
  t.after(() => app.close());

  const invalid = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/snapshots/snapshot-1/reconcile',
    payload: {
      requestKey: 'request-1',
      artifactId: 'must-not-be-accepted',
    },
  });
  assert.equal(invalid.statusCode, 400, invalid.body);
  assert.equal(reconcileCalls, 0);
});

test('application failures preserve conflict and not-found HTTP status contracts', async (t) => {
  const app = await buildServer(
    serviceStub({
      capture: async () => ({
        ok: false,
        statusCode: 409,
        code: 'snapshot_state_conflict',
        message: 'Snapshot state conflict',
      }),
      detail: async () => ({
        ok: false,
        statusCode: 404,
        code: 'not_found',
        message: 'Not found',
      }),
    }),
  );
  t.after(() => app.close());

  const conflict = await app.inject({
    method: 'POST',
    url: '/knowledge/items/item-1/snapshots',
    payload: {
      captureMethod: 'text',
      requestKey: 'request-1',
      text: 'captured once',
    },
  });
  assert.equal(conflict.statusCode, 409, conflict.body);
  assert.deepEqual(conflict.json(), {
    error: {
      code: 'snapshot_state_conflict',
      message: 'Snapshot state conflict',
      category: 'conflict',
    },
  });

  const missing = await app.inject({
    method: 'GET',
    url: '/knowledge/items/item-1/snapshots/missing',
  });
  assert.equal(missing.statusCode, 404, missing.body);
  assert.equal(missing.json().error?.category, 'not_found');
});

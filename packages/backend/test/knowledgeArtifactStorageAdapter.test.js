import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import {
  createKnowledgeArtifactPort,
  resolveKnowledgeSnapshotProvider,
} from '../dist/adapters/knowledge/knowledgeArtifactStorageAdapter.js';
import { createArtifactStorageAdapter } from '../dist/adapters/storage/artifactStorageAdapter.js';
import {
  KnowledgeArtifactOpenError,
  KnowledgeArtifactStoreError,
} from '../dist/application/knowledge/knowledgeArtifactPort.js';
import { knowledgeSnapshotLimits } from '../dist/application/knowledge/knowledgeSnapshotPorts.js';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function rejectedError(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  assert.fail('expected operation to reject');
}

function storedArtifact(body, overrides = {}) {
  return {
    artifactId: 'artifact-placeholder',
    contentType: 'text/plain',
    createdAt: '2026-08-05T00:00:00.000Z',
    originalName: 'snapshot.txt',
    provider: 'local',
    sha256: sha256(body),
    sizeBytes: body.length,
    ...overrides,
  };
}

function storeInput(body = Buffer.from('knowledge snapshot')) {
  return {
    body,
    contentType: 'text/plain',
    createdBy: 'actor-sensitive-placeholder',
    idempotencyNamespace: sha256('request-sensitive-placeholder'),
    originalName: 'snapshot-sensitive-placeholder.txt',
    sha256: sha256(body),
    sizeBytes: body.length,
    snapshotId: 'snapshot-sensitive-placeholder',
  };
}

function createDb(findFirst) {
  return {
    storageArtifact: {
      findFirst: findFirst ?? (async () => null),
    },
  };
}

async function createScratchDir() {
  const scratchRoot = path.resolve(
    process.cwd(),
    '../..',
    '.codex-local',
    'tmp',
  );
  await mkdir(scratchRoot, { recursive: true });
  return mkdtemp(path.join(scratchRoot, 'erp4-knowledge-artifact-'));
}

test('store fixes the knowledge owner scope and uses only an opaque idempotency namespace', async () => {
  const body = Buffer.from('knowledge snapshot');
  const input = storeInput(body);
  const artifact = storedArtifact(body);
  const calls = { open: [], store: [] };
  const shared = {
    store: async (value) => {
      calls.store.push(value);
      return artifact;
    },
    open: async (...args) => {
      calls.open.push(args);
      return { artifact, stream: Readable.from(body) };
    },
  };
  const adapter = createKnowledgeArtifactPort({
    db: createDb(),
    provider: 'local',
    shared,
  });

  const result = await adapter.store(input);

  assert.deepEqual(result, artifact);
  assert.equal(calls.store.length, 1);
  assert.equal(calls.store[0].ownerType, 'knowledge_snapshot');
  assert.equal(calls.store[0].ownerId, input.snapshotId);
  assert.equal(
    calls.store[0].idempotencyKey,
    `knowledge:v1:${input.idempotencyNamespace}`,
  );
  assert.equal(calls.store[0].storageName, `${input.sha256}.txt`);
  assert.equal(calls.store[0].body, body);
  assert.deepEqual(calls.open, [
    [
      artifact.artifactId,
      { ownerId: input.snapshotId, ownerType: 'knowledge_snapshot' },
    ],
  ]);
  assert.doesNotMatch(calls.store[0].idempotencyKey, /request-sensitive/);
  assert.doesNotMatch(calls.store[0].idempotencyKey, /snapshot-sensitive/);
  assert.doesNotMatch(calls.store[0].storageName, /snapshot-sensitive/);
  assert.doesNotMatch(calls.store[0].storageName, /actor-sensitive/);
});

test('store rejects a non-opaque idempotency namespace before calling shared storage', async () => {
  let storeCalls = 0;
  const sensitiveNamespace = 'raw-request-secret-placeholder';
  const adapter = createKnowledgeArtifactPort({
    db: createDb(),
    provider: 'local',
    shared: {
      store: async () => {
        storeCalls += 1;
        assert.fail('shared store must not be called');
      },
      open: async () => assert.fail('shared open must not be called'),
    },
  });

  const error = await rejectedError(() =>
    adapter.store({
      ...storeInput(),
      idempotencyNamespace: sensitiveNamespace,
    }),
  );

  assert.equal(error instanceof KnowledgeArtifactStoreError, true);
  assert.equal(error.outcome, 'failed');
  assert.equal(error.message, 'knowledge_artifact_store_failed');
  assert.doesNotMatch(String(error), new RegExp(sensitiveNamespace));
  assert.equal(storeCalls, 0);
});

test('store validates input bytes, size, and hash before the external write', async (t) => {
  const body = Buffer.from('knowledge snapshot');
  for (const [name, override] of [
    ['size', { sizeBytes: body.length + 1 }],
    ['hash', { sha256: sha256('different content') }],
  ]) {
    await t.test(name, async () => {
      let storeCalls = 0;
      const adapter = createKnowledgeArtifactPort({
        db: createDb(),
        provider: 'local',
        shared: {
          store: async () => {
            storeCalls += 1;
            assert.fail('invalid input must not reach shared storage');
          },
          open: async () => assert.fail('shared open must not be called'),
        },
      });

      const error = await rejectedError(() =>
        adapter.store({ ...storeInput(body), ...override }),
      );
      assert.equal(error instanceof KnowledgeArtifactStoreError, true);
      assert.equal(error.outcome, 'failed');
      assert.equal(storeCalls, 0);
    });
  }
});

test('store rejects hash or size metadata that differs from the capture intent', async (t) => {
  const body = Buffer.from('knowledge snapshot');
  const input = storeInput(body);
  for (const [name, override] of [
    ['hash', { sha256: sha256('different content') }],
    ['size', { sizeBytes: body.length + 1 }],
  ]) {
    await t.test(name, async () => {
      let openCalls = 0;
      const adapter = createKnowledgeArtifactPort({
        db: createDb(),
        provider: 'local',
        shared: {
          store: async () => storedArtifact(body, override),
          open: async () => {
            openCalls += 1;
            assert.fail('a mismatched stored artifact must not be opened');
          },
        },
      });

      const error = await rejectedError(() => adapter.store(input));
      assert.equal(error instanceof KnowledgeArtifactStoreError, true);
      assert.equal(error.outcome, 'unknown');
      assert.equal(openCalls, 0);
    });
  }
});

test('store rejects a post-write read that is self-consistent but differs from the capture intent', async () => {
  const body = Buffer.from('knowledge snapshot');
  const input = storeInput(body);
  const stored = storedArtifact(body);
  const substitutedBody = Buffer.from('substituted artifact');
  const substituted = storedArtifact(substitutedBody, {
    artifactId: stored.artifactId,
  });
  const adapter = createKnowledgeArtifactPort({
    db: createDb(),
    provider: 'local',
    shared: {
      store: async () => stored,
      open: async () => ({
        artifact: substituted,
        stream: Readable.from(substitutedBody),
      }),
    },
  });

  const error = await rejectedError(() => adapter.store(input));
  assert.equal(error instanceof KnowledgeArtifactStoreError, true);
  assert.equal(error.outcome, 'unknown');
});

test('store distinguishes deterministic pre-write failure from an unknown provider result', async (t) => {
  for (const [name, sharedError, expectedOutcome] of [
    [
      'unsafe local directory',
      new Error('artifact_local_directory_unsafe'),
      'failed',
    ],
    ['ambiguous provider response', new Error('provider_timeout'), 'unknown'],
  ]) {
    await t.test(name, async () => {
      const adapter = createKnowledgeArtifactPort({
        provider: 'local',
        shared: {
          store: async () => {
            throw sharedError;
          },
          open: async () => assert.fail('failed storage must not be opened'),
        },
      });
      const error = await rejectedError(() => adapter.store(storeInput()));
      assert.equal(error instanceof KnowledgeArtifactStoreError, true);
      assert.equal(error.outcome, expectedOutcome);
    });
  }
});

test('open fixes owner scope and verifies the returned stream hash and size', async (t) => {
  const body = Buffer.from('knowledge snapshot');
  const artifact = storedArtifact(body);
  const scopes = [];
  const adapter = createKnowledgeArtifactPort({
    db: createDb(),
    provider: 'local',
    shared: {
      store: async () => assert.fail('shared store must not be called'),
      open: async (artifactId, scope) => {
        scopes.push([artifactId, scope]);
        return { artifact, stream: Readable.from(body) };
      },
    },
  });

  const opened = await adapter.open({
    artifactId: artifact.artifactId,
    snapshotId: 'snapshot-placeholder',
  });
  assert.deepEqual(await readAll(opened.stream), body);
  assert.deepEqual(scopes, [
    [
      artifact.artifactId,
      { ownerId: 'snapshot-placeholder', ownerType: 'knowledge_snapshot' },
    ],
  ]);

  for (const [name, corruptBody] of [
    ['hash', Buffer.from('knowledge snapshpt')],
    ['size', Buffer.from('knowledge snapshot-longer')],
  ]) {
    await t.test(name, async () => {
      const corruptAdapter = createKnowledgeArtifactPort({
        db: createDb(),
        provider: 'local',
        shared: {
          store: async () => assert.fail('shared store must not be called'),
          open: async () => ({
            artifact,
            stream: Readable.from(corruptBody),
          }),
        },
      });
      const corrupt = await corruptAdapter.open({
        artifactId: artifact.artifactId,
        snapshotId: 'snapshot-placeholder',
      });
      await assert.rejects(() => readAll(corrupt.stream), {
        message: 'knowledge_artifact_open_failed',
      });
    });
  }
});

test('open preserves lazy streaming and destroys the provider stream when consumption ends', async () => {
  const body = Buffer.from('knowledge snapshot');
  const artifact = storedArtifact(body);
  let reads = 0;
  const source = new Readable({
    read() {
      reads += 1;
      this.push(body);
      this.push(null);
    },
  });
  const adapter = createKnowledgeArtifactPort({
    provider: 'local',
    shared: {
      store: async () => assert.fail('shared store must not be called'),
      open: async () => ({ artifact, stream: source }),
    },
  });

  const opened = await adapter.open({
    artifactId: artifact.artifactId,
    snapshotId: 'snapshot-placeholder',
  });
  assert.equal(reads, 0);
  assert.deepEqual(await readAll(opened.stream), body);
  assert.equal(reads > 0, true);
  assert.equal(source.destroyed, true);
});

test('open and reconcile destroy provider streams when opened metadata is invalid', async (t) => {
  const body = Buffer.from('knowledge snapshot');
  const input = storeInput(body);
  const recovered = storedArtifact(body);

  for (const [operation, invoke] of [
    [
      'open',
      (adapter) =>
        adapter.open({
          artifactId: recovered.artifactId,
          snapshotId: input.snapshotId,
        }),
    ],
    ['reconcile', (adapter) => adapter.reconcile(input)],
  ]) {
    for (const [metadata, override] of [
      [
        'oversized metadata',
        { sizeBytes: knowledgeSnapshotLimits.maxBytes + 1 },
      ],
      ['invalid hash metadata', { sha256: 'not-a-sha256' }],
    ]) {
      await t.test(`${operation}: ${metadata}`, async () => {
        const source = new Readable({
          read() {
            assert.fail('invalid metadata must be rejected before reading');
          },
        });
        const openedArtifact = storedArtifact(body, override);
        const adapter = createKnowledgeArtifactPort({
          provider: 'local',
          shared: {
            store: async () =>
              assert.fail('metadata validation must not create an artifact'),
            recover: async () => recovered,
            open: async () => ({ artifact: openedArtifact, stream: source }),
          },
        });

        const error = await rejectedError(() => invoke(adapter));

        assert.equal(error instanceof KnowledgeArtifactOpenError, true);
        assert.equal(error.kind, 'storage_failure');
        assert.equal(source.destroyed, true);
      });
    }
  }
});

test('open separates owner-scoped not-found from provider or verification failure', async (t) => {
  for (const [name, sharedError, expectedKind] of [
    ['owner scoped absence', new Error('artifact_not_found'), 'not_found'],
    ['provider failure', new Error('provider_timeout'), 'storage_failure'],
  ]) {
    await t.test(name, async () => {
      const adapter = createKnowledgeArtifactPort({
        provider: 'local',
        shared: {
          store: async () => assert.fail('shared store must not be called'),
          open: async () => {
            throw sharedError;
          },
        },
      });
      const error = await rejectedError(() =>
        adapter.open({
          artifactId: 'artifact-placeholder',
          snapshotId: 'snapshot-placeholder',
        }),
      );
      assert.equal(error instanceof KnowledgeArtifactOpenError, true);
      assert.equal(error.kind, expectedKind);
    });
  }
});

test('open maps a missing local file for an owner-matched ready row to storage failure', async () => {
  const localDir = await createScratchDir();
  const body = Buffer.from('knowledge snapshot');
  const artifactId = randomUUID();
  const snapshotId = 'snapshot-placeholder';
  const row = {
    id: artifactId,
    context: 'knowledge',
    provider: 'local',
    providerKey: randomUUID(),
    status: 'ready',
    deletedAt: null,
    ownerType: 'knowledge_snapshot',
    ownerId: snapshotId,
    contentType: 'text/plain',
    originalName: 'snapshot.txt',
    sizeBytes: BigInt(body.length),
    sha256: sha256(body),
    createdAt: new Date('2026-08-05T00:00:00.000Z'),
  };
  const db = {
    storageArtifact: {
      findFirst: async ({ where }) =>
        where.id === row.id &&
        where.context === row.context &&
        where.status === row.status &&
        where.deletedAt === row.deletedAt &&
        where.ownerType === row.ownerType &&
        where.ownerId === row.ownerId
          ? row
          : null,
    },
  };
  const shared = createArtifactStorageAdapter({
    context: 'knowledge',
    db,
    env: {},
    folderEnvKey: 'KNOWLEDGE_SNAPSHOT_GDRIVE_FOLDER_ID',
    localDir,
    provider: 'local',
  });
  const adapter = createKnowledgeArtifactPort({
    provider: 'local',
    shared,
  });

  try {
    const error = await rejectedError(() =>
      adapter.open({ artifactId, snapshotId }),
    );
    assert.equal(error instanceof KnowledgeArtifactOpenError, true);
    assert.equal(error.kind, 'storage_failure');
    assert.equal(error.message, 'knowledge_artifact_open_failed');
  } finally {
    await rm(localDir, { recursive: true, force: true });
  }
});

test('reconcile uses read-only shared recovery with fixed owner scope and never creates one', async () => {
  const body = Buffer.from('knowledge snapshot');
  const input = storeInput(body);
  const artifact = storedArtifact(body);
  const calls = { recover: [], open: [], store: 0 };
  const adapter = createKnowledgeArtifactPort({
    provider: 'local',
    shared: {
      store: async () => {
        calls.store += 1;
        assert.fail('reconciliation must not create an artifact');
      },
      recover: async (value) => {
        calls.recover.push(value);
        return artifact;
      },
      open: async (...args) => {
        calls.open.push(args);
        return { artifact, stream: Readable.from(body) };
      },
    },
  });

  const result = await adapter.reconcile(input);

  assert.deepEqual(result, artifact);
  assert.equal(calls.store, 0);
  assert.deepEqual(calls.recover, [
    {
      contentType: input.contentType,
      idempotencyKey: `knowledge:v1:${input.idempotencyNamespace}`,
      originalName: input.originalName,
      ownerType: 'knowledge_snapshot',
      ownerId: input.snapshotId,
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
      storageName: `${input.sha256}.txt`,
    },
  ]);
  assert.deepEqual(calls.open, [
    [
      artifact.artifactId,
      { ownerId: input.snapshotId, ownerType: 'knowledge_snapshot' },
    ],
  ]);
});

test('reconcile returns null without opening or creating when no materialized provider object exists', async () => {
  const input = storeInput();
  let openCalls = 0;
  let storeCalls = 0;
  const adapter = createKnowledgeArtifactPort({
    provider: 'local',
    shared: {
      store: async () => {
        storeCalls += 1;
        assert.fail('reconciliation must not create an artifact');
      },
      recover: async () => null,
      open: async () => {
        openCalls += 1;
        assert.fail('an absent artifact must not be opened');
      },
    },
  });

  assert.equal(await adapter.reconcile(input), null);
  assert.equal(openCalls, 0);
  assert.equal(storeCalls, 0);
});

test('reconcile normalizes recovery and open failures without exposing provider details', async (t) => {
  const input = storeInput();
  const sensitiveDetail = 'provider credential secret';
  for (const [name, recover, open, expectedKind] of [
    [
      'recovery failure',
      async () => {
        throw new Error(sensitiveDetail);
      },
      async () => assert.fail('failed recovery must not be opened'),
      'storage_failure',
    ],
    [
      'owner-scoped open absence',
      async () => storedArtifact(input.body),
      async () => {
        throw new Error('artifact_not_found');
      },
      'not_found',
    ],
  ]) {
    await t.test(name, async () => {
      const adapter = createKnowledgeArtifactPort({
        provider: 'local',
        shared: {
          store: async () =>
            assert.fail('reconciliation must not create an artifact'),
          recover,
          open,
        },
      });

      const error = await rejectedError(() => adapter.reconcile(input));

      assert.equal(error instanceof KnowledgeArtifactOpenError, true);
      assert.equal(error.kind, expectedKind);
      assert.doesNotMatch(String(error), new RegExp(sensitiveDetail));
    });
  }
});

test('reconcile rejects corrupt content and metadata that differs from the recorded intent', async (t) => {
  const body = Buffer.from('knowledge snapshot');
  const input = storeInput(body);
  const expected = storedArtifact(body);
  for (const [name, artifact, openedBody] of [
    ['corrupt stream', expected, Buffer.from('knowledge snapshpt')],
    [
      'different hash',
      storedArtifact(Buffer.from('different content'), {
        artifactId: expected.artifactId,
      }),
      Buffer.from('different content'),
    ],
    [
      'different size',
      storedArtifact(Buffer.from('knowledge snapshot-longer'), {
        artifactId: expected.artifactId,
      }),
      Buffer.from('knowledge snapshot-longer'),
    ],
  ]) {
    await t.test(name, async () => {
      let storeCalls = 0;
      const adapter = createKnowledgeArtifactPort({
        provider: 'local',
        shared: {
          store: async () => {
            storeCalls += 1;
            assert.fail('reconciliation must not create an artifact');
          },
          recover: async () => artifact,
          open: async () => ({ artifact, stream: Readable.from(openedBody) }),
        },
      });

      await assert.rejects(() => adapter.reconcile(input), {
        message: 'knowledge_artifact_open_failed',
      });
      assert.equal(storeCalls, 0);
    });
  }
});

test('provider resolution defaults safely and rejects invalid values without exposing them', () => {
  assert.equal(resolveKnowledgeSnapshotProvider({}), 'local');
  assert.equal(
    resolveKnowledgeSnapshotProvider({
      KNOWLEDGE_SNAPSHOT_PROVIDER: ' GDRIVE ',
    }),
    'gdrive',
  );

  const sensitiveProvider = 'provider-secret-placeholder';
  assert.throws(
    () =>
      resolveKnowledgeSnapshotProvider({
        KNOWLEDGE_SNAPSHOT_PROVIDER: sensitiveProvider,
      }),
    (error) => {
      assert.equal(error.message, 'knowledge_snapshot_provider_invalid');
      assert.doesNotMatch(String(error), new RegExp(sensitiveProvider));
      return true;
    },
  );
});

test('verification failures do not expose owner, filename, actor, or body values', async () => {
  const body = Buffer.from('body-secret-placeholder');
  const input = storeInput(body);
  const adapter = createKnowledgeArtifactPort({
    db: createDb(),
    provider: 'local',
    shared: {
      store: async () => storedArtifact(body, { sizeBytes: body.length + 1 }),
      open: async () => assert.fail('shared open must not be called'),
    },
  });

  const error = await rejectedError(() => adapter.store(input));
  const rendered = String(error);
  assert.equal(error instanceof KnowledgeArtifactStoreError, true);
  assert.equal(error.message, 'knowledge_artifact_store_failed');
  for (const sensitiveValue of [
    body.toString(),
    input.createdBy,
    input.originalName,
    input.snapshotId,
  ]) {
    assert.doesNotMatch(rendered, new RegExp(sensitiveValue));
  }
});

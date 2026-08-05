import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PrismaKnowledgeSnapshotAuditWriter,
  PrismaKnowledgeSnapshotRepository,
  PrismaKnowledgeSnapshotUnitOfWork,
} from '../dist/adapters/knowledge/prismaKnowledgeSnapshotAdapter.js';

const actor = {
  userId: 'owner-1',
  organizationId: 'org-1',
  groupAccountIds: ['group-2', 'group-1', 'group-1', ''],
};

function snapshotRow(overrides = {}) {
  return {
    id: 'snapshot-1',
    knowledgeItemId: 'item-1',
    artifactId: null,
    version: 1,
    status: 'pending',
    captureMethod: 'text',
    sourceUrl: null,
    originalName: 'snapshot.txt',
    contentType: null,
    sizeBytes: null,
    sha256: null,
    extractedText: null,
    requestKeyHash: 'request-hash',
    requestPayloadHash: 'payload-hash',
    failureCode: null,
    capturedAt: new Date('2026-08-05T00:00:00.000Z'),
    capturedBy: 'owner-1',
    readyAt: null,
    failedAt: null,
    createdAt: new Date('2026-08-05T00:00:01.000Z'),
    updatedAt: new Date('2026-08-05T00:00:01.000Z'),
    ...overrides,
  };
}

test('visible reads embed current item visibility and owner mutations use owner plus active-item predicates', async () => {
  const calls = [];
  let visible = true;
  const repository = new PrismaKnowledgeSnapshotRepository({
    knowledgeItem: {
      findFirst: async (args) => {
        calls.push(['itemFindFirst', args]);
        if (!visible) return null;
        return args.select?.snapshots
          ? { snapshots: [snapshotRow()] }
          : { id: 'item-1', ownerUserId: 'owner-1' };
      },
    },
    knowledgeSnapshot: {
      findFirst: async (args) => {
        calls.push(['snapshotFindFirst', args]);
        return snapshotRow();
      },
    },
    auditLog: {},
  });

  assert.equal(
    (
      await repository.findVisibleById({
        actor,
        itemId: 'item-1',
        snapshotId: 'snapshot-1',
      })
    ).id,
    'snapshot-1',
  );
  const visibleWhere = calls[0][1].where;
  assert.equal(visibleWhere.id, 'snapshot-1');
  assert.equal(visibleWhere.knowledgeItemId, 'item-1');
  assert.deepEqual(visibleWhere.knowledgeItem.is, {
    deletedAt: null,
    OR: [
      { ownerUserId: 'owner-1' },
      {
        scope: 'organization',
        organizationId: 'org-1',
        groupGrants: {
          some: {
            groupAccountId: { in: ['group-2', 'group-1'] },
            groupAccount: { active: true },
          },
        },
      },
    ],
  });

  const listed = await repository.listVisible({
    actor,
    itemId: 'item-1',
    limit: 25,
  });
  assert.equal(listed.length, 1);
  assert.deepEqual(calls[1][1], {
    where: {
      AND: [{ id: 'item-1' }, visibleWhere.knowledgeItem.is],
    },
    select: {
      snapshots: {
        orderBy: [{ version: 'desc' }, { id: 'desc' }],
        take: 25,
      },
    },
  });

  assert.deepEqual(
    await repository.findOwnedItem({ actor, itemId: 'item-1' }),
    { id: 'item-1', ownerUserId: 'owner-1' },
  );
  assert.deepEqual(calls[2][1], {
    where: { id: 'item-1', ownerUserId: 'owner-1', deletedAt: null },
    select: { id: true, ownerUserId: true },
  });

  assert.equal(
    (
      await repository.findOwnedSnapshot({
        actor,
        itemId: 'item-1',
        snapshotId: 'snapshot-1',
      })
    ).id,
    'snapshot-1',
  );
  assert.deepEqual(calls[3][1].where, {
    id: 'snapshot-1',
    knowledgeItemId: 'item-1',
    knowledgeItem: {
      is: { ownerUserId: 'owner-1', deletedAt: null },
    },
  });

  visible = false;
  const callCount = calls.length;
  assert.equal(
    await repository.listVisible({ actor, itemId: 'item-1', limit: 10 }),
    null,
  );
  assert.equal(calls.length, callCount + 1);
  assert.equal(calls.at(-1)[0], 'itemFindFirst');
});

test('idempotency lookup uses the compound item/request key and create preserves intent fields', async () => {
  const calls = [];
  const repository = new PrismaKnowledgeSnapshotRepository({
    knowledgeItem: {},
    knowledgeSnapshot: {
      findUnique: async (args) => {
        calls.push(['findUnique', args]);
        return snapshotRow({ sizeBytes: 42n });
      },
      create: async (args) => {
        calls.push(['create', args]);
        return snapshotRow(args.data);
      },
    },
    auditLog: {},
  });

  const replay = await repository.findByRequestKey({
    itemId: 'item-1',
    requestKeyHash: 'request-hash',
  });
  assert.equal(replay.sizeBytes, 42);
  assert.deepEqual(calls[0][1], {
    where: {
      knowledgeItemId_requestKeyHash: {
        knowledgeItemId: 'item-1',
        requestKeyHash: 'request-hash',
      },
    },
  });

  const intent = {
    id: 'snapshot-1',
    knowledgeItemId: 'item-1',
    version: 1,
    captureMethod: 'text',
    sourceUrl: null,
    originalName: 'snapshot.txt',
    requestKeyHash: 'request-hash',
    requestPayloadHash: 'payload-hash',
    capturedAt: new Date('2026-08-05T00:00:00.000Z'),
    capturedBy: 'owner-1',
  };
  const created = await repository.createIntent(intent);
  assert.equal(created.requestKeyHash, 'request-hash');
  assert.deepEqual(calls[1][1], { data: intent });
});

test('nextVersion starts at one, increments the maximum, and rejects invalid or exhausted versions', async () => {
  const maxima = [null, 6, 2_147_483_647, 1.5];
  const repository = new PrismaKnowledgeSnapshotRepository({
    knowledgeItem: {},
    knowledgeSnapshot: {
      aggregate: async (args) => {
        assert.deepEqual(args, {
          where: { knowledgeItemId: 'item-1' },
          _max: { version: true },
        });
        return { _max: { version: maxima.shift() } };
      },
    },
    auditLog: {},
  });

  assert.equal(await repository.nextVersion('item-1'), 1);
  assert.equal(await repository.nextVersion('item-1'), 7);
  await assert.rejects(
    () => repository.nextVersion('item-1'),
    /knowledge_snapshot_version_exhausted/,
  );
  await assert.rejects(
    () => repository.nextVersion('item-1'),
    /knowledge_snapshot_version_exhausted/,
  );
});

test('materialized and ready transitions use pending-state CAS with matching content identity', async () => {
  const calls = [];
  const rows = [
    snapshotRow({
      contentType: 'text/plain',
      extractedText: 'captured',
      sha256: 'a'.repeat(64),
      sizeBytes: 8n,
    }),
    snapshotRow({
      artifactId: 'artifact-1',
      status: 'ready',
      contentType: 'text/plain',
      extractedText: 'captured',
      sha256: 'a'.repeat(64),
      sizeBytes: 8n,
      readyAt: new Date('2026-08-05T00:01:00.000Z'),
    }),
  ];
  const repository = new PrismaKnowledgeSnapshotRepository({
    knowledgeItem: {},
    knowledgeSnapshot: {
      updateMany: async (args) => {
        calls.push(['updateMany', args]);
        return { count: 1 };
      },
      findUnique: async (args) => {
        calls.push(['findUnique', args]);
        return rows.shift();
      },
    },
    auditLog: {},
  });

  const materialized = await repository.recordMaterialized({
    snapshotId: 'snapshot-1',
    contentType: 'text/plain',
    extractedText: 'captured',
    sha256: 'a'.repeat(64),
    sizeBytes: 8,
  });
  assert.equal(materialized.sizeBytes, 8);
  assert.deepEqual(calls[0][1], {
    where: {
      id: 'snapshot-1',
      status: 'pending',
      artifactId: null,
      sha256: null,
      sizeBytes: null,
    },
    data: {
      contentType: 'text/plain',
      extractedText: 'captured',
      sha256: 'a'.repeat(64),
      sizeBytes: 8n,
    },
  });

  const readyAt = new Date('2026-08-05T00:01:00.000Z');
  const ready = await repository.markReady({
    snapshotId: 'snapshot-1',
    artifactId: 'artifact-1',
    contentType: 'text/plain',
    readyAt,
    sha256: 'a'.repeat(64),
    sizeBytes: 8,
  });
  assert.equal(ready.status, 'ready');
  assert.deepEqual(calls[2][1], {
    where: {
      id: 'snapshot-1',
      status: 'pending',
      artifactId: null,
      contentType: 'text/plain',
      sha256: 'a'.repeat(64),
      sizeBytes: 8n,
    },
    data: {
      artifactId: 'artifact-1',
      status: 'ready',
      failureCode: null,
      readyAt,
      failedAt: null,
    },
  });
});

test('all state transitions return null without a follow-up read when their CAS loses', async () => {
  let readCount = 0;
  const repository = new PrismaKnowledgeSnapshotRepository({
    knowledgeItem: {},
    knowledgeSnapshot: {
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => {
        readCount += 1;
        return snapshotRow();
      },
    },
    auditLog: {},
  });

  assert.equal(
    await repository.recordMaterialized({
      snapshotId: 'snapshot-1',
      contentType: 'text/plain',
      extractedText: null,
      sha256: 'a'.repeat(64),
      sizeBytes: 8,
    }),
    null,
  );
  assert.equal(
    await repository.markReady({
      snapshotId: 'snapshot-1',
      artifactId: 'artifact-1',
      contentType: 'text/plain',
      readyAt: new Date(),
      sha256: 'a'.repeat(64),
      sizeBytes: 8,
    }),
    null,
  );
  assert.equal(
    await repository.markFailed({
      snapshotId: 'snapshot-1',
      failedAt: new Date(),
      failureCode: 'capture_failed',
    }),
    null,
  );
  assert.equal(readCount, 0);
});

test('failed transition is a pending/no-artifact CAS and persists only the failure state', async () => {
  let updateArgs;
  let findArgs;
  const failedAt = new Date('2026-08-05T00:02:00.000Z');
  const repository = new PrismaKnowledgeSnapshotRepository({
    knowledgeItem: {},
    knowledgeSnapshot: {
      updateMany: async (args) => {
        updateArgs = args;
        return { count: 1 };
      },
      findUnique: async (args) => {
        findArgs = args;
        return snapshotRow({
          status: 'failed',
          failureCode: 'capture_failed',
          failedAt,
        });
      },
    },
    auditLog: {},
  });

  const failed = await repository.markFailed({
    snapshotId: 'snapshot-1',
    failedAt,
    failureCode: 'capture_failed',
  });
  assert.equal(failed.status, 'failed');
  assert.deepEqual(updateArgs, {
    where: { id: 'snapshot-1', status: 'pending', artifactId: null },
    data: {
      status: 'failed',
      failureCode: 'capture_failed',
      failedAt,
      readyAt: null,
    },
  });
  assert.deepEqual(findArgs, { where: { id: 'snapshot-1' } });
});

test('snapshot mapping converts safe BigInt sizes and rejects negative or unsafe persisted sizes', async () => {
  const rows = [
    snapshotRow({ sizeBytes: 10_485_760n }),
    snapshotRow({ sizeBytes: null }),
    snapshotRow({ sizeBytes: -1n }),
    snapshotRow({ sizeBytes: 9_007_199_254_740_992n }),
  ];
  const repository = new PrismaKnowledgeSnapshotRepository({
    knowledgeItem: {},
    knowledgeSnapshot: {
      findUnique: async () => rows.shift(),
    },
    auditLog: {},
  });
  const input = { itemId: 'item-1', requestKeyHash: 'request-hash' };

  assert.equal(
    (await repository.findByRequestKey(input)).sizeBytes,
    10_485_760,
  );
  assert.equal((await repository.findByRequestKey(input)).sizeBytes, null);
  await assert.rejects(
    () => repository.findByRequestKey(input),
    /knowledge_snapshot_size_invalid/,
  );
  await assert.rejects(
    () => repository.findByRequestKey(input),
    /knowledge_snapshot_size_invalid/,
  );
});

test('audit writer persists only allowlisted bounded metadata and sanitized actor fields', async () => {
  const creates = [];
  const writer = new PrismaKnowledgeSnapshotAuditWriter({
    auditLog: {
      create: async (input) => {
        creates.push(input);
        return { id: `audit-${creates.length}` };
      },
    },
  });
  const secret = 'Bearer must-not-pass-through';
  await writer.write({
    action: 'knowledge_snapshot_capture_failed',
    actor: {
      userId: 'u'.repeat(300),
      requestId: '  request-1  ',
      source: 'api',
      userAgent: secret,
      ipAddress: secret,
      actorRole: secret,
      secret,
    },
    targetId: 'snapshot-1',
    metadata: {
      itemId: 'item-1',
      version: 2,
      status: 'failed',
      captureMethod: 'url',
      contentType: 'c'.repeat(120),
      sha256: 'a'.repeat(64),
      sizeBytes: 42,
      failureCode: 'f'.repeat(120),
      sourceUrl: secret,
      originalName: secret,
      requestKeyHash: secret,
    },
  });

  assert.deepEqual(creates[0].data.metadata, {
    itemId: 'item-1',
    version: 2,
    status: 'failed',
    captureMethod: 'url',
    contentType: 'c'.repeat(100),
    sha256: 'a'.repeat(64),
    sizeBytes: 42,
    failureCode: 'f'.repeat(100),
  });
  assert.equal(creates[0].data.userId, 'u'.repeat(255));
  assert.equal(creates[0].data.requestId, 'request-1');
  assert.equal(creates[0].data.source, 'api');
  assert.equal(creates[0].data.targetTable, 'knowledge_snapshots');
  assert.equal(JSON.stringify(creates[0]).includes(secret), false);

  await writer.write({
    action: 'knowledge_snapshot_downloaded',
    actor: { userId: 'owner-1', requestId: secret, source: secret },
    targetId: 'snapshot-1',
    metadata: {
      itemId: 'item-1',
      version: 2,
      status: 'ready',
      captureMethod: 'upload',
    },
  });
  assert.equal(creates[1].data.requestId, undefined);
  assert.equal(creates[1].data.source, undefined);
  assert.equal(JSON.stringify(creates[1]).includes(secret), false);
});

test('unit of work binds repository and audit to one Serializable transaction', async () => {
  const transactionClient = {
    knowledgeItem: {},
    knowledgeSnapshot: {
      findUnique: async () => snapshotRow(),
    },
    auditLog: {
      create: async () => ({ id: 'audit-1' }),
    },
  };
  let receivedOptions;
  const unitOfWork = new PrismaKnowledgeSnapshotUnitOfWork({
    $transaction: async (work, options) => {
      receivedOptions = options;
      return work(transactionClient);
    },
  });

  const result = await unitOfWork.run(async ({ snapshots, audit }) => {
    assert.equal(snapshots.client, transactionClient);
    assert.equal(audit.client, transactionClient);
    assert.equal(
      (
        await snapshots.findByRequestKey({
          itemId: 'item-1',
          requestKeyHash: 'request-hash',
        })
      ).id,
      'snapshot-1',
    );
    await audit.write({
      action: 'knowledge_snapshot_capture_requested',
      actor: { userId: 'owner-1' },
      targetId: 'snapshot-1',
      metadata: {
        itemId: 'item-1',
        version: 1,
        status: 'pending',
        captureMethod: 'text',
      },
    });
    return 'committed';
  });

  assert.equal(result, 'committed');
  assert.deepEqual(receivedOptions, { isolationLevel: 'Serializable' });
});

test('unit of work retries supported serialization, deadlock, and unique conflicts', async () => {
  const retryableErrors = [
    { code: 'P2034' },
    { code: 'P2002' },
    {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '40001' } } },
    },
    {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { code: '40P01' } } },
    },
  ];

  for (const retryableError of retryableErrors) {
    let attempts = 0;
    const clients = [{ attempt: 1 }, { attempt: 2 }];
    const workClients = [];
    const unitOfWork = new PrismaKnowledgeSnapshotUnitOfWork({
      $transaction: async (work, options) => {
        assert.deepEqual(options, { isolationLevel: 'Serializable' });
        const client = clients[attempts];
        attempts += 1;
        if (attempts === 1) {
          await work(client);
          throw retryableError;
        }
        return work(client);
      },
    });

    const result = await unitOfWork.run(async ({ snapshots }) => {
      workClients.push(snapshots.client);
      return `attempt-${workClients.length}`;
    });
    assert.equal(result, 'attempt-2');
    assert.equal(attempts, 2);
    assert.deepEqual(workClients, clients);
  }
});

test('unit of work bounds conflict retries and does not retry permanent failures', async () => {
  let attempts = 0;
  const conflicts = new PrismaKnowledgeSnapshotUnitOfWork({
    $transaction: async () => {
      attempts += 1;
      throw { code: 'P2034' };
    },
  });
  await assert.rejects(
    () => conflicts.run(async () => undefined),
    (error) => {
      assert.equal(error.message, 'knowledge_snapshot_transaction_conflict');
      assert.equal('code' in error, false);
      return true;
    },
  );
  assert.equal(attempts, 3);

  attempts = 0;
  const permanent = new PrismaKnowledgeSnapshotUnitOfWork({
    $transaction: async () => {
      attempts += 1;
      throw Object.assign(new Error('permanent'), { code: 'P2003' });
    },
  });
  await assert.rejects(() => permanent.run(async () => undefined), {
    message: 'permanent',
    code: 'P2003',
  });
  assert.equal(attempts, 1);
});

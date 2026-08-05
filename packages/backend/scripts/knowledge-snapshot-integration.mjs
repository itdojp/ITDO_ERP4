import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

function parseDatabaseUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL);
const repositoryRoot = process.env.KNOWLEDGE_SNAPSHOT_INTEGRATION_ROOT;
const storageDir = process.env.KNOWLEDGE_STORAGE_DIR;
if (
  process.env.KNOWLEDGE_SNAPSHOT_INTEGRATION_CONFIRM !== '1' ||
  !databaseUrl ||
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/erp4_knowledge_snapshot_test' ||
  !repositoryRoot ||
  !storageDir
) {
  throw new Error(
    'Refusing to run outside the confirmed loopback Knowledge snapshot test environment',
  );
}
const resolvedRoot = await realpath(repositoryRoot);
const resolvedStorage = await realpath(storageDir);
const allowedScratch = path.join(resolvedRoot, '.codex-local', 'tmp');
if (!resolvedStorage.startsWith(`${allowedScratch}${path.sep}`)) {
  throw new Error(
    'Refusing a Knowledge snapshot storage directory outside repository scratch',
  );
}

const [
  { prisma },
  itemAdapter,
  snapshotAdapter,
  { createKnowledgeItemService },
  { createKnowledgeSnapshotService },
  { createKnowledgeArtifactPort },
] = await Promise.all([
  import('../dist/services/db.js'),
  import('../dist/adapters/knowledge/prismaKnowledgeItemAdapter.js'),
  import('../dist/adapters/knowledge/prismaKnowledgeSnapshotAdapter.js'),
  import('../dist/application/knowledge/knowledgeItemUseCases.js'),
  import('../dist/application/knowledge/knowledgeSnapshotUseCases.js'),
  import('../dist/adapters/knowledge/knowledgeArtifactStorageAdapter.js'),
]);

const owner = { userId: 'snapshot-integration-owner', groupAccountIds: [] };
const outsider = {
  userId: 'snapshot-integration-outsider',
  groupAccountIds: [],
};
const auditActor = {
  requestId: 'knowledge-snapshot-integration',
  source: 'api',
};
const itemService = createKnowledgeItemService({
  reader: itemAdapter.prismaKnowledgeItemRepository,
  unitOfWork: itemAdapter.prismaKnowledgeUnitOfWork,
});
const snapshotService = createKnowledgeSnapshotService({
  artifacts: createKnowledgeArtifactPort({
    env: process.env,
    provider: 'local',
  }),
  reader: snapshotAdapter.prismaKnowledgeSnapshotRepository,
  unitOfWork: snapshotAdapter.prismaKnowledgeSnapshotUnitOfWork,
});

function expectOk(result, context) {
  assert.equal(result.ok, true, `${context}: ${JSON.stringify(result)}`);
  return result.value;
}

function expectFailure(result, code, context) {
  assert.equal(result.ok, false, context);
  assert.equal(result.code, code, context);
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

try {
  const item = expectOk(
    await itemService.create({
      actor: owner,
      auditActor,
      body: {
        scope: 'personal',
        sourceType: 'manual',
        title: 'Synthetic snapshot integration item',
      },
    }),
    'create item',
  );

  const text = Buffer.from('Synthetic immutable Knowledge snapshot', 'utf8');
  const first = expectOk(
    await snapshotService.capture({
      actor: owner,
      auditActor,
      itemId: item.id,
      requestKey: 'synthetic-text-request-v1',
      captureMethod: 'text',
      text: text.toString('utf8'),
      originalName: 'synthetic-note.txt',
    }),
    'capture text',
  );
  assert.equal(first.replayed, false);
  assert.equal(first.snapshot.status, 'ready');
  assert.equal(first.snapshot.version, 1);
  assert.equal(
    first.snapshot.sha256,
    createHash('sha256').update(text).digest('hex'),
  );

  const replay = expectOk(
    await snapshotService.capture({
      actor: owner,
      auditActor,
      itemId: item.id,
      requestKey: 'synthetic-text-request-v1',
      captureMethod: 'text',
      text: text.toString('utf8'),
      originalName: 'synthetic-note.txt',
    }),
    'replay text',
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.snapshot.id, first.snapshot.id);

  expectFailure(
    await snapshotService.capture({
      actor: owner,
      auditActor,
      itemId: item.id,
      requestKey: 'synthetic-text-request-v1',
      captureMethod: 'text',
      text: 'different payload',
      originalName: 'synthetic-note.txt',
    }),
    'idempotency_conflict',
    'changed idempotent payload',
  );

  const pdf = Buffer.from('%PDF-1.7\nsynthetic fixture', 'ascii');
  const second = expectOk(
    await snapshotService.capture({
      actor: owner,
      auditActor,
      itemId: item.id,
      requestKey: 'synthetic-pdf-request-v1',
      captureMethod: 'upload',
      upload: {
        body: pdf,
        contentType: 'application/pdf',
        originalName: 'synthetic.pdf',
      },
    }),
    'capture PDF',
  );
  assert.equal(second.snapshot.status, 'ready');
  assert.equal(second.snapshot.version, 2);

  const listed = expectOk(
    await snapshotService.list({ actor: owner, itemId: item.id, limit: 10 }),
    'list snapshots',
  );
  assert.deepEqual(
    listed.items.map((snapshot) => snapshot.version),
    [2, 1],
  );
  expectFailure(
    await snapshotService.detail({
      actor: outsider,
      itemId: item.id,
      snapshotId: first.snapshot.id,
    }),
    'not_found',
    'outsider detail',
  );
  expectFailure(
    await snapshotService.openDownload({
      actor: outsider,
      auditActor,
      itemId: item.id,
      snapshotId: first.snapshot.id,
    }),
    'not_found',
    'outsider download',
  );

  const download = expectOk(
    await snapshotService.openDownload({
      actor: owner,
      auditActor,
      itemId: item.id,
      snapshotId: first.snapshot.id,
    }),
    'owner download',
  );
  assert.deepEqual(await readAll(download.opened.stream), text);

  const rows = await prisma.knowledgeSnapshot.findMany({
    where: { knowledgeItemId: item.id },
    include: { artifact: true },
    orderBy: { version: 'asc' },
  });
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.status, 'ready');
    assert.equal(row.artifact?.context, 'knowledge');
    assert.equal(row.artifact?.provider, 'local');
    assert.equal(row.artifact?.ownerType, 'knowledge_snapshot');
    assert.equal(row.artifact?.ownerId, row.id);
    assert.equal(row.artifact?.sha256, row.sha256);
    assert.equal(row.artifact?.sizeBytes, row.sizeBytes);
    assert.match(row.requestKeyHash, /^[a-f0-9]{64}$/);
    assert.match(row.requestPayloadHash, /^[a-f0-9]{64}$/);
    assert.match(
      row.artifact?.idempotencyKey ?? '',
      /^knowledge:v1:[a-f0-9]{64}$/,
    );
    assert.doesNotMatch(
      row.artifact?.idempotencyKey ?? '',
      /synthetic-(?:text|pdf)-request/,
    );
  }

  const audits = await prisma.auditLog.findMany({
    where: {
      targetTable: 'knowledge_snapshots',
      action: { startsWith: 'knowledge_snapshot_' },
    },
  });
  assert.equal(audits.length, 5);
  assert.equal(
    audits.every(
      (entry) =>
        !JSON.stringify(entry.metadata).includes('synthetic-text-request-v1') &&
        !JSON.stringify(entry.metadata).includes(resolvedStorage),
    ),
    true,
  );

  console.log(
    JSON.stringify({
      result: 'PASS',
      snapshots: rows.length,
      artifacts: rows.filter((row) => row.artifact !== null).length,
      audits: audits.length,
      versions: rows.map((row) => row.version),
      outsiderDetail: 404,
      outsiderDownload: 404,
      ownerDownloadBytes: text.length,
    }),
  );
} finally {
  await prisma.$disconnect();
}

import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const baseline = process.env.KNOWLEDGE_PROVENANCE_OLD_APP_BASE_SHA;
const root = process.env.OLD_APP_ROOT;
const mode = process.env.KNOWLEDGE_PROVENANCE_OLD_APP_MODE;
const itemIdFile = process.env.PREEXISTING_ITEM_ID_FILE;

function parseDatabaseUrl(value) {
  try {
    return value ? new URL(value) : null;
  } catch {
    return null;
  }
}

const databaseUrl = parseDatabaseUrl(process.env.DATABASE_URL);
if (
  process.env.KNOWLEDGE_PROVENANCE_OLD_APP_CONFIRM !== '1' ||
  !baseline ||
  !root ||
  !itemIdFile ||
  !['seed', 'verify'].includes(mode) ||
  !databaseUrl ||
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/erp4_knowledge_provenance_old_app_test'
) {
  throw new Error(
    'Refusing to run outside the confirmed loopback Knowledge provenance old-app database',
  );
}

const load = (path) => import(pathToFileURL(`${root}/${path}`).href);
const [{ createKnowledgeItemService }, adapter, { buildServer }, { prisma }] =
  await Promise.all([
    load(
      'packages/backend/dist/application/knowledge/knowledgeItemUseCases.js',
    ),
    load(
      'packages/backend/dist/adapters/knowledge/prismaKnowledgeItemAdapter.js',
    ),
    load('packages/backend/dist/server.js'),
    load('packages/backend/dist/services/db.js'),
  ]);
const service = createKnowledgeItemService({
  reader: adapter.prismaKnowledgeItemRepository,
  unitOfWork: adapter.prismaKnowledgeUnitOfWork,
  now: () => new Date('2026-08-06T00:00:00.000Z'),
});
const actor = { userId: 'old-app-owner', groupAccountIds: [] };
const auditActor = { requestId: 'old-app-compat', source: 'api' };

try {
  if (mode === 'seed') {
    const created = await service.create({
      actor,
      auditActor,
      body: {
        scope: 'personal',
        sourceType: 'manual',
        title: 'Old application compatibility item',
      },
    });
    assert.equal(created.ok, true);
    await writeFile(itemIdFile, `${created.value.id}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ result: 'SEEDED', baseline }));
  } else {
    const itemId = (await readFile(itemIdFile, 'utf8')).trim();
    assert.ok(itemId);
    assert.equal((await service.detail({ actor, itemId })).ok, true);
    const updated = await service.update({
      actor,
      auditActor,
      itemId,
      body: { expectedVersion: 1, title: 'Old application updated item' },
    });
    assert.equal(updated.ok, true);
    const removed = await service.remove({
      actor,
      auditActor,
      itemId,
      expectedVersion: 2,
      reasonCode: 'owner_request',
    });
    assert.equal(removed.ok, true);
    const restored = await service.restore({
      actor,
      auditActor,
      itemId,
      expectedVersion: 3,
    });
    assert.equal(restored.ok, true);
    assert.equal(restored.value.version, 4);

    const app = await buildServer({ logger: false });
    try {
      const health = await app.inject({ method: 'GET', url: '/healthz' });
      const ready = await app.inject({ method: 'GET', url: '/readyz' });
      assert.equal(health.statusCode, 200, health.body);
      assert.equal(ready.statusCode, 200, ready.body);
    } finally {
      await app.close();
    }
    console.log(
      JSON.stringify({
        result: 'PASS',
        baseline,
        existingDataRetained: true,
        oldApplicationCrudFinalVersion: restored.value.version,
        healthz: 200,
        readyz: 200,
      }),
    );
  }
} finally {
  await prisma.$disconnect();
}

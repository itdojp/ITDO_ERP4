import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const baseline = '358cb9e4d13489b703cb71cfee4b2754d15aa53e';
const root = process.env.OLD_APP_ROOT;
const mode = process.env.KNOWLEDGE_OLD_APP_COMPAT_MODE;
const itemIdFile = process.env.PREEXISTING_ITEM_ID_FILE;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (
  process.env.KNOWLEDGE_OLD_APP_COMPAT_CONFIRM !== '1' ||
  !root ||
  !itemIdFile ||
  !['seed', 'verify'].includes(mode) ||
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/erp4_knowledge_label_old_app_test'
) {
  throw new Error(
    'Refusing to run outside the confirmed loopback old-app compatibility database',
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
  now: () => new Date('2026-08-05T00:00:00.000Z'),
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
        title: 'Old app compatibility item',
      },
    });
    assert.equal(created.ok, true);
    await writeFile(itemIdFile, `${created.value.id}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ result: 'SEEDED', baseline }));
  } else {
    const itemId = (await readFile(itemIdFile, 'utf8')).trim();
    assert.ok(itemId);
    const list = await service.list({ actor, query: { limit: 10, offset: 0 } });
    assert.ok(list.some((item) => item.id === itemId));
    assert.ok((await service.count({ actor })) >= 1);
    assert.equal((await service.detail({ actor, itemId })).ok, true);
    const updated = await service.update({
      actor,
      auditActor,
      itemId,
      body: { expectedVersion: 1, title: 'Old app updated item' },
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.value.version, 2);
    const removed = await service.remove({
      actor,
      auditActor,
      itemId,
      expectedVersion: 2,
      reasonCode: 'owner_request',
    });
    assert.equal(removed.ok, true);
    assert.equal(removed.value.version, 3);
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
        crudFinalVersion: restored.value.version,
        healthz: 200,
        readyz: 200,
      }),
    );
  }
} finally {
  await prisma.$disconnect();
}

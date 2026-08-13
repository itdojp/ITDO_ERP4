import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const mode = process.env.KNOWLEDGE_CAPTURE_OLD_APP_MODE;
const oldRoot = process.env.OLD_APP_ROOT;
const currentRoot = process.env.CURRENT_APP_ROOT;
if (!mode || !oldRoot || !currentRoot)
  throw new Error('old-app compatibility environment is incomplete');

async function db(root) {
  return import(
    pathToFileURL(`${root}/packages/backend/dist/services/db.js`).href
  );
}

const root = mode.startsWith('old-') ? oldRoot : currentRoot;
const { prisma } = await db(root);

try {
  if (mode === 'old-seed') {
    await prisma.knowledgeItem.create({
      data: {
        id: 'old-app-item-before',
        ownerUserId: 'old-app-owner',
        scope: 'personal',
        sourceType: 'manual',
        title: 'Synthetic old application row',
        createdBy: 'old-app-owner',
        updatedBy: 'old-app-owner',
      },
    });
  } else if (mode === 'current-create') {
    await prisma.$transaction(async (transaction) => {
      await transaction.knowledgeItem.create({
        data: {
          id: 'current-capture-item',
          ownerUserId: 'old-app-owner',
          scope: 'personal',
          sourceType: 'manual',
          title: 'Synthetic current capture row',
          createdBy: 'old-app-owner',
          updatedBy: 'old-app-owner',
        },
      });
      await transaction.knowledgeSnapshot.create({
        data: {
          id: 'current-capture-snapshot',
          knowledgeItemId: 'current-capture-item',
          version: 1,
          captureMethod: 'text',
          originalName: 'knowledge-capture.txt',
          requestKeyHash: 'a'.repeat(64),
          requestPayloadHash: 'b'.repeat(64),
          capturedBy: 'old-app-owner',
        },
      });
      await transaction.knowledgeCaptureRequest.create({
        data: {
          id: '11111111-2222-4333-8444-123456789012',
          ownerUserId: 'old-app-owner',
          requestKeyHash: 'c'.repeat(64),
          payloadHash: 'd'.repeat(64),
          channel: 'browser_extension',
          scope: 'personal',
          knowledgeItemId: 'current-capture-item',
          snapshotId: 'current-capture-snapshot',
          snapshotVersion: 1,
          selectedFieldCount: 1,
          payloadByteCount: 100,
        },
      });
    });
  } else if (mode === 'old-after') {
    const rows = await prisma.knowledgeItem.findMany({
      where: { ownerUserId: 'old-app-owner' },
      orderBy: { id: 'asc' },
    });
    assert.equal(
      rows.some((row) => row.id === 'old-app-item-before'),
      true,
    );
    assert.equal(
      rows.some((row) => row.id === 'current-capture-item'),
      true,
    );
    await prisma.knowledgeItem.create({
      data: {
        id: 'old-app-item-after',
        ownerUserId: 'old-app-owner',
        scope: 'personal',
        sourceType: 'manual',
        title: 'Synthetic old app post-migration row',
        createdBy: 'old-app-owner',
        updatedBy: 'old-app-owner',
      },
    });
  } else if (mode === 'current-after') {
    assert.equal(
      await prisma.knowledgeItem.count({
        where: { ownerUserId: 'old-app-owner' },
      }),
      3,
    );
    assert.equal(await prisma.knowledgeCaptureRequest.count(), 1);
  } else {
    throw new Error(`unsupported mode: ${mode}`);
  }
} finally {
  await prisma.$disconnect();
}

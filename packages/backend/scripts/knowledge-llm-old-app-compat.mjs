import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const baseline = process.env.KNOWLEDGE_LLM_OLD_APP_BASE_SHA;
const oldRoot = process.env.OLD_APP_ROOT;
const currentRoot = process.env.CURRENT_APP_ROOT;
const mode = process.env.KNOWLEDGE_LLM_OLD_APP_MODE;
const databaseUrl = new URL(process.env.DATABASE_URL || '');

if (
  process.env.KNOWLEDGE_LLM_OLD_APP_CONFIRM !== '1' ||
  baseline !== '8a287700254b4be5215ab60382400fd174b066f6' ||
  !oldRoot ||
  !currentRoot ||
  !['seed', 'current-row', 'old-after'].includes(mode) ||
  databaseUrl.protocol !== 'postgresql:' ||
  !['127.0.0.1', 'localhost'].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== '/erp4_knowledge_llm_old_app' ||
  databaseUrl.hash !== '' ||
  [...databaseUrl.searchParams.keys()].some((key) => key !== 'schema') ||
  databaseUrl.searchParams.getAll('schema').length !== 1 ||
  databaseUrl.searchParams.get('schema') !== 'public'
) {
  throw new Error('Refusing non-ephemeral Knowledge LLM old-app database');
}

const oldRequire = createRequire(
  pathToFileURL(`${oldRoot}/packages/backend/package.json`),
);
const currentRequire = createRequire(
  pathToFileURL(`${currentRoot}/packages/backend/package.json`),
);

function client(requireFromRoot) {
  const { PrismaClient } = requireFromRoot('@prisma/client');
  const { PrismaPg } = requireFromRoot('@prisma/adapter-pg');
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
}

const itemId = 'knowledge-llm-old-app-item';
const roomId = 'knowledge-llm-old-app-room';
const messageId = 'knowledge-llm-old-app-message';

if (mode === 'seed') {
  const prisma = client(oldRequire);
  try {
    await prisma.knowledgeItem.create({
      data: {
        id: itemId,
        ownerUserId: 'old-app-user',
        scope: 'personal',
        sourceType: 'manual',
        title: 'Synthetic old application item',
        createdBy: 'old-app-user',
        updatedBy: 'old-app-user',
      },
    });
    await prisma.chatRoom.create({
      data: { id: roomId, type: 'private_group', name: 'Synthetic room' },
    });
    await prisma.chatRoomMember.create({
      data: { roomId, userId: 'old-app-user' },
    });
    await prisma.chatMessage.create({
      data: {
        id: messageId,
        roomId,
        userId: 'old-app-user',
        body: 'Synthetic legacy message',
      },
    });
  } finally {
    await prisma.$disconnect();
  }
} else if (mode === 'current-row') {
  const prisma = client(currentRequire);
  try {
    await prisma.knowledgeLlmBudgetPolicy.create({
      data: {
        id: 'knowledge-llm-old-app-policy',
        subjectType: 'user',
        subjectId: 'old-app-user',
        currency: 'JPY',
        timezone: 'Asia/Tokyo',
        softLimitMicros: 100n,
        hardLimitMicros: 200n,
        requestsPerHour: 10,
        createdBy: 'synthetic-admin',
        updatedBy: 'synthetic-admin',
      },
    });
  } finally {
    await prisma.$disconnect();
  }
} else {
  const prisma = client(oldRequire);
  try {
    const item = await prisma.knowledgeItem.update({
      where: { id: itemId },
      data: { shortNote: 'Old application write after expand migration' },
    });
    assert.equal(
      item.shortNote,
      'Old application write after expand migration',
    );
    assert.equal(
      (await prisma.chatMessage.findUnique({ where: { id: messageId } })).body,
      'Synthetic legacy message',
    );
    await prisma.chatMessage.create({
      data: {
        id: 'knowledge-llm-old-app-post-migration-message',
        roomId,
        userId: 'old-app-user',
        body: 'Old application still writes Chat rows',
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

console.log(JSON.stringify({ mode, result: 'PASS', baseline }));

import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaKnowledgeThreadPromotionAuditWriter } from '../dist/adapters/knowledge/prismaKnowledgeThreadPromotionAuditAdapter.js';

function actor(overrides = {}) {
  return {
    userId: 'actor-1',
    principalUserId: 'principal-1',
    actorUserId: 'actor-1',
    requestId: 'request-1',
    source: 'api',
    ...overrides,
  };
}

function metadata(overrides = {}) {
  return {
    schemaVersion: 1,
    resultCode: 'created',
    scope: 'personal',
    selectedMessageCount: 2,
    includesSharedCard: false,
    organizationGrantCount: 0,
    duplicate: false,
    ...overrides,
  };
}

test('promotion audit persists only bounded content-free metadata', async () => {
  let persisted;
  const writer = new PrismaKnowledgeThreadPromotionAuditWriter({
    auditLog: {
      create: async (input) => {
        persisted = input;
        return { id: 'audit-1' };
      },
    },
  });

  await writer.write({
    action: 'knowledge_thread_promoted',
    actor: actor({
      authScopes: ['knowledge:write'],
      authTokenId: 'opaque-token-id',
      authAudience: ['erp4'],
      content: 'private-selected-message-canary',
    }),
    targetTable: 'knowledge_thread_promotions',
    targetId: 'promotion-1',
    metadata: metadata({
      body: 'private-selected-message-canary',
      roomId: 'private-room-canary',
      messageIds: ['private-message-canary'],
      requestKey: 'private-request-key-canary',
    }),
  });

  assert.deepEqual(persisted.data.metadata, {
    schemaVersion: 1,
    resultCode: 'created',
    scope: 'personal',
    selectedMessageCount: 2,
    includesSharedCard: false,
    organizationGrantCount: 0,
    duplicate: false,
    _auth: {
      principalUserId: 'principal-1',
      actorUserId: 'actor-1',
      scopes: ['knowledge:write'],
      tokenId: 'opaque-token-id',
      audience: ['erp4'],
    },
    _request: { id: 'request-1', source: 'api' },
  });
  assert.equal(
    JSON.stringify(persisted).includes('private-selected-message-canary'),
    false,
  );
  assert.equal(
    JSON.stringify(persisted).includes('private-room-canary'),
    false,
  );
  assert.equal(
    JSON.stringify(persisted).includes('private-request-key-canary'),
    false,
  );
});

test('promotion audit rejects invalid targets, actor context and unbounded counts', async () => {
  const writer = new PrismaKnowledgeThreadPromotionAuditWriter({
    auditLog: { create: async (input) => input },
  });
  await assert.rejects(
    () =>
      writer.write({
        action: 'knowledge_thread_promoted',
        actor: actor(),
        targetTable: 'knowledge_syntheses',
        targetId: 'promotion-1',
        metadata: metadata(),
      }),
    /knowledge_thread_promotion_audit_contract_invalid/,
  );
  await assert.rejects(
    () =>
      writer.write({
        action: 'knowledge_thread_promoted',
        actor: actor({ principalUserId: undefined }),
        targetTable: 'knowledge_thread_promotions',
        targetId: 'promotion-1',
        metadata: metadata(),
      }),
    /knowledge_thread_promotion_audit_contract_invalid/,
  );
  await assert.rejects(
    () =>
      writer.write({
        action: 'knowledge_thread_promoted',
        actor: actor(),
        targetTable: 'knowledge_thread_promotions',
        targetId: 'promotion-1',
        metadata: metadata({ organizationGrantCount: 21 }),
      }),
    /knowledge_thread_promotion_audit_contract_invalid/,
  );
});

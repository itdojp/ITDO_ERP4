import assert from 'node:assert/strict';
import test from 'node:test';

import { PrismaKnowledgeShareAuditWriter } from '../dist/adapters/knowledge/prismaKnowledgeShareAuditAdapter.js';

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

test('share audit writer persists only the bounded allowlist', async () => {
  let persisted;
  const writer = new PrismaKnowledgeShareAuditWriter({
    auditLog: {
      create: async (input) => {
        persisted = input;
        return { id: 'audit-1' };
      },
    },
  });

  await writer.write({
    action: 'knowledge_share_requested',
    actor: actor({
      authScopes: ['knowledge:write'],
      authTokenId: 'opaque-token-id',
      authAudience: ['erp4'],
      bearer: 'must-not-pass',
    }),
    targetTable: 'knowledge_shares',
    targetId: 'share-1',
    metadata: {
      schemaVersion: 1,
      status: 'pending',
      resultCode: 'created',
      scope: 'personal',
      selectedCategoryCount: 3,
      annotationCount: 1,
      body: 'must-not-pass',
      roomId: 'must-not-pass',
      requestKey: 'must-not-pass',
    },
  });

  assert.deepEqual(persisted.data.metadata, {
    schemaVersion: 1,
    status: 'pending',
    resultCode: 'created',
    scope: 'personal',
    selectedCategoryCount: 3,
    annotationCount: 1,
    _auth: {
      principalUserId: 'principal-1',
      actorUserId: 'actor-1',
      scopes: ['knowledge:write'],
      tokenId: 'opaque-token-id',
      audience: ['erp4'],
    },
    _request: { id: 'request-1', source: 'api' },
  });
  assert.equal(JSON.stringify(persisted).includes('must-not-pass'), false);
});

test('share audit writer rejects invalid action targets and actor context', async () => {
  const writer = new PrismaKnowledgeShareAuditWriter({
    auditLog: { create: async (input) => input },
  });
  await assert.rejects(
    () =>
      writer.write({
        action: 'knowledge_share_posted',
        actor: actor(),
        targetTable: 'knowledge_items',
        targetId: 'share-1',
        metadata: { schemaVersion: 1 },
      }),
    /knowledge_share_audit_contract_invalid/,
  );
  await assert.rejects(
    () =>
      writer.write({
        action: 'knowledge_share_posted',
        actor: actor({ principalUserId: undefined }),
        targetTable: 'knowledge_shares',
        targetId: 'share-1',
        metadata: { schemaVersion: 1 },
      }),
    /knowledge_share_audit_contract_invalid/,
  );
  await assert.rejects(
    () =>
      writer.write({
        action: 'knowledge_share_posted',
        actor: actor(),
        targetTable: 'knowledge_shares',
        targetId: 'share-1',
        metadata: { schemaVersion: 1, turnCount: 10_001 },
      }),
    /knowledge_share_audit_contract_invalid/,
  );
});

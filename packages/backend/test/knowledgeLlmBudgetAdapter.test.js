import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

const hash = (character) => character.repeat(64);

function reservation() {
  return {
    runId: 'synthetic-run',
    actor: { userId: 'synthetic-user', groupAccountIds: [] },
    auditActor: {
      requestId: 'synthetic-request',
      source: 'api',
      principalUserId: 'synthetic-user',
      actorUserId: 'synthetic-user',
    },
    scope: 'personal',
    organizationId: null,
    provider: 'stub',
    model: 'stub-v1',
    catalogVersion: 1,
    promptTemplateVersion: 1,
    requestKeyHash: hash('a'),
    requestPayloadHash: hash('b'),
    providerRequestHash: hash('d'),
    selectedContextFingerprint: hash('c'),
    userPrompt: 'Synthetic prompt',
    userPromptHash: createHash('sha256')
      .update('erp4:knowledge:llm-user-prompt:v1\0Synthetic prompt', 'utf8')
      .digest('hex'),
    selectedContextSources: [],
    estimatedInputTokens: 10,
    maxOutputTokens: 10,
    inputCostMicrosPerMillion: 100_000n,
    outputCostMicrosPerMillion: 0n,
    maximumCostMicros: 1n,
    currency: 'JPY',
    now: new Date('2026-08-11T00:00:00.000Z'),
  };
}

test('budget adapter normalizes exhausted serializable retries', async () => {
  const { PrismaKnowledgeLlmBudgetAdapter } =
    await import('../dist/adapters/knowledge/prismaKnowledgeLlmBudgetAdapter.js');
  let attempts = 0;
  let auditWrites = 0;
  const adapter = new PrismaKnowledgeLlmBudgetAdapter({
    async $transaction(callback) {
      attempts += 1;
      if (attempts === 4) {
        return callback({
          auditLog: {
            async create() {
              auditWrites += 1;
            },
          },
        });
      }
      throw { code: 'P2034' };
    },
  });

  const result = await adapter.reserve(reservation());
  assert.equal(attempts, 4);
  assert.equal(auditWrites, 1);
  assert.deepEqual(result, {
    ok: false,
    error: {
      status: 409,
      code: 'reservation_conflict',
      message: 'Reservation conflict',
    },
  });
});

test('budget adapter does not normalize an unknown database failure', async () => {
  const { PrismaKnowledgeLlmBudgetAdapter } =
    await import('../dist/adapters/knowledge/prismaKnowledgeLlmBudgetAdapter.js');
  const failure = new Error('synthetic_database_failure');
  const adapter = new PrismaKnowledgeLlmBudgetAdapter({
    async $transaction() {
      throw failure;
    },
  });

  await assert.rejects(adapter.reserve(reservation()), (error) => {
    assert.equal(error, failure);
    return true;
  });
});

test('budget adapter normalizes a trusted accounting period boundary rejection', async () => {
  const { PrismaKnowledgeLlmBudgetAdapter } =
    await import('../dist/adapters/knowledge/prismaKnowledgeLlmBudgetAdapter.js');
  let attempts = 0;
  let auditWrites = 0;
  const adapter = new PrismaKnowledgeLlmBudgetAdapter({
    async $transaction(callback) {
      attempts += 1;
      if (attempts === 2) {
        return callback({
          auditLog: {
            async create() {
              auditWrites += 1;
            },
          },
        });
      }
      throw {
        code: 'P2039',
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '23514',
              originalMessage:
                'KnowledgeLlmReservation must use the current trusted accounting period',
            },
          },
        },
      };
    },
  });

  const result = await adapter.reserve(reservation());
  assert.equal(attempts, 2);
  assert.equal(auditWrites, 1);
  assert.deepEqual(result, {
    ok: false,
    error: {
      status: 400,
      code: 'policy_mismatch',
      message: 'Budget policy mismatch',
    },
  });
});

test('budget adapter does not normalize another P2039 database diagnostic', async () => {
  const { PrismaKnowledgeLlmBudgetAdapter } =
    await import('../dist/adapters/knowledge/prismaKnowledgeLlmBudgetAdapter.js');
  const databaseFailure = {
    code: 'P2039',
    meta: {
      driverAdapterError: {
        cause: {
          originalCode: '23514',
          originalMessage: 'synthetic_other_constraint',
        },
      },
    },
  };
  const adapter = new PrismaKnowledgeLlmBudgetAdapter({
    async $transaction() {
      throw databaseFailure;
    },
  });

  await assert.rejects(adapter.reserve(reservation()), (error) => {
    assert.equal(error, databaseFailure);
    return true;
  });
});

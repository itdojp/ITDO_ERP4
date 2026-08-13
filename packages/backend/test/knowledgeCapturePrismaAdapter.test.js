import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ??=
  'postgresql://test:test@127.0.0.1:5432/test?schema=public';

const { PrismaKnowledgeCaptureUnitOfWork } =
  await import('../dist/adapters/knowledge/prismaKnowledgeCaptureAdapter.js');
const { KnowledgeCaptureTransactionConflictError } =
  await import('../dist/application/knowledge/knowledgeCapturePorts.js');

const retryableConflicts = [
  { code: 'P2002' },
  { code: 'P2034' },
  {
    code: 'P2010',
    meta: {
      driverAdapterError: { cause: { originalCode: '40001' } },
    },
  },
  {
    code: 'P2010',
    meta: {
      driverAdapterError: { cause: { code: '40P01' } },
    },
  },
];

test('capture unit of work retries supported Prisma/driver conflicts at most three times', async () => {
  for (const conflict of retryableConflicts) {
    let attempts = 0;
    const unit = new PrismaKnowledgeCaptureUnitOfWork({
      async $transaction(work, options) {
        attempts += 1;
        assert.equal(options.isolationLevel, 'Serializable');
        if (attempts < 3) throw conflict;
        return work({});
      },
    });
    assert.equal(await unit.run(async () => 'ok'), 'ok');
    assert.equal(attempts, 3);
  }
});

test('capture unit of work maps exhausted conflicts and does not retry permanent failures', async () => {
  let attempts = 0;
  const exhausted = new PrismaKnowledgeCaptureUnitOfWork({
    async $transaction() {
      attempts += 1;
      throw retryableConflicts[2];
    },
  });
  await assert.rejects(
    () => exhausted.run(async () => 'never'),
    KnowledgeCaptureTransactionConflictError,
  );
  assert.equal(attempts, 3);

  const permanent = new Error('permanent');
  const noRetry = new PrismaKnowledgeCaptureUnitOfWork({
    async $transaction() {
      throw permanent;
    },
  });
  await assert.rejects(() => noRetry.run(async () => 'never'), permanent);
});

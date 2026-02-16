import assert from 'node:assert/strict';
import test from 'node:test';

import { nextNumber } from '../dist/services/numbering.js';

function createMockClient(steps = []) {
  let index = 0;
  let calls = 0;
  const client = {
    async $transaction(callback) {
      calls += 1;
      const step = steps[index] ?? steps[steps.length - 1] ?? {};
      index += 1;
      if (step.error) throw step.error;
      const serial = step.serial ?? 1;
      return callback({
        numberSequence: {
          upsert: async () => ({ currentSerial: serial }),
        },
      });
    },
  };
  return {
    client,
    getCalls: () => calls,
  };
}

test('nextNumber: returns formatted number with padded month and serial', async () => {
  const { client, getCalls } = createMockClient([{ serial: 7 }]);
  const result = await nextNumber('invoice', new Date('2026-02-10T00:00:00Z'), {
    client,
  });

  assert.deepEqual(result, { number: 'I2026-02-0007', serial: 7 });
  assert.equal(getCalls(), 1);
});

test('nextNumber: rejects unsupported kind', async () => {
  await assert.rejects(
    nextNumber('unknown', new Date('2026-02-10T00:00:00Z')),
    /Unsupported kind: unknown/,
  );
});

test('nextNumber: rejects serial overflow without retry', async () => {
  const { client, getCalls } = createMockClient([{ serial: 10000 }]);

  await assert.rejects(
    nextNumber('estimate', new Date('2026-02-10T00:00:00Z'), { client }),
    /Serial overflow \(>=10000\)/,
  );
  assert.equal(getCalls(), 1);
});

test('nextNumber: retries on P2034 and succeeds', async () => {
  const retryable = Object.assign(new Error('serialization failed'), {
    code: 'P2034',
  });
  const { client, getCalls } = createMockClient([
    { error: retryable },
    { serial: 12 },
  ]);

  const result = await nextNumber(
    'purchase_order',
    new Date('2026-12-01T00:00:00Z'),
    { client },
  );

  assert.deepEqual(result, { number: 'PO2026-12-0012', serial: 12 });
  assert.equal(getCalls(), 2);
});

test('nextNumber: does not retry non-retryable error', async () => {
  const nonRetryable = new Error('boom');
  const { client, getCalls } = createMockClient([{ error: nonRetryable }]);

  await assert.rejects(
    nextNumber('vendor_invoice', new Date('2026-02-10T00:00:00Z'), { client }),
    /boom/,
  );
  assert.equal(getCalls(), 1);
});

test('nextNumber: respects maxRetries for retryable errors', async () => {
  const retryable1 = Object.assign(new Error('serialization failed #1'), {
    code: 'P2034',
  });
  const retryable2 = Object.assign(new Error('serialization failed #2'), {
    code: 'P2034',
  });
  const { client, getCalls } = createMockClient([
    { error: retryable1 },
    { error: retryable2 },
    { serial: 99 },
  ]);

  await assert.rejects(
    nextNumber('delivery', new Date('2026-02-10T00:00:00Z'), {
      client,
      maxRetries: 2,
    }),
    /serialization failed #2/,
  );
  assert.equal(getCalls(), 2);
});

test('nextNumber: falls back to default retries when maxRetries is Infinity', async () => {
  const retryable1 = Object.assign(new Error('serialization failed #1'), {
    code: 'P2034',
  });
  const retryable2 = Object.assign(new Error('serialization failed #2'), {
    code: 'P2034',
  });
  const retryable3 = Object.assign(new Error('serialization failed #3'), {
    code: 'P2034',
  });
  const { client, getCalls } = createMockClient([
    { error: retryable1 },
    { error: retryable2 },
    { error: retryable3 },
    { serial: 77 },
  ]);

  await assert.rejects(
    nextNumber('invoice', new Date('2026-02-10T00:00:00Z'), {
      client,
      maxRetries: Number.POSITIVE_INFINITY,
    }),
    /serialization failed #3/,
  );
  assert.equal(getCalls(), 3);
});

test('nextNumber: clamps excessive maxRetries to upper bound', async () => {
  const retryableErrors = Array.from({ length: 10 }, (_, i) =>
    Object.assign(new Error(`serialization failed #${i + 1}`), {
      code: 'P2034',
    }),
  );
  const { client, getCalls } = createMockClient(
    retryableErrors.map((error) => ({ error })),
  );

  await assert.rejects(
    nextNumber('invoice', new Date('2026-02-10T00:00:00Z'), {
      client,
      maxRetries: 1000,
    }),
    /serialization failed #10/,
  );
  assert.equal(getCalls(), 10);
});

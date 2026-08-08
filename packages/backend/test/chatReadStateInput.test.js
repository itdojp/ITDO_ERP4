import assert from 'node:assert/strict';
import test from 'node:test';

import { parseChatReadStateInput } from '../dist/routes/chat/shared/readStateInput.js';

test('read state input preserves bodyless callers and parses an explicit high-water', () => {
  assert.deepEqual(parseChatReadStateInput(undefined), { ok: true });
  assert.deepEqual(parseChatReadStateInput({}), { ok: true });
  assert.deepEqual(
    parseChatReadStateInput({
      through: '2026-08-08T00:00:00.000Z',
      throughMessageId: ' message-1 ',
    }),
    {
      ok: true,
      through: new Date('2026-08-08T00:00:00.000Z'),
      throughMessageId: 'message-1',
    },
  );
});

test('read state input rejects malformed dates and unknown fields', () => {
  for (const input of [
    null,
    [],
    '2026-08-08',
    { through: 1 },
    { throughMessageId: 'message-without-time' },
    { through: '2026-08-08T00:00:00.000Z', throughMessageId: '' },
    {
      through: '2026-08-08T00:00:00.000Z',
      throughMessageId: 'x'.repeat(201),
    },
    { through: 'invalid' },
    { through: '2026-08-08T00:00:00.000Z', actor: 'hidden' },
  ]) {
    assert.deepEqual(parseChatReadStateInput(input), { ok: false });
  }
});

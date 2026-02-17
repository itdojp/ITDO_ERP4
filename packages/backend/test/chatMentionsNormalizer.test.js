import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeMentions } from '../dist/routes/chat/shared/mentions.js';

test('normalizeMentions: non-object input returns empty mentions', () => {
  const normalized = normalizeMentions(null);
  assert.deepEqual(normalized, {
    mentions: undefined,
    mentionsAll: false,
    mentionUserIds: [],
    mentionGroupIds: [],
  });
});

test('normalizeMentions: empty object returns empty mentions', () => {
  const normalized = normalizeMentions({});
  assert.deepEqual(normalized, {
    mentions: undefined,
    mentionsAll: false,
    mentionUserIds: [],
    mentionGroupIds: [],
  });
});

test('normalizeMentions: deduplicates and trims user/group ids with max limits', () => {
  const userIds = [
    '  user-a  ',
    'user-a',
    ...Array.from({ length: 70 }, (_, index) => `user-${index}`),
  ];
  const groupIds = [
    ' group-a ',
    'group-a',
    ...Array.from({ length: 40 }, (_, index) => `group-${index}`),
  ];
  const normalized = normalizeMentions({
    userIds,
    groupIds,
    all: false,
  });

  assert.equal(normalized.mentionsAll, false);
  assert.equal(normalized.mentionUserIds.length, 50);
  assert.equal(normalized.mentionGroupIds.length, 20);
  assert.equal(normalized.mentionUserIds[0], 'user-a');
  assert.equal(normalized.mentionGroupIds[0], 'group-a');
  assert.deepEqual(normalized.mentions, {
    userIds: normalized.mentionUserIds,
    groupIds: normalized.mentionGroupIds,
  });
});

test('normalizeMentions: all=true keeps mentionsAll even when ids are empty', () => {
  const normalized = normalizeMentions({ all: true });
  assert.equal(normalized.mentionsAll, true);
  assert.deepEqual(normalized.mentionUserIds, []);
  assert.deepEqual(normalized.mentionGroupIds, []);
  assert.equal(normalized.mentions, undefined);
});

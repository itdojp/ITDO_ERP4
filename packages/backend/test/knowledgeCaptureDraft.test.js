import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalizeKnowledgeCapture,
  decodeKnowledgeCaptureJson,
  KnowledgeCaptureValidationError,
  normalizeKnowledgeCaptureDraft,
  renderKnowledgeCaptureSnapshot,
} from '../dist/application/knowledge/knowledgeCaptureDraft.js';

const capturedAt = '2026-08-14T00:00:00.000Z';

function draft(overrides = {}) {
  return {
    schemaVersion: 1,
    channel: 'browser_extension',
    title: 'Synthetic title',
    url: 'https://example.invalid/article?utm_source=test&b=2&a=1#private',
    selectedText: 'Selected text',
    description: 'Description',
    author: 'Synthetic author',
    publishedAt: '2026-08-13T00:00:00.000Z',
    capturedAt,
    ...overrides,
  };
}

test('normalizes allowlisted metadata and drops unknown scalar fields', () => {
  const normalized = normalizeKnowledgeCaptureDraft({
    ...draft(),
    ogImage: 'must-not-be-copied',
  });
  assert.deepEqual(Object.keys(normalized), [
    'schemaVersion',
    'channel',
    'title',
    'url',
    'selectedText',
    'description',
    'author',
    'publishedAt',
    'capturedAt',
  ]);
  assert.equal(normalized.url, 'https://example.invalid/article?a=1&b=2');
  assert.equal(JSON.stringify(normalized).includes('ogImage'), false);
});

test('selected snapshot contains selected fields only in deterministic order', () => {
  const first = canonicalizeKnowledgeCapture({
    draft: draft(),
    selectedFields: ['selectedText', 'title'],
  });
  const second = canonicalizeKnowledgeCapture({
    draft: draft(),
    selectedFields: ['title', 'selectedText'],
  });
  assert.equal(first.payloadHash, second.payloadHash);
  assert.deepEqual(first.selectedFields, ['title', 'selectedText']);
  assert.deepEqual(first.omittedFields, [
    'url',
    'description',
    'author',
    'publishedAt',
  ]);
  const snapshot = renderKnowledgeCaptureSnapshot(first);
  assert.match(snapshot, /Synthetic title/);
  assert.match(snapshot, /Selected text/);
  for (const canary of [
    'example.invalid',
    'Description',
    'Synthetic author',
    '2026-08-13',
  ]) {
    assert.equal(snapshot.includes(canary), false);
    assert.equal(first.selectedPayload.includes(canary), false);
  }
});

test('rejects invalid UTF-8, NUL, controls, nested objects, and prototype keys', () => {
  assert.throws(
    () => decodeKnowledgeCaptureJson(Buffer.from([0xc3, 0x28])),
    (error) =>
      error instanceof KnowledgeCaptureValidationError &&
      error.code === 'capture_payload_invalid',
  );
  for (const value of [
    draft({ title: 'bad\0title' }),
    draft({ selectedText: 'bad\u0001text' }),
    draft({ selectedText: 'bad\u009btext' }),
    draft({ selectedText: 'bad\ufffdtext' }),
    draft({ selectedText: 'bad\u061ctext' }),
    draft({ selectedText: 'bad\u200etext' }),
    draft({ selectedText: 'bad\u200ftext' }),
    draft({ selectedText: 'bad\u202etext' }),
    draft({ selectedText: 'bad\ud800text' }),
    { ...draft(), metadata: { nested: true } },
    { ...draft(), ['unknown\u009bkey']: 'value' },
    { ...draft(), unknownMetadata: 'bad\ud800value' },
    JSON.parse(
      `{"schemaVersion":1,"channel":"browser_extension","capturedAt":"${capturedAt}","__proto__":"bad"}`,
    ),
  ]) {
    assert.throws(() => normalizeKnowledgeCaptureDraft(value), {
      name: 'KnowledgeCaptureValidationError',
    });
  }
});

test('rejects unsafe and credential-bearing URL forms', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,secret',
    'file:///private',
    'chrome://settings',
    'edge://settings',
    'about:blank',
    'https://user:opaque@example.invalid/',
    'https://example.invalid/?PHPSESSID=synthetic-secret',
    'https://example.invalid/?next=https%3A%2F%2Fnested.invalid%2Fapp%253Bjsessionid%253Dsynthetic-secret',
    'https://example.invalid/?next=https%3A%2F%2Fnested.invalid%2Fpath%2F%253Ftoken%253Dsynthetic-secret',
    'https://example.invalid/redirect/https%253Aalice%253Asynthetic-pass%2540nested.invalid/private',
    'not a url',
  ]) {
    assert.throws(
      () => normalizeKnowledgeCaptureDraft(draft({ url })),
      (error) =>
        error instanceof KnowledgeCaptureValidationError &&
        error.code === 'capture_url_invalid',
    );
  }
});

test('enforces per-field, total, and selection bounds', () => {
  assert.throws(
    () =>
      normalizeKnowledgeCaptureDraft({
        ...draft(),
        unknownMetadata: 'x'.repeat(128 * 1024),
      }),
    { name: 'KnowledgeCaptureValidationError' },
  );
  assert.throws(
    () => normalizeKnowledgeCaptureDraft(draft({ title: 'x'.repeat(501) })),
    {
      name: 'KnowledgeCaptureValidationError',
    },
  );
  assert.throws(
    () =>
      normalizeKnowledgeCaptureDraft(
        draft({ selectedText: 'x'.repeat(64 * 1024 + 1) }),
      ),
    { name: 'KnowledgeCaptureValidationError' },
  );
  assert.throws(
    () => canonicalizeKnowledgeCapture({ draft: draft(), selectedFields: [] }),
    { name: 'KnowledgeCaptureValidationError' },
  );
  assert.throws(
    () =>
      canonicalizeKnowledgeCapture({
        draft: draft({ author: null }),
        selectedFields: ['author'],
      }),
    { name: 'KnowledgeCaptureValidationError' },
  );
});

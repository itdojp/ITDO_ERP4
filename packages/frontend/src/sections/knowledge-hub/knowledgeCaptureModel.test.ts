import { describe, expect, it } from 'vitest';

import { normalizeIncomingKnowledgeCapture } from './knowledgeCaptureModel';

const valid = {
  schemaVersion: 1,
  channel: 'browser_extension',
  title: 'Synthetic page 😀',
  url: 'https://example.invalid/article',
  selectedText: 'Selected text',
  description: null,
  author: null,
  publishedAt: null,
  capturedAt: '2026-08-14T00:00:00.000Z',
};

describe('incoming knowledge capture normalization', () => {
  it('copies only allowlisted scalar fields and accepts well-formed Unicode', () => {
    expect(
      normalizeIncomingKnowledgeCapture({
        ...valid,
        providerKey: 'must-not-copy',
      }),
    ).toEqual(valid);
  });

  it.each([
    ['non-http URL', { url: 'javascript:alert(1)' }],
    ['credential URL', { url: 'https://user:opaque@example.invalid/' }],
    ['NUL', { selectedText: 'before\0after' }],
    ['replacement character', { selectedText: 'before\ufffdafter' }],
    ['unpaired surrogate', { selectedText: 'before\ud800after' }],
    ['invalid timestamp', { capturedAt: '2026-08-14 00:00:00' }],
    ['oversize title', { title: 't'.repeat(501) }],
    ['oversize selected text', { selectedText: 't'.repeat(64 * 1024 + 1) }],
    ['oversize unknown metadata', { unknownMetadata: 't'.repeat(128 * 1024) }],
    ['nested metadata', { unknownMetadata: { nested: true } }],
  ])('rejects %s before rendering', (_label, override) => {
    expect(normalizeIncomingKnowledgeCapture({ ...valid, ...override })).toBe(
      null,
    );
  });

  it('rejects prototype-bearing payloads', () => {
    const payload = Object.assign(Object.create({ inherited: true }), valid);
    expect(normalizeIncomingKnowledgeCapture(payload)).toBeNull();
  });
});

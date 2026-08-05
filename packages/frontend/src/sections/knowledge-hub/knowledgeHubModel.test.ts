import { describe, expect, it } from 'vitest';

import {
  KNOWLEDGE_MAX_TEXT_BYTES,
  KNOWLEDGE_MAX_UPLOAD_BYTES,
  createKnowledgeRequestKey,
  formatKnowledgeBytes,
  knowledgeHubErrorMessage,
  validateKnowledgeCapture,
  type KnowledgeCaptureDraft,
  type KnowledgeItem,
} from './knowledgeHubModel';

const selectedItem: KnowledgeItem = {
  id: 'item-1',
  ownerUserId: 'user-1',
  scope: 'personal',
  organizationId: null,
  sourceType: 'manual',
  canonicalUrl: null,
  title: '既存項目',
  status: 'inbox',
  version: 1,
  capturedAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

function draft(overrides: Partial<KnowledgeCaptureDraft> = {}) {
  return {
    destination: 'new',
    mode: 'text',
    scope: 'personal',
    title: '',
    organizationGroupIds: '',
    organizationConfirmed: false,
    text: '保存する本文',
    url: '',
    file: null,
    selectedItem: null,
    ...overrides,
  } satisfies KnowledgeCaptureDraft;
}

describe('validateKnowledgeCapture', () => {
  it('accepts a personal manual text capture as the default', () => {
    const result = validateKnowledgeCapture(draft());

    expect(result).toEqual({
      ok: true,
      value: {
        destination: 'new',
        mode: 'text',
        sourceType: 'manual',
        scope: 'personal',
        title: null,
        organizationGroupIds: [],
        selectedItem: null,
        text: '保存する本文',
      },
    });
  });

  it('enforces the text limit in UTF-8 bytes rather than characters', () => {
    const overLimit = '😀'.repeat(Math.floor(KNOWLEDGE_MAX_TEXT_BYTES / 4) + 1);

    expect(validateKnowledgeCapture(draft({ text: overLimit }))).toEqual({
      ok: false,
      error: 'テキストはUTF-8で1 MiB以内にしてください。',
    });
  });

  it('accepts only credential-free HTTP(S) URLs', () => {
    expect(
      validateKnowledgeCapture(
        draft({ mode: 'url', text: '', url: 'https://example.com/article' }),
      ),
    ).toMatchObject({
      ok: true,
      value: { sourceType: 'web', url: 'https://example.com/article' },
    });
    expect(
      validateKnowledgeCapture(
        draft({ mode: 'url', text: '', url: 'https://user:pass@example.com/' }),
      ),
    ).toEqual({
      ok: false,
      error: 'URLは認証情報を含まないhttp/https URLにしてください。',
    });
    expect(
      validateKnowledgeCapture(
        draft({ mode: 'url', text: '', url: 'file:///etc/passwd' }),
      ),
    ).toEqual({
      ok: false,
      error: 'URLは認証情報を含まないhttp/https URLにしてください。',
    });
  });

  it('requires group IDs and explicit confirmation for organization scope', () => {
    const organizationDraft = draft({
      scope: 'organization',
      organizationGroupIds: 'group-a, group-b\ngroup-a',
    });

    expect(
      validateKnowledgeCapture({
        ...organizationDraft,
        organizationGroupIds: '',
      }),
    ).toEqual({
      ok: false,
      error: '組織scopeでは共有先グループIDを1件以上入力してください。',
    });
    expect(validateKnowledgeCapture(organizationDraft)).toEqual({
      ok: false,
      error: '組織の共有範囲へ保存することを確認してください。',
    });
    expect(
      validateKnowledgeCapture({
        ...organizationDraft,
        organizationConfirmed: true,
      }),
    ).toMatchObject({
      ok: true,
      value: { organizationGroupIds: ['group-a', 'group-b'] },
    });
  });

  it('inherits scope and requires an existing item for version capture', () => {
    expect(
      validateKnowledgeCapture(draft({ destination: 'selected' })),
    ).toEqual({
      ok: false,
      error: '保存先のInbox項目を選択してください。',
    });
    expect(
      validateKnowledgeCapture(
        draft({ destination: 'selected', selectedItem }),
      ),
    ).toMatchObject({
      ok: true,
      value: { selectedItem, scope: 'personal' },
    });
  });

  it('validates PDF/image type, non-empty content, and the 10 MiB limit', () => {
    const pdf = new File(['%PDF-1.7'], 'sample.pdf', {
      type: 'application/pdf',
    });
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', {
      type: 'image/png',
    });

    expect(
      validateKnowledgeCapture(draft({ mode: 'pdf', text: '', file: pdf })),
    ).toMatchObject({ ok: true, value: { sourceType: 'pdf', file: pdf } });
    expect(
      validateKnowledgeCapture(draft({ mode: 'image', text: '', file: png })),
    ).toMatchObject({ ok: true, value: { sourceType: 'image', file: png } });
    expect(
      validateKnowledgeCapture(draft({ mode: 'pdf', text: '', file: png })),
    ).toEqual({
      ok: false,
      error: 'PDF形式のファイルを選択してください。',
    });

    const oversized = new File(
      [new Uint8Array(KNOWLEDGE_MAX_UPLOAD_BYTES + 1)],
      'large.pdf',
      { type: 'application/pdf' },
    );
    expect(
      validateKnowledgeCapture(
        draft({ mode: 'pdf', text: '', file: oversized }),
      ),
    ).toEqual({ ok: false, error: 'ファイルは10 MiB以内にしてください。' });
  });
});

describe('request key and presentation helpers', () => {
  it('uses randomUUID when available and a random-byte fallback otherwise', () => {
    expect(
      createKnowledgeRequestKey({
        randomUUID: () => 'opaque-uuid',
        getRandomValues: <T extends ArrayBufferView | null>(value: T) => value,
      } as unknown as Crypto),
    ).toBe('opaque-uuid');

    const fallback = createKnowledgeRequestKey({
      getRandomValues: <T extends ArrayBufferView | null>(value: T) => {
        if (value instanceof Uint8Array) value.fill(0xab);
        return value;
      },
    } as unknown as Crypto);
    expect(fallback).toBe('ab'.repeat(24));
  });

  it('fails closed when a secure browser random source is unavailable', () => {
    expect(() => createKnowledgeRequestKey({} as unknown as Crypto)).toThrow(
      'secure_request_key_unavailable',
    );
  });

  it('uses sanitized fixed messages and byte units', () => {
    expect(knowledgeHubErrorMessage('snapshot_storage_pending')).not.toMatch(
      /provider|token|secret/i,
    );
    expect(formatKnowledgeBytes(1024)).toBe('1.0 KiB');
    expect(formatKnowledgeBytes(null)).toBe('-');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearDraft, getDraftOwnerId, loadDraft, saveDraft } from './drafts';

const originalIndexedDbDescriptor = Object.getOwnPropertyDescriptor(
  window,
  'indexedDB',
);

describe('drafts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    if (originalIndexedDbDescriptor) {
      Object.defineProperty(window, 'indexedDB', originalIndexedDbDescriptor);
    } else {
      Reflect.deleteProperty(
        window as Window & { indexedDB?: unknown },
        'indexedDB',
      );
    }
  });

  it('returns the explicit user id when provided', () => {
    expect(getDraftOwnerId('user-1')).toBe('user-1');
  });

  it('reuses an existing session draft owner id', () => {
    window.sessionStorage.setItem('erp4-draft-session', 'session-existing');

    expect(getDraftOwnerId()).toBe('session-existing');
  });

  it('generates and stores a session draft owner id', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      '123e4567-e89b-12d3-a456-426614174000',
    );

    expect(getDraftOwnerId()).toBe(
      'session-123e4567-e89b-12d3-a456-426614174000',
    );
    expect(window.sessionStorage.getItem('erp4-draft-session')).toBe(
      'session-123e4567-e89b-12d3-a456-426614174000',
    );
  });

  it('returns a generated session id when sessionStorage throws', () => {
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    const ownerId = getDraftOwnerId();

    expect(ownerId).toMatch(/^session-/);
  });

  it('returns null from loadDraft when indexedDB is unavailable', async () => {
    Reflect.deleteProperty(
      window as Window & { indexedDB?: unknown },
      'indexedDB',
    );

    await expect(loadDraft('draft-key')).resolves.toBeNull();
  });

  it('swallows clearDraft errors when indexedDB is unavailable', async () => {
    Reflect.deleteProperty(
      window as Window & { indexedDB?: unknown },
      'indexedDB',
    );

    await expect(clearDraft('draft-key')).resolves.toBeUndefined();
  });

  it('rejects saveDraft when indexedDB is unavailable', async () => {
    Reflect.deleteProperty(
      window as Window & { indexedDB?: unknown },
      'indexedDB',
    );

    await expect(saveDraft('draft-key', { note: 'value' })).rejects.toThrow(
      'indexedDB is not available',
    );
  });
});

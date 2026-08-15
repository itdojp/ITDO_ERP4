import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BROWSER_CAPTURE_TERMINAL_FENCE_TTL_MS,
  browserCaptureActorFingerprint,
  clearBrowserCaptureTerminalFence,
  getBrowserCaptureDraft,
  hasBrowserCaptureTerminalFence,
  markBrowserCaptureTerminalFence,
  markBrowserCaptureDraftCleanupPending,
  markBrowserCaptureDraftPending,
  markBrowserCaptureDraftStaged,
  publishBrowserCaptureLifecycle,
  removeBrowserCaptureDraft,
  subscribeBrowserCaptureLifecycle,
} from './browserCaptureBridge';
import type { ShareTargetPendingIntent } from './shareTargetQueue';

const id = '0123456789abcdef0123456789abcdef';
const actorKey = 'header:synthetic-account';
const requestKey = 'r'.repeat(32);
const operationId = 'o'.repeat(32);
const draft = {
  schemaVersion: 1 as const,
  channel: 'browser_extension' as const,
  title: 'Synthetic title',
  url: 'https://example.invalid/article',
  selectedText: 'Selected text',
  description: null,
  author: null,
  publishedAt: null,
  capturedAt: '2026-08-14T00:00:00.000Z',
};

function responseRecord(lifecycle: 'staged' | 'pending' = 'staged') {
  return {
    schemaVersion: 1,
    id,
    requestKey,
    lifecycle,
    pendingOperationId: lifecycle === 'pending' ? operationId : null,
    pendingIntent:
      lifecycle === 'pending'
        ? {
            selectedFields: ['title'],
            scope: 'personal',
            organizationGroupAccountIds: [],
            sourceType: 'web',
          }
        : null,
    draft,
    createdAt: '2099-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:10:00.000Z',
  };
}

function cleanupResponseRecord() {
  return {
    schemaVersion: 1,
    id,
    lifecycle: 'cleanup_pending',
    createdAt: '2099-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:10:00.000Z',
  };
}

function organizationPendingResponseRecord(groupCount: number) {
  return {
    ...responseRecord('pending'),
    pendingIntent: {
      selectedFields: ['title'],
      scope: 'organization',
      organizationGroupAccountIds: Array.from(
        { length: groupCount },
        (_value, index) => `group-${String(index).padStart(3, '0')}`,
      ),
      sourceType: 'web',
    },
  };
}

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browserCaptureBridge', () => {
  it('sends only an actor fingerprint and accepts an exact-origin one-time response', async () => {
    const sent: Array<Record<string, unknown>> = [];
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      const request = message as Record<string, unknown>;
      sent.push(request);
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            origin: window.location.origin,
            data: {
              source: 'erp4-extension',
              type: 'erp4-browser-capture-response-v1',
              schemaVersion: 1,
              command: request.command,
              id: request.id,
              nonce: request.nonce,
              response: {
                ok: true,
                transitioned: false,
                record: responseRecord(),
              },
            },
          }),
        );
      });
    });

    const value = await getBrowserCaptureDraft(id, actorKey);
    expect(value?.id).toBe(id);
    expect(sent).toHaveLength(1);
    expect(sent[0].actorFingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(JSON.stringify(sent[0])).not.toContain(actorKey);
    expect(sent[0]).not.toHaveProperty('draft');
  });

  it('ignores a wrong-origin response and fixes a pending transition to exact intent', async () => {
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      const request = message as Record<string, unknown>;
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            origin: 'https://attacker.invalid',
            data: {
              source: 'erp4-extension',
              type: 'erp4-browser-capture-response-v1',
              schemaVersion: 1,
              command: request.command,
              id: request.id,
              nonce: request.nonce,
              response: { ok: true, record: responseRecord() },
            },
          }),
        );
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            origin: window.location.origin,
            data: {
              source: 'erp4-extension',
              type: 'erp4-browser-capture-response-v1',
              schemaVersion: 1,
              command: request.command,
              id: request.id,
              nonce: request.nonce,
              response: {
                ok: true,
                transitioned: true,
                record: responseRecord('pending'),
              },
            },
          }),
        );
      });
    });

    const value = await markBrowserCaptureDraftPending(
      id,
      actorKey,
      operationId,
      {
        selectedFields: ['title'],
        scope: 'personal',
        organizationGroupAccountIds: [],
        sourceType: 'web',
      },
      draft,
    );
    expect(value).toEqual({ transitioned: true });
  });

  it('resumes only the exact pending operation and rejects a mismatched writer attestation', async () => {
    const exactIntent: ShareTargetPendingIntent = {
      selectedFields: ['title'],
      scope: 'personal',
      organizationGroupAccountIds: [],
      sourceType: 'web',
    };
    let returnedOperationId = operationId;
    let returnedIntent: ShareTargetPendingIntent = exactIntent;
    let returnedDraft = draft;
    let transitioned = false;
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      const request = message as Record<string, unknown>;
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            origin: window.location.origin,
            data: {
              source: 'erp4-extension',
              type: 'erp4-browser-capture-response-v1',
              schemaVersion: 1,
              command: request.command,
              id: request.id,
              nonce: request.nonce,
              response: {
                ok: true,
                transitioned,
                record: {
                  ...responseRecord('pending'),
                  pendingOperationId: returnedOperationId,
                  pendingIntent: returnedIntent,
                  draft: returnedDraft,
                },
              },
            },
          }),
        );
      });
    });

    await expect(
      markBrowserCaptureDraftPending(
        id,
        actorKey,
        operationId,
        exactIntent,
        draft,
      ),
    ).resolves.toEqual({ transitioned: false, owned: true });

    returnedDraft = { ...draft, selectedText: 'mismatched same-operation' };
    await expect(
      markBrowserCaptureDraftPending(
        id,
        actorKey,
        operationId,
        exactIntent,
        draft,
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    returnedDraft = draft;

    returnedOperationId = 'x'.repeat(32);
    await expect(
      markBrowserCaptureDraftPending(
        id,
        actorKey,
        operationId,
        exactIntent,
        draft,
      ),
    ).resolves.toMatchObject({ transitioned: false, owned: false });

    transitioned = true;
    await expect(
      markBrowserCaptureDraftPending(
        id,
        actorKey,
        operationId,
        exactIntent,
        draft,
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' });

    returnedOperationId = operationId;
    returnedIntent = { ...exactIntent, sourceType: 'manual' };
    await expect(
      markBrowserCaptureDraftPending(
        id,
        actorKey,
        operationId,
        exactIntent,
        draft,
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' });

    returnedIntent = exactIntent;
    returnedDraft = { ...draft, selectedText: 'different' };
    await expect(
      markBrowserCaptureDraftPending(
        id,
        actorKey,
        operationId,
        exactIntent,
        draft,
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('normalizes content-free failures and deletes without sending a draft', async () => {
    const sent: Array<Record<string, unknown>> = [];
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      const request = message as Record<string, unknown>;
      sent.push(request);
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            origin: window.location.origin,
            data: {
              source: 'erp4-extension',
              type: 'erp4-browser-capture-response-v1',
              schemaVersion: 1,
              command: request.command,
              id: request.id,
              nonce: request.nonce,
              response: { ok: true, transitioned: true, record: null },
            },
          }),
        );
      });
    });

    await removeBrowserCaptureDraft(id, actorKey);
    expect(sent[0].command).toBe('delete');
    expect(sent[0]).not.toHaveProperty('draft');
    expect(await browserCaptureActorFingerprint(actorKey)).toMatch(
      /^[0-9a-f]{64}$/u,
    );
  });

  it('accepts only a content-free cleanup tombstone before physical deletion', async () => {
    const sent: Array<Record<string, unknown>> = [];
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      const request = message as Record<string, unknown>;
      sent.push(request);
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            origin: window.location.origin,
            data: {
              source: 'erp4-extension',
              type: 'erp4-browser-capture-response-v1',
              schemaVersion: 1,
              command: request.command,
              id: request.id,
              nonce: request.nonce,
              response: {
                ok: true,
                transitioned: true,
                record: cleanupResponseRecord(),
              },
            },
          }),
        );
      });
    });

    await markBrowserCaptureDraftCleanupPending(id, actorKey);
    expect(sent[0].command).toBe('cleanup');
    expect(sent[0]).not.toHaveProperty('draft');

    vi.restoreAllMocks();
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      const request = message as Record<string, unknown>;
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            origin: window.location.origin,
            data: {
              source: 'erp4-extension',
              type: 'erp4-browser-capture-response-v1',
              schemaVersion: 1,
              command: request.command,
              id: request.id,
              nonce: request.nonce,
              response: {
                ok: true,
                transitioned: false,
                record: null,
              },
            },
          }),
        );
      });
    });
    await expect(
      markBrowserCaptureDraftCleanupPending(id, actorKey),
    ).resolves.toBeUndefined();

    vi.restoreAllMocks();
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      const request = message as Record<string, unknown>;
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            origin: window.location.origin,
            data: {
              source: 'erp4-extension',
              type: 'erp4-browser-capture-response-v1',
              schemaVersion: 1,
              command: request.command,
              id: request.id,
              nonce: request.nonce,
              response: {
                ok: true,
                transitioned: false,
                record: { ...cleanupResponseRecord(), draft },
              },
            },
          }),
        );
      });
    });
    await expect(getBrowserCaptureDraft(id, actorKey)).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('keeps the backend-aligned organization group bound through bridge normalization', async () => {
    let groupCount = 21;
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      const request = message as Record<string, unknown>;
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            origin: window.location.origin,
            data: {
              source: 'erp4-extension',
              type: 'erp4-browser-capture-response-v1',
              schemaVersion: 1,
              command: request.command,
              id: request.id,
              nonce: request.nonce,
              response: {
                ok: true,
                transitioned: false,
                record: organizationPendingResponseRecord(groupCount),
              },
            },
          }),
        );
      });
    });

    for (const acceptedCount of [21, 100]) {
      groupCount = acceptedCount;
      const value = await getBrowserCaptureDraft(id, actorKey);
      expect(value?.lifecycle).toBe('pending');
      if (!value || value.lifecycle === 'cleanup_pending') {
        throw new Error('expected pending content record');
      }
      expect(value.pendingIntent?.organizationGroupAccountIds).toHaveLength(
        acceptedCount,
      );
    }

    groupCount = 101;
    await expect(getBrowserCaptureDraft(id, actorKey)).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('rejects success responses that violate command-specific lifecycle invariants', async () => {
    let response: Record<string, unknown> = {};
    vi.spyOn(window, 'postMessage').mockImplementation((message) => {
      const request = message as Record<string, unknown>;
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: window,
            origin: window.location.origin,
            data: {
              source: 'erp4-extension',
              type: 'erp4-browser-capture-response-v1',
              schemaVersion: 1,
              command: request.command,
              id: request.id,
              nonce: request.nonce,
              response,
            },
          }),
        );
      });
    });

    const expectInvalid = async (operation: () => Promise<unknown>) => {
      await expect(operation()).rejects.toMatchObject({
        code: 'invalid_request',
      });
    };
    response = { ok: true, transitioned: 'yes', record: responseRecord() };
    await expectInvalid(() => getBrowserCaptureDraft(id, actorKey));
    response = { ok: true, transitioned: false };
    await expectInvalid(() => getBrowserCaptureDraft(id, actorKey));
    response = { ok: true, transitioned: true, record: responseRecord() };
    await expectInvalid(() => getBrowserCaptureDraft(id, actorKey));
    response = { ok: true, transitioned: true, record: responseRecord() };
    await expectInvalid(() =>
      markBrowserCaptureDraftPending(
        id,
        actorKey,
        operationId,
        {
          selectedFields: ['title'],
          scope: 'personal',
          organizationGroupAccountIds: [],
          sourceType: 'web',
        },
        draft,
      ),
    );
    response = { ok: true, transitioned: false, record: responseRecord() };
    await expectInvalid(() =>
      markBrowserCaptureDraftStaged(id, actorKey, operationId),
    );
    response = { ok: true, transitioned: true, record: null };
    await expectInvalid(() =>
      markBrowserCaptureDraftCleanupPending(id, actorKey),
    );
    response = { ok: true, transitioned: true, record: responseRecord() };
    await expectInvalid(() => removeBrowserCaptureDraft(id, actorKey));

    const otherId = 'f'.repeat(32);
    response = {
      ok: true,
      transitioned: false,
      record: { ...responseRecord(), id: otherId },
    };
    await expectInvalid(() => getBrowserCaptureDraft(id, actorKey));
    response = {
      ok: true,
      transitioned: true,
      record: { ...responseRecord('pending'), id: otherId },
    };
    await expectInvalid(() =>
      markBrowserCaptureDraftPending(
        id,
        actorKey,
        operationId,
        {
          selectedFields: ['title'],
          scope: 'personal',
          organizationGroupAccountIds: [],
          sourceType: 'web',
        },
        draft,
      ),
    );
    response = {
      ok: true,
      transitioned: true,
      record: { ...responseRecord(), id: otherId },
    };
    await expectInvalid(() =>
      markBrowserCaptureDraftStaged(id, actorKey, operationId),
    );
    response = {
      ok: true,
      transitioned: true,
      record: { ...cleanupResponseRecord(), id: otherId },
    };
    await expectInvalid(() =>
      markBrowserCaptureDraftCleanupPending(id, actorKey),
    );
  });

  it('persists only a bounded content-free terminal fence across reloads', () => {
    const now = Date.parse('2026-08-15T00:00:00.000Z');
    markBrowserCaptureTerminalFence(id, now);

    const fenceKey = Object.keys(window.localStorage).find((key) =>
      key.endsWith(id),
    );
    expect(fenceKey).toBeDefined();
    const serialized = fenceKey
      ? (window.localStorage.getItem(fenceKey) ?? '')
      : '';
    expect(serialized).not.toContain(requestKey);
    expect(serialized).not.toContain(draft.selectedText);
    expect(hasBrowserCaptureTerminalFence(id, now + 1)).toBe(true);
    expect(
      hasBrowserCaptureTerminalFence(
        id,
        now + BROWSER_CAPTURE_TERMINAL_FENCE_TTL_MS + 1,
      ),
    ).toBe(false);

    markBrowserCaptureTerminalFence(id, now);
    clearBrowserCaptureTerminalFence(id);
    expect(hasBrowserCaptureTerminalFence(id, now + 1)).toBe(false);

    markBrowserCaptureTerminalFence(id, now);
    if (!fenceKey) throw new Error('expected terminal fence key');
    window.localStorage.setItem(fenceKey, '{"schemaVersion":2}');
    expect(() => hasBrowserCaptureTerminalFence(id, now + 1)).toThrowError(
      /invalid_request/u,
    );
  });

  it('broadcasts content-free lifecycle invalidation only to other channel objects', () => {
    const instances: FakeBroadcastChannel[] = [];
    class FakeBroadcastChannel {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      posted: unknown[] = [];
      closed = false;

      constructor(readonly name: string) {
        instances.push(this);
      }

      postMessage(value: unknown) {
        this.posted.push(value);
      }

      close() {
        this.closed = true;
      }
    }
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    const received: unknown[] = [];
    const unsubscribe = subscribeBrowserCaptureLifecycle((message) =>
      received.push(message),
    );

    publishBrowserCaptureLifecycle(id, 'pending');
    expect(instances).toHaveLength(1);
    expect(instances[0].posted).toEqual([
      { schemaVersion: 1, draftId: id, lifecycle: 'pending' },
    ]);
    expect(received).toEqual([]);

    instances[0].onmessage?.(
      new MessageEvent('message', {
        data: { schemaVersion: 1, draftId: id, lifecycle: 'terminal' },
      }),
    );
    expect(received).toEqual([
      { schemaVersion: 1, draftId: id, lifecycle: 'terminal' },
    ]);

    markBrowserCaptureTerminalFence(id);
    const fenceKey = Object.keys(window.localStorage).find((key) =>
      key.endsWith(id),
    );
    if (!fenceKey) throw new Error('expected terminal fence key');
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: fenceKey,
        newValue: window.localStorage.getItem(fenceKey),
      }),
    );
    expect(received).toEqual([
      { schemaVersion: 1, draftId: id, lifecycle: 'terminal' },
      { schemaVersion: 1, draftId: id, lifecycle: 'terminal' },
    ]);
    unsubscribe();
    expect(instances[0].closed).toBe(true);
  });
});

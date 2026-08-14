import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  browserCaptureActorFingerprint,
  getBrowserCaptureDraft,
  markBrowserCaptureDraftPending,
  publishBrowserCaptureLifecycle,
  removeBrowserCaptureDraft,
  subscribeBrowserCaptureLifecycle,
} from './browserCaptureBridge';

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
      expect(value?.pendingIntent?.organizationGroupAccountIds).toHaveLength(
        acceptedCount,
      );
    }

    groupCount = 101;
    await expect(getBrowserCaptureDraft(id, actorKey)).rejects.toMatchObject({
      code: 'invalid_request',
    });
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
        data: { schemaVersion: 1, draftId: id, lifecycle: 'cleanup_pending' },
      }),
    );
    expect(received).toEqual([
      { schemaVersion: 1, draftId: id, lifecycle: 'cleanup_pending' },
    ]);
    unsubscribe();
    expect(instances[0].closed).toBe(true);
  });
});

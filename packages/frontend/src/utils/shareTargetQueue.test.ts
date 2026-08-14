import {
  IDBKeyRange as fakeIDBKeyRange,
  indexedDB as fakeIndexedDB,
} from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IncomingKnowledgeCaptureDraft } from '../sections/knowledge-hub/knowledgeCaptureModel';
import {
  getShareTargetDraft,
  claimShareTargetDraft,
  createShareTargetPendingOperationId,
  isOpaqueShareTargetDraftId,
  listShareTargetDrafts,
  markShareTargetDraftCleanupPending,
  markShareTargetDraftPending,
  markShareTargetDraftStaged,
  normalizeShareTargetPendingIntent,
  publishShareTargetLifecycle,
  purgeExpiredShareTargetDrafts,
  removeShareTargetDraft,
  SHARE_TARGET_DB_NAME,
  SHARE_TARGET_DRAFT_TTL_MS,
  SHARE_TARGET_LIFECYCLE_CHANNEL,
  SHARE_TARGET_QUEUE_LIMIT,
  SHARE_TARGET_STORE_NAME,
  storeShareTargetDraftRecord,
  subscribeShareTargetLifecycle,
  type ShareTargetDraftRecord,
} from './shareTargetQueue';

const originalIndexedDb = Object.getOwnPropertyDescriptor(
  globalThis,
  'indexedDB',
);
const originalIdbKeyRange = Object.getOwnPropertyDescriptor(
  globalThis,
  'IDBKeyRange',
);
const originalBroadcastChannel = Object.getOwnPropertyDescriptor(
  globalThis,
  'BroadcastChannel',
);
const baseTime = Date.parse('2026-08-14T00:00:00.000Z');

function draft(index: number): IncomingKnowledgeCaptureDraft {
  return {
    schemaVersion: 1,
    channel: 'pwa_share_target',
    title: `Synthetic title ${index}`,
    url: `https://example.invalid/articles/${index}`,
    selectedText: `Synthetic selected text ${index}`,
    description: null,
    author: null,
    publishedAt: null,
    capturedAt: new Date(baseTime + index * 1000).toISOString(),
  };
}

function record(index: number): ShareTargetDraftRecord {
  const createdAt = new Date(baseTime + index * 1000).toISOString();
  return {
    id: index.toString(16).padStart(32, '0'),
    requestKey: (index + 100).toString(16).padStart(32, '0'),
    claimedByActorHash: null,
    lifecycle: 'staged',
    pendingOperationId: null,
    pendingIntent: null,
    schemaVersion: 1,
    draft: draft(index),
    createdAt,
    expiresAt: new Date(
      Date.parse(createdAt) + SHARE_TARGET_DRAFT_TTL_MS,
    ).toISOString(),
  };
}

async function deleteDatabase() {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(SHARE_TARGET_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('share_target_test_database_blocked'));
  });
}

describe('shareTargetQueue', () => {
  it('uses the backend-aligned organization group and identifier bounds', () => {
    const buildIntent = (count: number, idLength = 20) => ({
      selectedFields: ['title'],
      scope: 'organization',
      organizationGroupAccountIds: Array.from(
        { length: count },
        (_value, index) =>
          `${String(index).padStart(3, '0')}${'g'.repeat(idLength - 3)}`,
      ),
      sourceType: 'web',
    });
    expect(normalizeShareTargetPendingIntent(buildIntent(21))).not.toBeNull();
    expect(normalizeShareTargetPendingIntent(buildIntent(100))).not.toBeNull();
    expect(normalizeShareTargetPendingIntent(buildIntent(101))).toBeNull();
    expect(
      normalizeShareTargetPendingIntent(buildIntent(1, 100)),
    ).not.toBeNull();
    expect(normalizeShareTargetPendingIntent(buildIntent(1, 101))).toBeNull();
  });

  beforeEach(async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: fakeIndexedDB,
    });
    Object.defineProperty(globalThis, 'IDBKeyRange', {
      configurable: true,
      value: fakeIDBKeyRange,
    });
    await deleteDatabase();
  });

  afterEach(async () => {
    await deleteDatabase();
    if (originalIndexedDb) {
      Object.defineProperty(globalThis, 'indexedDB', originalIndexedDb);
    } else {
      Reflect.deleteProperty(
        globalThis as typeof globalThis & { indexedDB?: unknown },
        'indexedDB',
      );
    }
    if (originalIdbKeyRange) {
      Object.defineProperty(globalThis, 'IDBKeyRange', originalIdbKeyRange);
    } else {
      Reflect.deleteProperty(
        globalThis as typeof globalThis & { IDBKeyRange?: unknown },
        'IDBKeyRange',
      );
    }
    if (originalBroadcastChannel) {
      Object.defineProperty(
        globalThis,
        'BroadcastChannel',
        originalBroadcastChannel,
      );
    } else {
      Reflect.deleteProperty(
        globalThis as typeof globalThis & { BroadcastChannel?: unknown },
        'BroadcastChannel',
      );
    }
  });

  it('closes a late IndexedDB connection after an open request was blocked', async () => {
    type MutableOpenRequest = {
      onblocked: ((event: Event) => void) | null;
      onsuccess: ((event: Event) => void) | null;
      onerror: ((event: Event) => void) | null;
      onupgradeneeded: ((event: Event) => void) | null;
      result?: { close: () => void };
      error: DOMException | null;
    };
    const close = vi.fn();
    const request: MutableOpenRequest = {
      onblocked: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      error: null,
    };
    const blockedFactory = {
      open: () => {
        queueMicrotask(() => {
          request.onblocked?.(new Event('blocked'));
          queueMicrotask(() => {
            request.result = { close };
            request.onsuccess?.(new Event('success'));
          });
        });
        return request as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: blockedFactory,
    });

    await expect(getShareTargetDraft(record(1).id, baseTime)).rejects.toThrow(
      'share_target_storage_unavailable',
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: fakeIndexedDB,
    });
  });

  it('accepts only opaque 128-bit-or-longer identifiers', () => {
    expect(isOpaqueShareTargetDraftId('a'.repeat(32))).toBe(true);
    expect(isOpaqueShareTargetDraftId('a'.repeat(21))).toBe(false);
    expect(isOpaqueShareTargetDraftId('../sensitive')).toBe(false);
  });

  it('stores, orders, reads, and removes strict records', async () => {
    await storeShareTargetDraftRecord(record(2), baseTime);
    await storeShareTargetDraftRecord(record(1), baseTime);

    await expect(listShareTargetDrafts(baseTime)).resolves.toEqual([
      record(1),
      record(2),
    ]);
    await expect(getShareTargetDraft(record(2).id, baseTime)).resolves.toEqual(
      record(2),
    );

    await removeShareTargetDraft(record(2).id, undefined, baseTime);
    await expect(
      getShareTargetDraft(record(2).id, baseTime),
    ).resolves.toBeNull();
  });

  it('atomically binds a draft to the first authenticated actor without persisting the raw actor ID', async () => {
    const value = record(1);
    await storeShareTargetDraftRecord(value, baseTime);

    const claimed = await claimShareTargetDraft(
      value.id,
      'synthetic-user-a',
      baseTime,
    );
    expect(claimed?.claimedByActorHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(claimed)).not.toContain('synthetic-user-a');
    await expect(
      claimShareTargetDraft(value.id, 'synthetic-user-a', baseTime),
    ).resolves.toEqual(claimed);
    await expect(
      claimShareTargetDraft(value.id, 'synthetic-user-b', baseTime),
    ).resolves.toBeNull();
  });

  it('converges simultaneous different-actor claims onto exactly one actor', async () => {
    const value = record(1);
    await storeShareTargetDraftRecord(value, baseTime);

    const claims = await Promise.all([
      claimShareTargetDraft(value.id, 'synthetic-race-a', baseTime),
      claimShareTargetDraft(value.id, 'synthetic-race-b', baseTime),
    ]);

    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);
  });

  it('serializes an unauthenticated discard against a concurrent actor claim', async () => {
    const value = record(1);
    await storeShareTargetDraftRecord(value, baseTime);

    const [claimResult, removeResult] = await Promise.allSettled([
      claimShareTargetDraft(value.id, 'synthetic-race-owner', baseTime),
      removeShareTargetDraft(value.id, undefined, baseTime),
    ]);
    const remaining = await getShareTargetDraft(value.id, baseTime);

    if (remaining === null) {
      expect(claimResult).toMatchObject({
        status: 'fulfilled',
        value: null,
      });
      expect(removeResult).toMatchObject({ status: 'fulfilled' });
      return;
    }

    expect(claimResult.status).toBe('fulfilled');
    if (claimResult.status === 'fulfilled') {
      expect(claimResult.value?.claimedByActorHash).toMatch(/^[a-f0-9]{64}$/u);
    }
    expect(removeResult).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        message: 'share_target_actor_mismatch',
      }),
    });
    expect(remaining.claimedByActorHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('allows only the claiming actor to remove a current claimed draft', async () => {
    const value = record(1);
    await storeShareTargetDraftRecord(value, baseTime);
    await claimShareTargetDraft(value.id, 'synthetic-owner', baseTime);

    await expect(
      removeShareTargetDraft(value.id, undefined, baseTime),
    ).rejects.toThrow('share_target_actor_mismatch');
    await expect(
      removeShareTargetDraft(value.id, 'synthetic-outsider', baseTime),
    ).rejects.toThrow('share_target_actor_mismatch');
    await expect(
      getShareTargetDraft(value.id, baseTime),
    ).resolves.not.toBeNull();

    await expect(
      removeShareTargetDraft(value.id, 'synthetic-owner', baseTime),
    ).resolves.toBeUndefined();
    await expect(getShareTargetDraft(value.id, baseTime)).resolves.toBeNull();
  });

  it('persists a pending intent, blocks deletion, and permits a safe pre-dispatch reset', async () => {
    const value = record(1);
    const exactDraft = { ...draft(1), title: 'Edited exact title' };
    const actorKey = 'bff:synthetic-account';
    const operationId = 'a'.repeat(48);
    const intent = {
      selectedFields: ['title', 'selectedText'] as const,
      scope: 'personal' as const,
      organizationGroupAccountIds: [],
      sourceType: 'web' as const,
    };
    await storeShareTargetDraftRecord(value, baseTime);
    await claimShareTargetDraft(value.id, actorKey, baseTime);
    await markShareTargetDraftPending(
      value.id,
      actorKey,
      operationId,
      { ...intent, selectedFields: [...intent.selectedFields] },
      exactDraft,
      baseTime,
    );

    const pending = await getShareTargetDraft(value.id, baseTime);
    expect(pending?.lifecycle).toBe('pending');
    expect(pending?.pendingIntent).toEqual(intent);
    expect(pending?.draft).toEqual(exactDraft);
    await expect(
      markShareTargetDraftPending(
        value.id,
        actorKey,
        'b'.repeat(48),
        { ...intent, selectedFields: [...intent.selectedFields] },
        { ...exactDraft, title: 'Conflicting edit' },
        baseTime,
      ),
    ).resolves.toMatchObject({
      transitioned: false,
      draft: exactDraft,
      pendingIntent: intent,
    });
    await expect(
      removeShareTargetDraft(value.id, actorKey, baseTime),
    ).rejects.toThrow('share_target_pending');

    await expect(
      markShareTargetDraftStaged(value.id, actorKey, 'b'.repeat(48), baseTime),
    ).rejects.toThrow('share_target_invalid_transition');
    await markShareTargetDraftStaged(value.id, actorKey, operationId, baseTime);
    expect(await getShareTargetDraft(value.id, baseTime)).toMatchObject({
      lifecycle: 'staged',
      pendingOperationId: null,
      pendingIntent: null,
      draft: exactDraft,
    });
  });

  it('replaces terminal content with a cleanup-only tombstone before deletion', async () => {
    const value = record(1);
    const actorKey = 'header:synthetic-owner';
    await storeShareTargetDraftRecord(value, baseTime);
    await claimShareTargetDraft(value.id, actorKey, baseTime);
    await markShareTargetDraftCleanupPending(
      value.id,
      actorKey,
      false,
      baseTime,
    );

    const tombstone = await getShareTargetDraft(value.id, baseTime);
    expect(tombstone).toMatchObject({
      requestKey: null,
      draft: null,
      lifecycle: 'cleanup_pending',
      pendingOperationId: null,
      pendingIntent: null,
    });
    expect(JSON.stringify(tombstone)).not.toContain('Synthetic selected text');
    await removeShareTargetDraft(value.id, actorKey, baseTime);
    await expect(getShareTargetDraft(value.id, baseTime)).resolves.toBeNull();
  });

  it('grants one pending operation ownership across concurrent tabs', async () => {
    const value = record(1);
    const actorKey = 'header:synthetic-owner';
    const intent = {
      selectedFields: ['title'] as const,
      scope: 'personal' as const,
      organizationGroupAccountIds: [],
      sourceType: 'web' as const,
    };
    await storeShareTargetDraftRecord(value, baseTime);
    await claimShareTargetDraft(value.id, actorKey, baseTime);

    const results = await Promise.all([
      markShareTargetDraftPending(
        value.id,
        actorKey,
        'a'.repeat(48),
        { ...intent, selectedFields: [...intent.selectedFields] },
        value.draft!,
        baseTime,
      ),
      markShareTargetDraftPending(
        value.id,
        actorKey,
        'b'.repeat(48),
        { ...intent, selectedFields: [...intent.selectedFields] },
        value.draft!,
        baseTime,
      ),
    ]);

    expect(results.filter((result) => result.transitioned)).toHaveLength(1);
    expect(results.filter((result) => !result.transitioned)).toHaveLength(1);
    expect(
      (await getShareTargetDraft(value.id, baseTime))?.pendingOperationId,
    ).toMatch(/^(a{48}|b{48})$/u);
  });

  it('keeps legacy pending rows read-only when operation ownership is absent', async () => {
    const value = record(1);
    const actorKey = 'header:synthetic-owner';
    const intent = {
      selectedFields: ['title'] as const,
      scope: 'personal' as const,
      organizationGroupAccountIds: [],
      sourceType: 'web' as const,
    };
    await storeShareTargetDraftRecord(value, baseTime);
    await claimShareTargetDraft(value.id, actorKey, baseTime);
    await markShareTargetDraftPending(
      value.id,
      actorKey,
      'a'.repeat(48),
      { ...intent, selectedFields: [...intent.selectedFields] },
      value.draft!,
      baseTime,
    );

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = fakeIndexedDB.open(SHARE_TARGET_DB_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        SHARE_TARGET_STORE_NAME,
        'readwrite',
      );
      const store = transaction.objectStore(SHARE_TARGET_STORE_NAME);
      const getRequest = store.get(value.id);
      getRequest.onsuccess = () => {
        try {
          const legacy = { ...getRequest.result };
          delete legacy.pendingOperationId;
          store.put(legacy);
        } catch (error) {
          reject(error);
          transaction.abort();
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();

    await expect(
      getShareTargetDraft(value.id, baseTime),
    ).resolves.toMatchObject({
      lifecycle: 'pending',
      pendingOperationId: null,
      pendingIntent: intent,
    });
    await expect(
      markShareTargetDraftStaged(value.id, actorKey, 'a'.repeat(48), baseTime),
    ).rejects.toThrow('share_target_invalid_transition');
  });

  it('creates an opaque pending operation ID only from secure random bytes', () => {
    expect(
      createShareTargetPendingOperationId({
        getRandomValues(value) {
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength).fill(
            0xab,
          );
          return value;
        },
      } as Crypto),
    ).toBe('ab'.repeat(24));
    expect(() => createShareTargetPendingOperationId({} as Crypto)).toThrow(
      'share_target_secure_random_unavailable',
    );
  });

  it('broadcasts bounded lifecycle state to other tabs but never to the sender tab', () => {
    type Handler = ((event: MessageEvent<unknown>) => void) | null;
    class FakeBroadcastChannel {
      static instances: FakeBroadcastChannel[] = [];
      onmessage: Handler = null;
      closed = false;

      constructor(readonly name: string) {
        FakeBroadcastChannel.instances.push(this);
      }

      postMessage(value: unknown) {
        for (const channel of FakeBroadcastChannel.instances) {
          if (
            channel !== this &&
            channel.name === this.name &&
            !channel.closed
          ) {
            channel.onmessage?.({ data: value } as MessageEvent<unknown>);
          }
        }
      }

      close() {
        this.closed = true;
      }
    }
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: FakeBroadcastChannel,
    });
    const received: unknown[] = [];
    const unsubscribe = subscribeShareTargetLifecycle((message) =>
      received.push(message),
    );
    const id = record(1).id;

    publishShareTargetLifecycle(id, 'pending');
    expect(received).toEqual([]);

    const remoteTab = new FakeBroadcastChannel(SHARE_TARGET_LIFECYCLE_CHANNEL);
    remoteTab.postMessage({
      schemaVersion: 1,
      draftId: id,
      lifecycle: 'pending',
    });
    expect(received).toEqual([
      { schemaVersion: 1, draftId: id, lifecycle: 'pending' },
    ]);
    expect(JSON.stringify(received)).not.toContain('Synthetic selected text');

    const subscriber = FakeBroadcastChannel.instances[0];
    subscriber?.onmessage?.({
      data: { schemaVersion: 1, draftId: '../invalid', lifecycle: 'pending' },
    } as MessageEvent<unknown>);
    subscriber?.onmessage?.({
      data: { schemaVersion: 1, draftId: id, lifecycle: 'unknown' },
    } as MessageEvent<unknown>);
    expect(received).toHaveLength(1);
    remoteTab.close();
    unsubscribe();
    expect(subscriber?.closed).toBe(true);
  });

  it('rejects the eleventh current draft without evicting existing drafts', async () => {
    for (let index = 1; index <= SHARE_TARGET_QUEUE_LIMIT; index += 1) {
      await storeShareTargetDraftRecord(record(index), baseTime);
    }

    await expect(
      storeShareTargetDraftRecord(record(11), baseTime),
    ).rejects.toThrow('share_target_queue_full');
    await expect(listShareTargetDrafts(baseTime)).resolves.toHaveLength(10);
  });

  it('purges expired records without extending their absolute TTL', async () => {
    const value = record(1);
    await storeShareTargetDraftRecord(value, baseTime);

    await expect(
      getShareTargetDraft(value.id, Date.parse(value.expiresAt) - 1),
    ).resolves.toEqual(value);
    await expect(
      getShareTargetDraft(value.id, Date.parse(value.expiresAt)),
    ).resolves.toBeNull();
    await expect(
      listShareTargetDrafts(Date.parse(value.expiresAt)),
    ).resolves.toEqual([]);
  });

  it('physically purges every expired record at the next cleanup opportunity', async () => {
    const value = record(1);
    await storeShareTargetDraftRecord(value, baseTime);

    await expect(
      purgeExpiredShareTargetDrafts(Date.parse(value.expiresAt)),
    ).resolves.toBe(1);
    await expect(
      getShareTargetDraft(value.id, Date.parse(value.expiresAt)),
    ).resolves.toBeNull();
  });

  it('rejects malformed records and fails closed without IndexedDB', async () => {
    await expect(
      storeShareTargetDraftRecord({
        ...record(1),
        draft: { ...draft(1), url: 'javascript:alert(1)' },
      }),
    ).rejects.toThrow('share_target_invalid_record');

    Reflect.deleteProperty(
      globalThis as typeof globalThis & { indexedDB?: unknown },
      'indexedDB',
    );
    await expect(getShareTargetDraft(record(1).id)).rejects.toThrow(
      'share_target_storage_unavailable',
    );
  });
});

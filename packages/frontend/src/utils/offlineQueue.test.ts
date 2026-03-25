import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';

vi.mock('../api', () => ({
  api: vi.fn(),
}));

import { api } from '../api';
import {
  enqueueOfflineItem,
  isOfflineError,
  listOfflineItems,
  processOfflineQueue,
  removeOfflineItem,
} from './offlineQueue';

const DB_NAME = 'erp4-offline-queue';
const SEQ_KEY = 'erp4-queue-seq';
const originalIndexedDbDescriptor = Object.getOwnPropertyDescriptor(
  window,
  'indexedDB',
);
const navigatorPrototype = Object.getPrototypeOf(navigator) as Navigator;
const originalNavigatorOnLineDescriptor = Object.getOwnPropertyDescriptor(
  navigatorPrototype,
  'onLine',
);

async function deleteOfflineQueueDatabase() {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

describe('offlineQueue', () => {
  beforeEach(async () => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: fakeIndexedDB,
    });
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: fakeIndexedDB,
    });
    await deleteOfflineQueueDatabase();
    window.localStorage.clear();
    vi.mocked(api).mockReset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    window.localStorage.removeItem(SEQ_KEY);
    await deleteOfflineQueueDatabase();
    if (originalIndexedDbDescriptor) {
      Object.defineProperty(window, 'indexedDB', originalIndexedDbDescriptor);
      Object.defineProperty(
        globalThis,
        'indexedDB',
        originalIndexedDbDescriptor,
      );
    } else {
      Reflect.deleteProperty(
        window as Window & { indexedDB?: unknown },
        'indexedDB',
      );
      Reflect.deleteProperty(
        globalThis as typeof globalThis & { indexedDB?: unknown },
        'indexedDB',
      );
    }
    if (originalNavigatorOnLineDescriptor) {
      Object.defineProperty(
        navigatorPrototype,
        'onLine',
        originalNavigatorOnLineDescriptor,
      );
    } else {
      Reflect.deleteProperty(
        navigatorPrototype as Navigator & { onLine?: unknown },
        'onLine',
      );
    }
  });

  it('detects offline errors from navigator state and error shapes', () => {
    Object.defineProperty(navigatorPrototype, 'onLine', {
      configurable: true,
      value: false,
    });
    expect(isOfflineError(new Error('anything'))).toBe(true);

    Object.defineProperty(navigatorPrototype, 'onLine', {
      configurable: true,
      value: true,
    });
    expect(isOfflineError(new TypeError('network'))).toBe(true);
    expect(isOfflineError(new Error('Failed to fetch'))).toBe(true);
    expect(
      isOfflineError('NetworkError when attempting to fetch resource.'),
    ).toBe(true);
    expect(isOfflineError(new Error('validation failed'))).toBe(false);
  });

  it('enqueues, lists, and removes items in order', async () => {
    const first = await enqueueOfflineItem({
      kind: 'time-entry',
      label: 'first',
      requests: [{ path: '/time-entries' }],
    });
    const second = await enqueueOfflineItem({
      kind: 'expense',
      label: 'second',
      requests: [{ path: '/expenses' }],
    });

    const items = await listOfflineItems();
    expect(items.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(items.map((item) => item.order)).toEqual([1, 2]);

    await removeOfflineItem(first.id);

    await expect(listOfflineItems()).resolves.toEqual([items[1]]);
  });

  it('processes queued requests and removes completed items', async () => {
    vi.mocked(api).mockResolvedValue({ ok: true });
    await enqueueOfflineItem({
      kind: 'invoice',
      label: 'invoice',
      requests: [{ path: '/invoices', method: 'POST', body: { id: 'inv-1' } }],
    });

    const result = await processOfflineQueue();

    expect(result).toEqual({ processed: 1 });
    expect(api).toHaveBeenCalledWith('/invoices', {
      method: 'POST',
      body: JSON.stringify({ id: 'inv-1' }),
    });
    await expect(listOfflineItems()).resolves.toEqual([]);
  });

  it('marks items pending and stops on offline errors', async () => {
    vi.mocked(api).mockRejectedValue(new TypeError('Failed to fetch'));
    const item = await enqueueOfflineItem({
      kind: 'invoice',
      label: 'offline',
      requests: [{ path: '/invoices' }],
    });

    const result = await processOfflineQueue();
    const items = await listOfflineItems();

    expect(result).toEqual({ processed: 0, stoppedBy: 'offline' });
    expect(items).toEqual([
      expect.objectContaining({
        id: item.id,
        status: 'pending',
        retryCount: 0,
        lastError: 'Failed to fetch',
      }),
    ]);
  });

  it('marks items failed on non-offline errors', async () => {
    vi.mocked(api).mockRejectedValue(new Error('validation failed'));
    const item = await enqueueOfflineItem({
      kind: 'invoice',
      label: 'failed',
      requests: [{ path: '/invoices' }],
    });

    const result = await processOfflineQueue();
    const items = await listOfflineItems();

    expect(result).toEqual({
      processed: 0,
      stoppedBy: 'failed',
      failedItem: expect.objectContaining({
        id: item.id,
        status: 'failed',
        retryCount: 1,
        lastError: 'validation failed',
      }),
    });
    expect(items).toEqual([
      expect.objectContaining({
        id: item.id,
        status: 'failed',
        retryCount: 1,
        lastError: 'validation failed',
      }),
    ]);
  });

  it('returns locked when another processor is already running', async () => {
    const releaseRequestRef: { current: null | (() => void) } = {
      current: null,
    };
    vi.mocked(api).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRequestRef.current = () => resolve({ ok: true });
        }),
    );
    await enqueueOfflineItem({
      kind: 'invoice',
      label: 'locked',
      requests: [{ path: '/invoices' }],
    });

    const firstRunPromise = processOfflineQueue();
    await vi.waitFor(() => {
      expect(api).toHaveBeenCalledTimes(1);
    });

    await expect(processOfflineQueue()).resolves.toEqual({
      processed: 0,
      stoppedBy: 'locked',
    });

    if (releaseRequestRef.current) {
      releaseRequestRef.current();
    }
    await expect(firstRunPromise).resolves.toEqual({ processed: 1 });
  });
});

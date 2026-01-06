import { api } from '../api';

export type QueueRequest = {
  path: string;
  method?: string;
  body?: unknown;
};

export type QueueItem = {
  id: string;
  kind: string;
  label: string;
  requests: QueueRequest[];
  cursor: number;
  status: 'pending' | 'failed';
  retryCount: number;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
  order: number;
};

type QueueRecord = QueueItem;

type ProcessResult = {
  processed: number;
  stoppedBy?: 'offline' | 'failed' | 'locked';
  failedItem?: QueueItem;
};

const DB_NAME = 'erp4-offline-queue';
const STORE_NAME = 'queue';
const DB_VERSION = 1;
const SEQ_KEY = 'erp4-queue-seq';
let isProcessing = false;

function nextOrder(): number {
  try {
    const raw = window.localStorage.getItem(SEQ_KEY);
    const current = raw ? Number(raw) : 0;
    const next = Number.isFinite(current) ? current + 1 : 1;
    window.localStorage.setItem(SEQ_KEY, String(next));
    return next;
  } catch {
    return Date.now();
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  if (!('indexedDB' in window)) {
    throw new Error('indexedDB is not available');
  }
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = fn(store);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
    tx.onabort = () => db.close();
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
  });
}

function normalizeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'unknown_error';
  }
}

export function isOfflineError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  if (err instanceof TypeError) return true;
  const message = normalizeErrorMessage(err).toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network error')
  );
}

function generateQueueId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueueOfflineItem(input: {
  kind: string;
  label: string;
  requests: QueueRequest[];
  cursor?: number;
}): Promise<QueueItem> {
  const now = new Date().toISOString();
  const record: QueueRecord = {
    id: generateQueueId(),
    kind: input.kind,
    label: input.label,
    requests: input.requests,
    cursor: input.cursor ?? 0,
    status: 'pending',
    retryCount: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    order: nextOrder(),
  };
  await withStore('readwrite', (store) => store.put(record));
  return record;
}

export async function listOfflineItems(): Promise<QueueItem[]> {
  try {
    const items = await withStore<QueueRecord[]>('readonly', (store) =>
      store.getAll(),
    );
    return (items || []).slice().sort((a, b) => {
      const orderDiff = a.order - b.order;
      if (orderDiff !== 0) return orderDiff;
      if (a.createdAt < b.createdAt) return -1;
      if (a.createdAt > b.createdAt) return 1;
      return 0;
    });
  } catch {
    return [];
  }
}

export async function removeOfflineItem(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
}

async function updateOfflineItem(
  id: string,
  updater: (item: QueueItem) => QueueItem,
): Promise<QueueItem | null> {
  const current = await withStore<QueueRecord | undefined>(
    'readonly',
    (store) => store.get(id),
  );
  if (!current) return null;
  const next = updater({ ...current });
  await withStore('readwrite', (store) => store.put(next));
  return next;
}

async function sendRequest(req: QueueRequest) {
  const body = req.body !== undefined ? JSON.stringify(req.body) : undefined;
  return api(req.path, {
    method: req.method || 'POST',
    body,
  });
}

export async function processOfflineQueue(options?: {
  includeFailed?: boolean;
  targetId?: string;
}): Promise<ProcessResult> {
  if (isProcessing) {
    return { processed: 0, stoppedBy: 'locked' };
  }
  isProcessing = true;
  try {
    const items = await listOfflineItems();
    const filtered = options?.targetId
      ? items.filter((item) => item.id === options.targetId)
      : items;
    let processed = 0;
    for (const item of filtered) {
      if (item.status === 'failed' && !options?.includeFailed) {
        continue;
      }
      let cursor = item.cursor || 0;
      let current = item;
      for (let i = cursor; i < item.requests.length; i += 1) {
        try {
          await sendRequest(item.requests[i]);
          cursor = i + 1;
          if (cursor < item.requests.length) {
            current =
              (await updateOfflineItem(item.id, (prev) => ({
                ...prev,
                cursor,
                status: 'pending',
                updatedAt: new Date().toISOString(),
              }))) ?? current;
          }
        } catch (err) {
          if (isOfflineError(err)) {
            await updateOfflineItem(item.id, (prev) => ({
              ...prev,
              cursor,
              status: 'pending',
              lastError: normalizeErrorMessage(err),
              updatedAt: new Date().toISOString(),
            }));
            return { processed, stoppedBy: 'offline' };
          }
          current =
            (await updateOfflineItem(item.id, (prev) => ({
              ...prev,
              cursor,
              status: 'failed',
              retryCount: (prev.retryCount ?? 0) + 1,
              lastError: normalizeErrorMessage(err),
              updatedAt: new Date().toISOString(),
            }))) ?? current;
          return { processed, stoppedBy: 'failed', failedItem: current };
        }
      }
      await removeOfflineItem(item.id);
      processed += 1;
    }
    return { processed };
  } finally {
    isProcessing = false;
  }
}

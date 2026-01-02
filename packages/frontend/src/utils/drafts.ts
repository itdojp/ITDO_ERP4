type DraftRecord<T> = {
  key: string;
  value: T;
  updatedAt: string;
};

const DB_NAME = 'erp4-drafts';
const STORE_NAME = 'drafts';
const DB_VERSION = 1;
const SESSION_KEY = 'erp4-draft-session';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
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

export function getDraftOwnerId(userId?: string): string {
  if (userId) return userId;
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const generated =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `session-${crypto.randomUUID()}`
        : `session-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(SESSION_KEY, generated);
    return generated;
  } catch {
    return `session-${Math.random().toString(36).slice(2)}`;
  }
}

export async function saveDraft<T>(key: string, value: T): Promise<void> {
  const record: DraftRecord<T> = {
    key,
    value,
    updatedAt: new Date().toISOString(),
  };
  await withStore('readwrite', (store) => store.put(record));
}

export async function loadDraft<T>(key: string): Promise<T | null> {
  try {
    const record = await withStore<DraftRecord<T> | undefined>(
      'readonly',
      (store) => store.get(key),
    );
    return record ? record.value : null;
  } catch {
    return null;
  }
}

export async function clearDraft(key: string): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(key));
  } catch {
    // Swallow errors to avoid blocking the UI on cleanup.
  }
}

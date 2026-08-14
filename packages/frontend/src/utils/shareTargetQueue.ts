import {
  normalizeIncomingKnowledgeCapture,
  type IncomingKnowledgeCaptureDraft,
  type KnowledgeCaptureField,
} from '../sections/knowledge-hub/knowledgeCaptureModel';
import {
  isKnowledgeSourceType,
  type KnowledgeScope,
  type KnowledgeSourceType,
} from '../sections/knowledge-hub/knowledgeHubModel';

export const SHARE_TARGET_DB_NAME = 'erp4-share-target-drafts';
export const SHARE_TARGET_STORE_NAME = 'drafts';
export const SHARE_TARGET_DB_VERSION = 1;
export const SHARE_TARGET_DRAFT_TTL_MS = 60 * 60 * 1000;
export const SHARE_TARGET_QUEUE_LIMIT = 10;
export const SHARE_TARGET_LIFECYCLE_CHANNEL = 'erp4-share-target-lifecycle-v1';
export const KNOWLEDGE_CAPTURE_GROUP_LIMIT = 100;
export const KNOWLEDGE_CAPTURE_GROUP_ID_MAX_LENGTH = 100;

export type ShareTargetLifecycle = 'staged' | 'pending' | 'cleanup_pending';

export type ShareTargetPendingIntent = {
  selectedFields: KnowledgeCaptureField[];
  scope: KnowledgeScope;
  organizationGroupAccountIds: string[];
  sourceType: KnowledgeSourceType;
};

export type ShareTargetDraftRecord = {
  id: string;
  requestKey: string | null;
  claimedByActorHash: string | null;
  lifecycle: ShareTargetLifecycle;
  pendingOperationId: string | null;
  pendingIntent: ShareTargetPendingIntent | null;
  schemaVersion: 1;
  draft: IncomingKnowledgeCaptureDraft | null;
  createdAt: string;
  expiresAt: string;
};

export type ShareTargetLifecycleMessage = {
  schemaVersion: 1;
  draftId: string;
  lifecycle: ShareTargetLifecycle;
};

const actorHashPattern = /^[a-f0-9]{64}$/u;
const fields = new Set<KnowledgeCaptureField>([
  'title',
  'url',
  'selectedText',
  'description',
  'author',
  'publishedAt',
]);
const recordKeys = new Set([
  'id',
  'requestKey',
  'claimedByActorHash',
  'lifecycle',
  'pendingOperationId',
  'pendingIntent',
  'schemaVersion',
  'draft',
  'createdAt',
  'expiresAt',
]);
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

function hasControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? -1;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

export function isOpaqueShareTargetDraftId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 22 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/u.test(value)
  );
}

export function normalizeShareTargetPendingIntent(
  value: unknown,
): ShareTargetPendingIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    'selectedFields',
    'scope',
    'organizationGroupAccountIds',
    'sourceType',
  ]);
  if (
    Object.keys(record).some(
      (key) => forbiddenKeys.has(key) || !allowedKeys.has(key),
    ) ||
    !Array.isArray(record.selectedFields) ||
    record.selectedFields.length === 0 ||
    record.selectedFields.some((field) => !fields.has(field)) ||
    new Set(record.selectedFields).size !== record.selectedFields.length ||
    (record.scope !== 'personal' && record.scope !== 'organization') ||
    !Array.isArray(record.organizationGroupAccountIds) ||
    record.organizationGroupAccountIds.length > KNOWLEDGE_CAPTURE_GROUP_LIMIT ||
    record.organizationGroupAccountIds.some(
      (id) =>
        typeof id !== 'string' ||
        id.length < 1 ||
        id.length > KNOWLEDGE_CAPTURE_GROUP_ID_MAX_LENGTH ||
        hasControlCharacter(id),
    ) ||
    new Set(record.organizationGroupAccountIds).size !==
      record.organizationGroupAccountIds.length ||
    !isKnowledgeSourceType(record.sourceType)
  ) {
    return null;
  }
  if (
    (record.scope === 'personal' &&
      record.organizationGroupAccountIds.length !== 0) ||
    (record.scope === 'organization' &&
      record.organizationGroupAccountIds.length === 0)
  ) {
    return null;
  }
  return {
    selectedFields: [...record.selectedFields] as KnowledgeCaptureField[],
    scope: record.scope,
    organizationGroupAccountIds: [...record.organizationGroupAccountIds],
    sourceType: record.sourceType,
  };
}

function normalizeRecord(value: unknown): ShareTargetDraftRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => forbiddenKeys.has(key) || !recordKeys.has(key),
    ) ||
    record.schemaVersion !== 1 ||
    !isOpaqueShareTargetDraftId(record.id) ||
    (record.claimedByActorHash !== null &&
      (typeof record.claimedByActorHash !== 'string' ||
        !actorHashPattern.test(record.claimedByActorHash))) ||
    typeof record.createdAt !== 'string' ||
    typeof record.expiresAt !== 'string'
  ) {
    return null;
  }
  const createdAt = new Date(record.createdAt);
  const expiresAt = new Date(record.expiresAt);
  if (
    !Number.isFinite(createdAt.getTime()) ||
    !Number.isFinite(expiresAt.getTime()) ||
    createdAt.toISOString() !== record.createdAt ||
    expiresAt.toISOString() !== record.expiresAt ||
    expiresAt.getTime() - createdAt.getTime() !== SHARE_TARGET_DRAFT_TTL_MS
  ) {
    return null;
  }

  const lifecycle =
    record.lifecycle === undefined ? 'staged' : record.lifecycle;
  if (
    lifecycle !== 'staged' &&
    lifecycle !== 'pending' &&
    lifecycle !== 'cleanup_pending'
  ) {
    return null;
  }
  if (lifecycle === 'cleanup_pending') {
    if (
      record.claimedByActorHash === null ||
      record.requestKey !== null ||
      record.draft !== null ||
      record.pendingOperationId != null ||
      record.pendingIntent !== null
    ) {
      return null;
    }
    return {
      id: record.id,
      requestKey: null,
      claimedByActorHash: record.claimedByActorHash,
      lifecycle,
      pendingOperationId: null,
      pendingIntent: null,
      schemaVersion: 1,
      draft: null,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    };
  }

  if (!isOpaqueShareTargetDraftId(record.requestKey)) return null;
  const draft = normalizeIncomingKnowledgeCapture(record.draft);
  if (!draft) return null;
  const pendingIntent =
    lifecycle === 'pending'
      ? normalizeShareTargetPendingIntent(record.pendingIntent)
      : record.pendingIntent === null || record.pendingIntent === undefined
        ? null
        : null;
  const pendingOperationId =
    lifecycle === 'pending' &&
    isOpaqueShareTargetDraftId(record.pendingOperationId)
      ? record.pendingOperationId
      : null;
  if (
    (lifecycle === 'pending' && pendingIntent === null) ||
    (lifecycle === 'staged' &&
      (record.pendingIntent != null || record.pendingOperationId != null))
  ) {
    return null;
  }
  return {
    id: record.id,
    requestKey: record.requestKey,
    claimedByActorHash: record.claimedByActorHash,
    lifecycle,
    // Pending rows written before operation ownership was introduced remain
    // readable for read-only reconciliation, but cannot be reset to staged.
    pendingOperationId,
    pendingIntent,
    schemaVersion: 1,
    draft,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

export function createShareTargetPendingOperationId(
  cryptoValue = globalThis.crypto,
) {
  if (typeof cryptoValue?.getRandomValues !== 'function') {
    throw new Error('share_target_secure_random_unavailable');
  }
  const bytes = new Uint8Array(24);
  cryptoValue.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

async function hashActor(actorKey: string): Promise<string> {
  if (
    actorKey.length < 1 ||
    actorKey.length > 256 ||
    typeof crypto === 'undefined' ||
    !crypto.subtle
  ) {
    throw new Error('share_target_actor_invalid');
  }
  const input = new TextEncoder().encode(
    `erp4:share-target-actor:v1\0${actorKey}`,
  );
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('share_target_storage_unavailable'));
  }
  return new Promise((resolve, reject) => {
    let rejected = false;
    const request = indexedDB.open(
      SHARE_TARGET_DB_NAME,
      SHARE_TARGET_DB_VERSION,
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SHARE_TARGET_STORE_NAME)) {
        const store = database.createObjectStore(SHARE_TARGET_STORE_NAME, {
          keyPath: 'id',
        });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
      }
    };
    request.onsuccess = () => {
      if (rejected) {
        request.result.close();
        return;
      }
      resolve(request.result);
    };
    request.onerror = () => {
      if (rejected) return;
      rejected = true;
      reject(request.error ?? new Error('share_target_storage_unavailable'));
    };
    request.onblocked = () => {
      if (rejected) return;
      rejected = true;
      reject(new Error('share_target_storage_unavailable'));
    };
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('share_target_storage_unavailable'));
  });
}

async function withObjectStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SHARE_TARGET_STORE_NAME, mode);
    const completion = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          transaction.error ?? new Error('share_target_storage_unavailable'),
        );
      transaction.onabort = () =>
        reject(
          transaction.error ?? new Error('share_target_storage_unavailable'),
        );
    });
    const result = await operation(
      transaction.objectStore(SHARE_TARGET_STORE_NAME),
    );
    await completion;
    return result;
  } finally {
    database.close();
  }
}

async function removeInvalidOrExpired(
  store: IDBObjectStore,
  values: unknown[],
  nowMs: number,
) {
  const current: ShareTargetDraftRecord[] = [];
  for (const value of values) {
    const normalized = normalizeRecord(value);
    if (!normalized || new Date(normalized.expiresAt).getTime() <= nowMs) {
      const id =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as { id?: unknown }).id
          : null;
      if (isOpaqueShareTargetDraftId(id)) store.delete(id);
      continue;
    }
    current.push(normalized);
  }
  return current;
}

export async function listShareTargetDrafts(
  nowMs = Date.now(),
): Promise<ShareTargetDraftRecord[]> {
  return withObjectStore('readwrite', async (store) => {
    const values = await requestResult<unknown[]>(store.getAll());
    const current = await removeInvalidOrExpired(store, values, nowMs);
    return current.sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  });
}

export async function purgeExpiredShareTargetDrafts(
  nowMs = Date.now(),
): Promise<number> {
  return withObjectStore('readwrite', async (store) => {
    const values = await requestResult<unknown[]>(store.getAll());
    const before = values.length;
    const current = await removeInvalidOrExpired(store, values, nowMs);
    return before - current.length;
  });
}

export async function getShareTargetDraft(
  id: string,
  nowMs = Date.now(),
): Promise<ShareTargetDraftRecord | null> {
  if (!isOpaqueShareTargetDraftId(id)) return null;
  return withObjectStore('readwrite', async (store) => {
    const value = await requestResult<unknown>(store.get(id));
    const normalized = normalizeRecord(value);
    if (!normalized || new Date(normalized.expiresAt).getTime() <= nowMs) {
      store.delete(id);
      return null;
    }
    return normalized;
  });
}

/** Atomically binds a local draft to the first server-verified ERP4 actor. */
export async function claimShareTargetDraft(
  id: string,
  actorKey: string,
  nowMs = Date.now(),
): Promise<ShareTargetDraftRecord | null> {
  if (!isOpaqueShareTargetDraftId(id)) return null;
  const actorHash = await hashActor(actorKey);
  return withObjectStore('readwrite', async (store) => {
    const value = await requestResult<unknown>(store.get(id));
    const normalized = normalizeRecord(value);
    if (!normalized || new Date(normalized.expiresAt).getTime() <= nowMs) {
      store.delete(id);
      return null;
    }
    if (
      normalized.claimedByActorHash !== null &&
      normalized.claimedByActorHash !== actorHash
    ) {
      return null;
    }
    if (normalized.claimedByActorHash === null) {
      const claimed = { ...normalized, claimedByActorHash: actorHash };
      store.put(claimed);
      return claimed;
    }
    return normalized;
  });
}

export async function markShareTargetDraftPending(
  id: string,
  actorKey: string,
  operationId: string,
  intent: ShareTargetPendingIntent,
  exactDraft: IncomingKnowledgeCaptureDraft,
  nowMs = Date.now(),
): Promise<
  | { transitioned: true }
  | {
      transitioned: false;
      pendingIntent: ShareTargetPendingIntent;
      draft: IncomingKnowledgeCaptureDraft;
    }
> {
  const actorHash = await hashActor(actorKey);
  const normalizedIntent = normalizeShareTargetPendingIntent(intent);
  const normalizedDraft = normalizeIncomingKnowledgeCapture(exactDraft);
  if (
    !isOpaqueShareTargetDraftId(id) ||
    !isOpaqueShareTargetDraftId(operationId) ||
    !normalizedIntent ||
    !normalizedDraft
  ) {
    throw new Error('share_target_invalid_transition');
  }
  return withObjectStore('readwrite', async (store) => {
    const normalized = normalizeRecord(
      await requestResult<unknown>(store.get(id)),
    );
    if (
      !normalized ||
      new Date(normalized.expiresAt).getTime() <= nowMs ||
      normalized.claimedByActorHash !== actorHash ||
      normalized.lifecycle === 'cleanup_pending'
    ) {
      throw new Error('share_target_invalid_transition');
    }
    // IndexedDB serializes readwrite transactions. Only the caller that sees
    // staged owns the transition and may dispatch or compensate it. A second
    // tab observing pending must reconcile instead of replaying the mutation.
    if (normalized.lifecycle === 'pending') {
      if (!normalized.pendingIntent || !normalized.draft) {
        throw new Error('share_target_invalid_transition');
      }
      return {
        transitioned: false,
        pendingIntent: normalized.pendingIntent,
        draft: normalized.draft,
      };
    }
    store.put({
      ...normalized,
      lifecycle: 'pending',
      pendingOperationId: operationId,
      pendingIntent: normalizedIntent,
      draft: normalizedDraft,
    });
    return { transitioned: true };
  });
}

export async function markShareTargetDraftStaged(
  id: string,
  actorKey: string,
  operationId: string,
  nowMs = Date.now(),
): Promise<void> {
  const actorHash = await hashActor(actorKey);
  await withObjectStore('readwrite', async (store) => {
    const normalized = normalizeRecord(
      await requestResult<unknown>(store.get(id)),
    );
    if (
      !normalized ||
      new Date(normalized.expiresAt).getTime() <= nowMs ||
      normalized.claimedByActorHash !== actorHash ||
      normalized.lifecycle !== 'pending' ||
      normalized.pendingOperationId !== operationId
    ) {
      throw new Error('share_target_invalid_transition');
    }
    store.put({
      ...normalized,
      lifecycle: 'staged',
      pendingOperationId: null,
      pendingIntent: null,
    });
  });
}

export async function markShareTargetDraftCleanupPending(
  id: string,
  actorKey: string,
  allowPending: boolean,
  nowMs = Date.now(),
): Promise<void> {
  const actorHash = await hashActor(actorKey);
  await withObjectStore('readwrite', async (store) => {
    const normalized = normalizeRecord(
      await requestResult<unknown>(store.get(id)),
    );
    if (
      !normalized ||
      new Date(normalized.expiresAt).getTime() <= nowMs ||
      normalized.claimedByActorHash !== actorHash ||
      normalized.lifecycle === 'cleanup_pending' ||
      (normalized.lifecycle === 'pending' && !allowPending)
    ) {
      throw new Error('share_target_invalid_transition');
    }
    store.put({
      id: normalized.id,
      requestKey: null,
      claimedByActorHash: actorHash,
      lifecycle: 'cleanup_pending',
      pendingOperationId: null,
      pendingIntent: null,
      schemaVersion: 1,
      draft: null,
      createdAt: normalized.createdAt,
      expiresAt: normalized.expiresAt,
    } satisfies ShareTargetDraftRecord);
  });
}

export async function removeShareTargetDraft(
  id: string,
  actorKey?: string,
  nowMs = Date.now(),
): Promise<void> {
  if (!isOpaqueShareTargetDraftId(id)) return;
  const actorHash = actorKey ? await hashActor(actorKey) : null;
  await withObjectStore('readwrite', async (store) => {
    const value = await requestResult<unknown>(store.get(id));
    if (value === undefined) return;
    const normalized = normalizeRecord(value);
    if (!normalized) {
      store.delete(id);
      return;
    }
    const expired = new Date(normalized.expiresAt).getTime() <= nowMs;
    if (!expired && normalized.lifecycle === 'pending') {
      throw new Error('share_target_pending');
    }
    if (
      !expired &&
      normalized.claimedByActorHash !== null &&
      normalized.claimedByActorHash !== actorHash
    ) {
      throw new Error('share_target_actor_mismatch');
    }
    store.delete(id);
  });
}

const lifecycleListeners = new Set<
  (message: ShareTargetLifecycleMessage) => void
>();
let lifecycleChannel: BroadcastChannel | null = null;

function normalizeLifecycleMessage(
  value: unknown,
): ShareTargetLifecycleMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    !isOpaqueShareTargetDraftId(record.draftId) ||
    (record.lifecycle !== 'staged' &&
      record.lifecycle !== 'pending' &&
      record.lifecycle !== 'cleanup_pending')
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    draftId: record.draftId,
    lifecycle: record.lifecycle,
  };
}

function getLifecycleChannel() {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (lifecycleChannel) return lifecycleChannel;
  const channel = new BroadcastChannel(SHARE_TARGET_LIFECYCLE_CHANNEL);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = normalizeLifecycleMessage(event.data);
    if (!message) return;
    for (const listener of lifecycleListeners) listener(message);
  };
  lifecycleChannel = channel;
  return channel;
}

function closeUnusedLifecycleChannel() {
  if (lifecycleListeners.size !== 0 || !lifecycleChannel) return;
  lifecycleChannel.close();
  lifecycleChannel = null;
}

export function publishShareTargetLifecycle(
  draftId: string,
  lifecycle: ShareTargetLifecycle,
) {
  if (!isOpaqueShareTargetDraftId(draftId)) return;
  const channel = getLifecycleChannel();
  if (!channel) return;
  // A tab publishes through the same channel object that owns its local
  // listeners. BroadcastChannel deliberately excludes the sending object, so
  // lifecycle changes invalidate only other tabs and cannot abort the sender's
  // in-flight commit or clear its cleanup-retry URL.
  channel.postMessage({ schemaVersion: 1, draftId, lifecycle });
  closeUnusedLifecycleChannel();
}

export function subscribeShareTargetLifecycle(
  listener: (message: ShareTargetLifecycleMessage) => void,
): () => void {
  if (!getLifecycleChannel()) return () => undefined;
  lifecycleListeners.add(listener);
  return () => {
    lifecycleListeners.delete(listener);
    closeUnusedLifecycleChannel();
  };
}

// The service worker is the production writer. This helper is for deterministic
// tests and accepts only records that the production reader can normalize.
export async function storeShareTargetDraftRecord(
  input: ShareTargetDraftRecord,
  nowMs = Date.now(),
): Promise<ShareTargetDraftRecord> {
  const normalized = normalizeRecord(input);
  if (!normalized) throw new Error('share_target_invalid_record');
  return withObjectStore('readwrite', async (store) => {
    const values = await requestResult<unknown[]>(store.getAll());
    const current = await removeInvalidOrExpired(store, values, nowMs);
    if (current.length >= SHARE_TARGET_QUEUE_LIMIT) {
      throw new Error('share_target_queue_full');
    }
    store.put(normalized);
    return normalized;
  });
}

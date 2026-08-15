import {
  normalizeIncomingKnowledgeCapture,
  type IncomingKnowledgeCaptureDraft,
} from '../sections/knowledge-hub/knowledgeCaptureModel';
import {
  normalizeShareTargetPendingIntent,
  type ShareTargetPendingIntent,
} from './shareTargetQueue';

export const BROWSER_CAPTURE_BRIDGE_TIMEOUT_MS = 5_000;
export const BROWSER_CAPTURE_TERMINAL_FENCE_TTL_MS = 10 * 60 * 1_000;

export type BrowserCaptureLifecycle = 'staged' | 'pending' | 'cleanup_pending';
// `terminal` invalidates other tabs before extension storage cleanup is
// confirmed. It must not be confused with the content-free
// `cleanup_pending` storage lifecycle.
export type BrowserCaptureLocalLifecycle = BrowserCaptureLifecycle | 'terminal';

type BrowserCaptureContentRecord = {
  schemaVersion: 1;
  id: string;
  requestKey: string;
  lifecycle: 'staged' | 'pending';
  pendingOperationId: string | null;
  pendingIntent: ShareTargetPendingIntent | null;
  draft: IncomingKnowledgeCaptureDraft;
  createdAt: string;
  expiresAt: string;
};

type BrowserCaptureCleanupRecord = {
  schemaVersion: 1;
  id: string;
  lifecycle: 'cleanup_pending';
  createdAt: string;
  expiresAt: string;
};

export type BrowserCaptureRecord =
  BrowserCaptureContentRecord | BrowserCaptureCleanupRecord;

type BridgeCommand = 'get' | 'pending' | 'staged' | 'cleanup' | 'delete';
type BridgeResult = {
  transitioned: boolean;
  record: BrowserCaptureRecord | null;
};

const bridgeCodes = new Set([
  'extension_unavailable',
  'invalid_request',
  'not_found',
  'queue_full',
  'replayed_nonce',
  'state_conflict',
  'storage_unavailable',
]);
const draftIdPattern = /^[0-9a-f]{32}$/u;
const opaqueKeyPattern = /^[A-Za-z0-9_-]{22,200}$/u;
const actorFingerprintPattern = /^[0-9a-f]{64}$/u;
const encoder = new TextEncoder();
const lifecycleListeners = new Set<
  (message: {
    schemaVersion: 1;
    draftId: string;
    lifecycle: BrowserCaptureLocalLifecycle;
  }) => void
>();
const BROWSER_CAPTURE_LIFECYCLE_CHANNEL = 'erp4-browser-capture-lifecycle-v1';
const BROWSER_CAPTURE_TERMINAL_FENCE_PREFIXES = [
  'erp4-browser-capture-terminal-v2-a:',
  'erp4-browser-capture-terminal-v2-b:',
] as const;
const BROWSER_CAPTURE_FENCE_PRUNE_LIMIT = 100;
let lifecycleChannel: BroadcastChannel | null = null;
let storageLifecycleListening = false;

export class BrowserCaptureBridgeError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(bridgeCodes.has(code) ? code : 'extension_unavailable');
    this.name = 'BrowserCaptureBridgeError';
    this.code = bridgeCodes.has(code) ? code : 'extension_unavailable';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactInstant(value: unknown) {
  if (typeof value !== 'string' || value.length > 200) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
    ? value
    : null;
}

function hasControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? -1;
    return code <= 31 || (code >= 127 && code <= 159);
  });
}

export function isBrowserCaptureDraftId(value: unknown): value is string {
  return typeof value === 'string' && draftIdPattern.test(value);
}

function normalizeLifecycleMessage(value: unknown) {
  if (!record(value)) return null;
  if (
    value.schemaVersion !== 1 ||
    !isBrowserCaptureDraftId(value.draftId) ||
    (value.lifecycle !== 'staged' &&
      value.lifecycle !== 'pending' &&
      value.lifecycle !== 'cleanup_pending' &&
      value.lifecycle !== 'terminal')
  ) {
    return null;
  }
  return {
    schemaVersion: 1 as const,
    draftId: value.draftId,
    lifecycle: value.lifecycle as BrowserCaptureLocalLifecycle,
  };
}

function terminalFenceKey(prefix: string, draftId: string) {
  return `${prefix}${draftId}`;
}

function normalizeTerminalFence(value: string | null, expectedDraftId: string) {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !record(parsed) ||
      Object.keys(parsed).some(
        (field) =>
          field !== 'schemaVersion' &&
          field !== 'draftId' &&
          field !== 'expiresAtMs' &&
          field !== 'state',
      ) ||
      parsed.schemaVersion !== 1 ||
      parsed.draftId !== expectedDraftId ||
      (parsed.state !== 'a' && parsed.state !== 't') ||
      !Number.isSafeInteger(parsed.expiresAtMs) ||
      Number(parsed.expiresAtMs) <= 0
    ) {
      return null;
    }
    return {
      schemaVersion: 1 as const,
      draftId: expectedDraftId,
      expiresAtMs: Number(parsed.expiresAtMs),
      state: parsed.state as 'a' | 't',
    };
  } catch {
    return null;
  }
}

function emitLifecycle(message: {
  schemaVersion: 1;
  draftId: string;
  lifecycle: BrowserCaptureLocalLifecycle;
}) {
  for (const listener of lifecycleListeners) listener(message);
}

function removeFenceSlots(storage: Storage, draftId: string) {
  for (const prefix of BROWSER_CAPTURE_TERMINAL_FENCE_PREFIXES) {
    storage.removeItem(terminalFenceKey(prefix, draftId));
  }
}

function readFenceSlots(storage: Storage, draftId: string, nowMs: number) {
  const values = BROWSER_CAPTURE_TERMINAL_FENCE_PREFIXES.map((prefix) =>
    storage.getItem(terminalFenceKey(prefix, draftId)),
  );
  if (values.every((value) => value === null)) return null;
  const slots = values.map((value) => normalizeTerminalFence(value, draftId));

  // A verified, unexpired terminal slot is the monotonic safety signal. It
  // wins even when its sibling write was interrupted or the sibling record is
  // unavailable/corrupt; otherwise one failed terminal write could reopen a
  // completed draft on reload.
  const terminal = slots.find(
    (slot) =>
      slot?.state === 't' &&
      slot.expiresAtMs > nowMs &&
      slot.expiresAtMs <= nowMs + BROWSER_CAPTURE_TERMINAL_FENCE_TTL_MS,
  );
  if (terminal) {
    return { terminal: true, expiresAtMs: terminal.expiresAtMs };
  }

  if (slots.some((slot, index) => values[index] !== null && slot === null)) {
    throw new BrowserCaptureBridgeError('invalid_request');
  }
  const present = slots.filter((slot) => slot !== null);
  const expiresAtMs = present[0]?.expiresAtMs;
  if (
    !expiresAtMs ||
    present.some((slot) => slot.expiresAtMs !== expiresAtMs) ||
    expiresAtMs > nowMs + BROWSER_CAPTURE_TERMINAL_FENCE_TTL_MS
  ) {
    throw new BrowserCaptureBridgeError('invalid_request');
  }
  if (expiresAtMs <= nowMs) {
    removeFenceSlots(storage, draftId);
    return null;
  }
  // A partial active initialization is never confused with a terminal product
  // result. It blocks content retrieval until storage can be repaired.
  if (present.length !== BROWSER_CAPTURE_TERMINAL_FENCE_PREFIXES.length) {
    throw new BrowserCaptureBridgeError('invalid_request');
  }
  return { terminal: false, expiresAtMs };
}

function pruneExpiredBrowserCaptureFences(nowMs = Date.now()) {
  if (!Number.isSafeInteger(nowMs) || typeof window === 'undefined') return;
  const storage = window.localStorage;
  const candidates: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (
      key &&
      BROWSER_CAPTURE_TERMINAL_FENCE_PREFIXES.some((prefix) =>
        key.startsWith(prefix),
      )
    ) {
      candidates.push(key);
    }
  }
  let removed = 0;
  for (const key of candidates) {
    if (removed >= BROWSER_CAPTURE_FENCE_PRUNE_LIMIT) break;
    const prefix = BROWSER_CAPTURE_TERMINAL_FENCE_PREFIXES.find((candidate) =>
      key.startsWith(candidate),
    );
    const draftId = prefix ? key.slice(prefix.length) : '';
    const fence = isBrowserCaptureDraftId(draftId)
      ? normalizeTerminalFence(storage.getItem(key), draftId)
      : null;
    if (fence && fence.expiresAtMs <= nowMs) {
      storage.removeItem(key);
      removed += 1;
    }
  }
}

function handleTerminalFenceStorage(event: StorageEvent) {
  if (typeof event.key !== 'string' || event.newValue === null) {
    return;
  }
  const prefix = BROWSER_CAPTURE_TERMINAL_FENCE_PREFIXES.find((candidate) =>
    event.key?.startsWith(candidate),
  );
  const draftId = prefix ? event.key.slice(prefix.length) : '';
  if (!isBrowserCaptureDraftId(draftId)) return;
  const fence = normalizeTerminalFence(event.newValue, draftId);
  if (fence?.state === 't') {
    emitLifecycle({ schemaVersion: 1, draftId, lifecycle: 'terminal' });
  }
}

function ensureStorageLifecycleListener() {
  if (storageLifecycleListening || typeof window === 'undefined') return;
  try {
    pruneExpiredBrowserCaptureFences();
  } catch {
    // Initial draft arming below remains fail closed if storage is unavailable.
  }
  window.addEventListener('storage', handleTerminalFenceStorage);
  storageLifecycleListening = true;
}

export function armBrowserCaptureTerminalFence(
  draftId: string,
  nowMs = Date.now(),
) {
  if (!isBrowserCaptureDraftId(draftId) || !Number.isSafeInteger(nowMs)) {
    throw new BrowserCaptureBridgeError('invalid_request');
  }
  try {
    const storage = window.localStorage;
    const existing = readFenceSlots(storage, draftId, nowMs);
    if (existing) {
      // A terminal slot is monotonic. Never overwrite it from a reload or late
      // tab; an active pair already provides the required pre-read barrier.
      return;
    }
    const value = JSON.stringify({
      schemaVersion: 1,
      draftId,
      expiresAtMs: nowMs + BROWSER_CAPTURE_TERMINAL_FENCE_TTL_MS,
      state: 'a',
    });
    try {
      for (const prefix of BROWSER_CAPTURE_TERMINAL_FENCE_PREFIXES) {
        storage.setItem(terminalFenceKey(prefix, draftId), value);
      }
    } catch {
      // Best-effort rollback makes a partial active initialization either
      // absent or invalid, never terminal. A retry cannot delete a live draft.
      try {
        removeFenceSlots(storage, draftId);
      } catch {
        // A remaining active-only slot is rejected by readFenceSlots().
      }
      throw new BrowserCaptureBridgeError('storage_unavailable');
    }
    const armed = readFenceSlots(storage, draftId, nowMs);
    if (!armed || armed.terminal) {
      throw new BrowserCaptureBridgeError('storage_unavailable');
    }
  } catch (caught) {
    if (caught instanceof BrowserCaptureBridgeError) throw caught;
    throw new BrowserCaptureBridgeError('storage_unavailable');
  }
}

export function markBrowserCaptureTerminalFence(
  draftId: string,
  nowMs = Date.now(),
) {
  if (!isBrowserCaptureDraftId(draftId) || !Number.isSafeInteger(nowMs)) {
    throw new BrowserCaptureBridgeError('invalid_request');
  }
  try {
    const storage = window.localStorage;
    const existing = readFenceSlots(storage, draftId, nowMs);
    if (existing?.terminal) return;
    const value = JSON.stringify({
      schemaVersion: 1,
      draftId,
      expiresAtMs:
        existing?.expiresAtMs ?? nowMs + BROWSER_CAPTURE_TERMINAL_FENCE_TTL_MS,
      state: 't',
    });
    // Slots have fixed-size active/terminal values. A single failed write
    // cannot hide terminal from another tab; either verified terminal slot is
    // sufficient and no terminal write allocates additional quota.
    for (const prefix of BROWSER_CAPTURE_TERMINAL_FENCE_PREFIXES) {
      try {
        storage.setItem(terminalFenceKey(prefix, draftId), value);
      } catch {
        // Try the independent sibling before deciding storage is unavailable.
      }
    }
    if (!readFenceSlots(storage, draftId, nowMs)?.terminal) {
      throw new BrowserCaptureBridgeError('storage_unavailable');
    }
  } catch (caught) {
    if (caught instanceof BrowserCaptureBridgeError) throw caught;
    throw new BrowserCaptureBridgeError('storage_unavailable');
  }
}

export function hasBrowserCaptureTerminalFence(
  draftId: string,
  nowMs = Date.now(),
) {
  if (!isBrowserCaptureDraftId(draftId) || !Number.isSafeInteger(nowMs)) {
    return false;
  }
  try {
    return (
      readFenceSlots(window.localStorage, draftId, nowMs)?.terminal ?? false
    );
  } catch (caught) {
    if (caught instanceof BrowserCaptureBridgeError) throw caught;
    throw new BrowserCaptureBridgeError('storage_unavailable');
  }
}

export function clearBrowserCaptureTerminalFence(draftId: string) {
  if (!isBrowserCaptureDraftId(draftId)) return;
  try {
    removeFenceSlots(window.localStorage, draftId);
  } catch {
    throw new BrowserCaptureBridgeError('storage_unavailable');
  }
}

function getLifecycleChannel() {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (lifecycleChannel) return lifecycleChannel;
  const channel = new BroadcastChannel(BROWSER_CAPTURE_LIFECYCLE_CHANNEL);
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const message = normalizeLifecycleMessage(event.data);
    if (!message) return;
    emitLifecycle(message);
  };
  lifecycleChannel = channel;
  return channel;
}

function closeUnusedLifecycleChannel() {
  if (lifecycleListeners.size !== 0) return;
  if (lifecycleChannel) {
    lifecycleChannel.close();
    lifecycleChannel = null;
  }
  if (storageLifecycleListening && typeof window !== 'undefined') {
    window.removeEventListener('storage', handleTerminalFenceStorage);
    storageLifecycleListening = false;
  }
}

export function publishBrowserCaptureLifecycle(
  draftId: string,
  lifecycle: BrowserCaptureLocalLifecycle,
) {
  if (!isBrowserCaptureDraftId(draftId)) return;
  const channel = getLifecycleChannel();
  if (!channel) return;
  // The shared channel object does not receive its own message. Only other
  // tabs purge/reload, so the owner tab's in-flight commit remains stable.
  channel.postMessage({ schemaVersion: 1, draftId, lifecycle });
  closeUnusedLifecycleChannel();
}

export function subscribeBrowserCaptureLifecycle(
  listener: (message: {
    schemaVersion: 1;
    draftId: string;
    lifecycle: BrowserCaptureLocalLifecycle;
  }) => void,
) {
  ensureStorageLifecycleListener();
  getLifecycleChannel();
  lifecycleListeners.add(listener);
  return () => {
    lifecycleListeners.delete(listener);
    closeUnusedLifecycleChannel();
  };
}

function normalizeBridgeRecord(value: unknown): BrowserCaptureRecord | null {
  if (!record(value)) return null;
  const lifecycle = value.lifecycle;
  const createdAt = exactInstant(value.createdAt);
  const expiresAt = exactInstant(value.expiresAt);
  if (
    value.schemaVersion !== 1 ||
    !isBrowserCaptureDraftId(value.id) ||
    !createdAt ||
    !expiresAt ||
    Date.parse(expiresAt) <= Date.now()
  ) {
    return null;
  }
  if (lifecycle === 'cleanup_pending') {
    const allowedFields = new Set([
      'schemaVersion',
      'id',
      'lifecycle',
      'createdAt',
      'expiresAt',
    ]);
    if (Object.keys(value).some((field) => !allowedFields.has(field))) {
      return null;
    }
    return {
      schemaVersion: 1,
      id: value.id,
      lifecycle,
      createdAt,
      expiresAt,
    };
  }
  const draft = normalizeIncomingKnowledgeCapture(value.draft);
  const pendingOperationId =
    lifecycle === 'pending' &&
    typeof value.pendingOperationId === 'string' &&
    opaqueKeyPattern.test(value.pendingOperationId)
      ? value.pendingOperationId
      : null;
  const pendingIntent =
    lifecycle === 'pending'
      ? normalizeShareTargetPendingIntent(value.pendingIntent)
      : null;
  if (
    typeof value.requestKey !== 'string' ||
    !opaqueKeyPattern.test(value.requestKey) ||
    (lifecycle !== 'staged' && lifecycle !== 'pending') ||
    !draft ||
    draft.channel !== 'browser_extension' ||
    (lifecycle === 'pending' && (!pendingIntent || !pendingOperationId)) ||
    (lifecycle === 'staged' &&
      (value.pendingIntent != null || value.pendingOperationId != null))
  ) {
    return null;
  }
  const allowedFields = new Set([
    'schemaVersion',
    'id',
    'requestKey',
    'lifecycle',
    'pendingOperationId',
    'pendingIntent',
    'draft',
    'createdAt',
    'expiresAt',
  ]);
  if (Object.keys(value).some((field) => !allowedFields.has(field))) {
    return null;
  }
  return {
    schemaVersion: 1,
    id: value.id,
    requestKey: value.requestKey,
    lifecycle,
    pendingOperationId,
    pendingIntent,
    draft,
    createdAt,
    expiresAt,
  };
}

function randomOpaqueKey(bytes = 24) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '');
}

export async function browserCaptureActorFingerprint(actorKey: string) {
  if (
    typeof actorKey !== 'string' ||
    actorKey.length < 1 ||
    actorKey.length > 256 ||
    hasControlCharacter(actorKey)
  ) {
    throw new BrowserCaptureBridgeError('invalid_request');
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`erp4-browser-capture-actor-v1\u0000${actorKey}`),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function sameStringArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function samePendingIntent(
  left: ShareTargetPendingIntent,
  right: ShareTargetPendingIntent,
) {
  return (
    left.scope === right.scope &&
    left.sourceType === right.sourceType &&
    sameStringArray(left.selectedFields, right.selectedFields) &&
    sameStringArray(
      left.organizationGroupAccountIds,
      right.organizationGroupAccountIds,
    )
  );
}

function sameCaptureDraft(
  left: IncomingKnowledgeCaptureDraft,
  right: IncomingKnowledgeCaptureDraft,
) {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.channel === right.channel &&
    left.title === right.title &&
    left.url === right.url &&
    left.selectedText === right.selectedText &&
    left.description === right.description &&
    left.author === right.author &&
    left.publishedAt === right.publishedAt &&
    left.capturedAt === right.capturedAt
  );
}

function normalizeResponse(
  value: unknown,
  expected: {
    command: BridgeCommand;
    id: string;
    nonce: string;
    operationId?: string;
    pendingIntent?: ShareTargetPendingIntent;
    draft?: IncomingKnowledgeCaptureDraft;
  },
): BridgeResult | null {
  if (!record(value)) return null;
  if (
    value.source !== 'erp4-extension' ||
    value.type !== 'erp4-browser-capture-response-v1' ||
    value.schemaVersion !== 1 ||
    value.command !== expected.command ||
    value.id !== expected.id ||
    value.nonce !== expected.nonce ||
    !record(value.response)
  ) {
    return null;
  }
  const response = value.response;
  if (response.ok !== true) {
    throw new BrowserCaptureBridgeError(
      typeof response.code === 'string'
        ? response.code
        : 'extension_unavailable',
    );
  }
  if (
    typeof response.transitioned !== 'boolean' ||
    !Object.prototype.hasOwnProperty.call(response, 'record')
  ) {
    throw new BrowserCaptureBridgeError('invalid_request');
  }
  const normalizedRecord =
    response.record === null ? null : normalizeBridgeRecord(response.record);
  if (normalizedRecord !== null && normalizedRecord.id !== expected.id) {
    throw new BrowserCaptureBridgeError('invalid_request');
  }
  if (response.record !== null && !normalizedRecord) {
    throw new BrowserCaptureBridgeError('invalid_request');
  }
  const semanticallyValid = (() => {
    switch (expected.command) {
      case 'get':
        return response.transitioned === false && normalizedRecord !== null;
      case 'pending':
        if (normalizedRecord?.lifecycle !== 'pending') return false;
        // A newly transitioned response attests ownership only when the
        // extension pinned the exact operation and payload sent by this page.
        // An existing pending record is returned for caller-side same-owner
        // recovery versus CAS-loser discrimination.
        return response.transitioned === false
          ? true
          : Boolean(
              expected.operationId &&
              expected.pendingIntent &&
              expected.draft &&
              normalizedRecord.pendingOperationId === expected.operationId &&
              normalizedRecord.pendingIntent &&
              samePendingIntent(
                normalizedRecord.pendingIntent,
                expected.pendingIntent,
              ) &&
              sameCaptureDraft(normalizedRecord.draft, expected.draft),
            );
      case 'staged':
        return (
          response.transitioned === true &&
          normalizedRecord?.lifecycle === 'staged'
        );
      case 'cleanup':
        return normalizedRecord === null
          ? response.transitioned === false
          : normalizedRecord.lifecycle === 'cleanup_pending';
      case 'delete':
        return normalizedRecord === null;
    }
  })();
  if (!semanticallyValid) {
    throw new BrowserCaptureBridgeError('invalid_request');
  }
  return {
    transitioned: response.transitioned,
    record: normalizedRecord,
  };
}

async function sendCommand(
  input: {
    command: BridgeCommand;
    id: string;
    actorKey: string;
    operationId?: string;
    pendingIntent?: ShareTargetPendingIntent;
    draft?: IncomingKnowledgeCaptureDraft;
  },
  signal?: AbortSignal,
): Promise<BridgeResult> {
  if (!isBrowserCaptureDraftId(input.id)) {
    throw new BrowserCaptureBridgeError('invalid_request');
  }
  const nonce = randomOpaqueKey();
  const actorFingerprint = await browserCaptureActorFingerprint(input.actorKey);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  return new Promise<BridgeResult>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () =>
      finish(() => reject(new DOMException('Aborted', 'AbortError')));
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== window || event.origin !== window.location.origin)
        return;
      try {
        const normalized = normalizeResponse(event.data, {
          command: input.command,
          id: input.id,
          nonce,
          operationId: input.operationId,
          pendingIntent: input.pendingIntent,
          draft: input.draft,
        });
        if (normalized) finish(() => resolve(normalized));
      } catch (error) {
        finish(() => reject(error));
      }
    };
    const timeout = window.setTimeout(
      () =>
        finish(() =>
          reject(new BrowserCaptureBridgeError('extension_unavailable')),
        ),
      BROWSER_CAPTURE_BRIDGE_TIMEOUT_MS,
    );
    window.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    window.postMessage(
      {
        source: 'erp4-page',
        type: 'erp4-browser-capture-command-v1',
        schemaVersion: 1,
        command: input.command,
        id: input.id,
        nonce,
        actorFingerprint,
        ...(input.operationId ? { operationId: input.operationId } : {}),
        ...(input.pendingIntent ? { pendingIntent: input.pendingIntent } : {}),
        ...(input.draft ? { draft: input.draft } : {}),
      },
      window.location.origin,
    );
  });
}

export async function getBrowserCaptureDraft(
  id: string,
  actorKey: string,
  signal?: AbortSignal,
) {
  const result = await sendCommand({ command: 'get', id, actorKey }, signal);
  return result.record;
}

export async function markBrowserCaptureDraftPending(
  id: string,
  actorKey: string,
  operationId: string,
  pendingIntent: ShareTargetPendingIntent,
  draft: IncomingKnowledgeCaptureDraft,
  signal?: AbortSignal,
): Promise<
  | { transitioned: true }
  | { transitioned: false; owned: true }
  | {
      transitioned: false;
      owned: false;
      pendingIntent: ShareTargetPendingIntent;
      draft: IncomingKnowledgeCaptureDraft;
    }
> {
  if (!opaqueKeyPattern.test(operationId)) {
    throw new BrowserCaptureBridgeError('invalid_request');
  }
  const result = await sendCommand(
    {
      command: 'pending',
      id,
      actorKey,
      operationId,
      pendingIntent,
      draft,
    },
    signal,
  );
  if (!result.record) throw new BrowserCaptureBridgeError('not_found');
  if (result.record.lifecycle === 'cleanup_pending') {
    throw new BrowserCaptureBridgeError('state_conflict');
  }
  if (!result.transitioned) {
    if (!result.record.pendingIntent || !result.record.pendingOperationId) {
      throw new BrowserCaptureBridgeError('state_conflict');
    }
    if (result.record.pendingOperationId === operationId) {
      if (
        !samePendingIntent(result.record.pendingIntent, pendingIntent) ||
        !sameCaptureDraft(result.record.draft, draft)
      ) {
        throw new BrowserCaptureBridgeError('invalid_request');
      }
      return { transitioned: false, owned: true };
    }
    return {
      transitioned: false,
      owned: false,
      pendingIntent: result.record.pendingIntent,
      draft: result.record.draft,
    };
  }
  return { transitioned: true };
}

export async function markBrowserCaptureDraftStaged(
  id: string,
  actorKey: string,
  operationId: string,
  signal?: AbortSignal,
) {
  if (!opaqueKeyPattern.test(operationId)) {
    throw new BrowserCaptureBridgeError('invalid_request');
  }
  await sendCommand({ command: 'staged', id, actorKey, operationId }, signal);
}

export async function markBrowserCaptureDraftCleanupPending(
  id: string,
  actorKey: string,
  signal?: AbortSignal,
) {
  const result = await sendCommand(
    { command: 'cleanup', id, actorKey },
    signal,
  );
  // A null record is the idempotent terminal result when the tombstone or the
  // complete record was already physically deleted before a response arrived.
  if (result.record && result.record.lifecycle !== 'cleanup_pending') {
    throw new BrowserCaptureBridgeError('state_conflict');
  }
}

export async function removeBrowserCaptureDraft(
  id: string,
  actorKey: string,
  signal?: AbortSignal,
) {
  await sendCommand({ command: 'delete', id, actorKey }, signal);
}

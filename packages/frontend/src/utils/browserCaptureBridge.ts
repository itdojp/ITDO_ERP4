import {
  normalizeIncomingKnowledgeCapture,
  type IncomingKnowledgeCaptureDraft,
} from '../sections/knowledge-hub/knowledgeCaptureModel';
import {
  normalizeShareTargetPendingIntent,
  type ShareTargetPendingIntent,
} from './shareTargetQueue';

export const BROWSER_CAPTURE_BRIDGE_TIMEOUT_MS = 5_000;

export type BrowserCaptureLifecycle = 'staged' | 'pending';
export type BrowserCaptureLocalLifecycle =
  BrowserCaptureLifecycle | 'cleanup_pending';

export type BrowserCaptureRecord = {
  schemaVersion: 1;
  id: string;
  requestKey: string;
  lifecycle: BrowserCaptureLifecycle;
  pendingIntent: ShareTargetPendingIntent | null;
  draft: IncomingKnowledgeCaptureDraft;
  createdAt: string;
  expiresAt: string;
};

type BridgeCommand = 'get' | 'pending' | 'staged' | 'delete';
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
let lifecycleChannel: BroadcastChannel | null = null;

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
      value.lifecycle !== 'cleanup_pending')
  ) {
    return null;
  }
  return {
    schemaVersion: 1 as const,
    draftId: value.draftId,
    lifecycle: value.lifecycle as BrowserCaptureLocalLifecycle,
  };
}

function getLifecycleChannel() {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (lifecycleChannel) return lifecycleChannel;
  const channel = new BroadcastChannel(BROWSER_CAPTURE_LIFECYCLE_CHANNEL);
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
  if (!getLifecycleChannel()) return () => undefined;
  lifecycleListeners.add(listener);
  return () => {
    lifecycleListeners.delete(listener);
    closeUnusedLifecycleChannel();
  };
}

function normalizeBridgeRecord(value: unknown): BrowserCaptureRecord | null {
  if (!record(value)) return null;
  const draft = normalizeIncomingKnowledgeCapture(value.draft);
  const lifecycle = value.lifecycle;
  const pendingIntent =
    lifecycle === 'pending'
      ? normalizeShareTargetPendingIntent(value.pendingIntent)
      : null;
  const createdAt = exactInstant(value.createdAt);
  const expiresAt = exactInstant(value.expiresAt);
  if (
    value.schemaVersion !== 1 ||
    !isBrowserCaptureDraftId(value.id) ||
    typeof value.requestKey !== 'string' ||
    !opaqueKeyPattern.test(value.requestKey) ||
    (lifecycle !== 'staged' && lifecycle !== 'pending') ||
    !draft ||
    draft.channel !== 'browser_extension' ||
    !createdAt ||
    !expiresAt ||
    Date.parse(expiresAt) <= Date.now() ||
    (lifecycle === 'pending' && !pendingIntent)
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    id: value.id,
    requestKey: value.requestKey,
    lifecycle,
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

function normalizeResponse(
  value: unknown,
  expected: { command: BridgeCommand; id: string; nonce: string },
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
  const normalizedRecord =
    response.record === null || response.record === undefined
      ? null
      : normalizeBridgeRecord(response.record);
  if (response.record != null && !normalizedRecord) {
    throw new BrowserCaptureBridgeError('invalid_request');
  }
  return {
    transitioned: response.transitioned === true,
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
  | {
      transitioned: false;
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
  if (!result.transitioned) {
    if (!result.record.pendingIntent) {
      throw new BrowserCaptureBridgeError('state_conflict');
    }
    return {
      transitioned: false,
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

export async function removeBrowserCaptureDraft(
  id: string,
  actorKey: string,
  signal?: AbortSignal,
) {
  await sendCommand({ command: 'delete', id, actorKey }, signal);
}

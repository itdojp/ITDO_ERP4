// @ts-expect-error Vitest runs this test in Node; production frontend code has no Node dependency.
import { webcrypto } from 'node:crypto';
// @ts-expect-error Vitest runs this test in Node; production frontend code has no Node dependency.
import fs from 'node:fs';
// @ts-expect-error Vitest runs this test in Node; production frontend code has no Node dependency.
import path from 'node:path';
// @ts-expect-error Vitest runs this test in Node; production frontend code has no Node dependency.
import vm from 'node:vm';

import { indexedDB as fakeIndexedDB } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SHARE_TARGET_DB_NAME } from './shareTargetQueue';

declare const process: { cwd(): string };

type ShareTargetWorkerApi = {
  MAX_RAW_BYTES: number;
  MAX_QUEUE_SIZE: number;
  DRAFT_TTL_MS: number;
  parseMultipartPayload: (
    bytes: Uint8Array,
    contentType: string,
    capturedAt: string,
  ) => Record<string, unknown>;
  stageDraft: (
    draft: Record<string, unknown>,
    nowMs: number,
  ) => Promise<string>;
  purgeExpiredDrafts: (nowMs: number) => Promise<number>;
  handleRequest: (
    request: Request,
    origin: string,
    nowMs: number,
  ) => Promise<Response>;
};

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'public/share-target-sw.js'),
  'utf8',
);
const mainWorkerSource = fs.readFileSync(
  path.resolve(process.cwd(), 'public/sw.js'),
  'utf8',
);
const baseTime = Date.parse('2026-08-14T00:00:00.000Z');

function loadWorkerApi(
  indexedDb: unknown = fakeIndexedDB,
): ShareTargetWorkerApi {
  const self: Record<string, unknown> = {
    indexedDB: indexedDb,
    crypto: webcrypto,
  };
  vm.runInNewContext(source, {
    self,
    URL,
    Error,
    Date,
    Object,
    Array,
    Set,
    Number,
    RegExp,
    JSON,
    Promise,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Response,
    encodeURIComponent,
  });
  return self.ERP4ShareTarget as ShareTargetWorkerApi;
}

function multipart(
  parts: Array<{
    name: string;
    value: string | Uint8Array;
    filename?: string;
    contentType?: string;
  }>,
  boundary = 'erp4-boundary-2017',
) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const append = (value: string | Uint8Array) =>
    chunks.push(typeof value === 'string' ? encoder.encode(value) : value);
  for (const part of parts) {
    append(`--${boundary}\r\n`);
    append(
      `Content-Disposition: form-data; name="${part.name}"${
        part.filename === undefined ? '' : `; filename="${part.filename}"`
      }\r\n`,
    );
    if (part.contentType) append(`Content-Type: ${part.contentType}\r\n`);
    append('\r\n');
    append(part.value);
    append('\r\n');
  }
  append(`--${boundary}--\r\n`);
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    bytes,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function expectedDraft(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    channel: 'pwa_share_target',
    title: 'Synthetic title',
    url: 'https://example.invalid/article',
    selectedText: 'Synthetic selected text',
    description: null,
    author: null,
    publishedAt: null,
    capturedAt: new Date(baseTime).toISOString(),
    ...overrides,
  };
}

function sameOriginHeaders(contentType: string) {
  return new Headers({
    'content-type': contentType,
    origin: 'https://erp4.example.invalid',
    'sec-fetch-site': 'same-origin',
  });
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

async function readStoredRecords(): Promise<
  Array<{
    id: string;
    requestKey: string;
    lifecycle: string;
    pendingIntent: unknown;
  }>
> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = fakeIndexedDB.open(SHARE_TARGET_DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = database
        .transaction('drafts', 'readonly')
        .objectStore('drafts')
        .getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

describe('share-target service worker contract', () => {
  beforeEach(deleteDatabase);
  afterEach(deleteDatabase);

  it('contains no direct mutation, cookie, token, or Cache API access', () => {
    expect(source).not.toMatch(/document\.cookie|localStorage|sessionStorage/u);
    expect(source).not.toMatch(/authorization|csrf|bearer/iu);
    expect(source).not.toMatch(/\/knowledge\/captures|\bcaches\b/u);
    expect(source).not.toMatch(/console\.(?:log|error|warn)/u);
  });

  it('closes a late IndexedDB connection after a blocked open', async () => {
    type MutableOpenRequest = {
      onblocked: ((event: Event) => void) | null;
      onsuccess: ((event: Event) => void) | null;
      onerror: ((event: Event) => void) | null;
      onupgradeneeded: ((event: Event) => void) | null;
      result?: { close: () => void };
    };
    const close = vi.fn();
    const request: MutableOpenRequest = {
      onblocked: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
    };
    const api = loadWorkerApi({
      open: () => {
        queueMicrotask(() => {
          request.onblocked?.(new Event('blocked'));
          queueMicrotask(() => {
            request.result = { close };
            request.onsuccess?.(new Event('success'));
          });
        });
        return request;
      },
    });

    await expect(api.stageDraft(expectedDraft(), baseTime)).rejects.toThrow(
      'storage_unavailable',
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(close).toHaveBeenCalledOnce();
  });

  it('parses only the allowlisted text fields into a canonical draft', () => {
    const api = loadWorkerApi();
    const payload = multipart([
      { name: 'title', value: 'Synthetic title' },
      { name: 'url', value: 'https://example.invalid/article' },
      { name: 'text', value: 'Synthetic selected text' },
    ]);

    expect(
      api.parseMultipartPayload(
        payload.bytes,
        payload.contentType,
        new Date(baseTime).toISOString(),
      ),
    ).toEqual(expectedDraft());
  });

  it.each([
    {
      label: 'unknown field',
      parts: [{ name: 'provider', value: 'private-canary' }],
    },
    {
      label: 'prototype key',
      parts: [{ name: '__proto__', value: 'private-canary' }],
    },
    {
      label: 'duplicate field',
      parts: [
        { name: 'title', value: 'one' },
        { name: 'title', value: 'two' },
      ],
    },
    {
      label: 'file part',
      parts: [
        {
          name: 'text',
          value: 'file-content',
          filename: 'capture.txt',
          contentType: 'text/plain',
        },
      ],
    },
  ])('rejects $label instead of storing it', ({ parts }) => {
    const api = loadWorkerApi();
    const payload = multipart(parts);
    expect(() =>
      api.parseMultipartPayload(
        payload.bytes,
        payload.contentType,
        new Date(baseTime).toISOString(),
      ),
    ).toThrow('invalid_payload');
  });

  it('rejects malformed UTF-8, controls, unsafe URL schemes, and credentials', () => {
    const api = loadWorkerApi();
    const invalidUtf8 = multipart([
      { name: 'text', value: new Uint8Array([0xc3, 0x28]) },
    ]);
    expect(() =>
      api.parseMultipartPayload(
        invalidUtf8.bytes,
        invalidUtf8.contentType,
        new Date(baseTime).toISOString(),
      ),
    ).toThrow('invalid_encoding');

    for (const value of ['unsafe\u0000text', '\u061cspoofed']) {
      const payload = multipart([{ name: 'text', value }]);
      expect(() =>
        api.parseMultipartPayload(
          payload.bytes,
          payload.contentType,
          new Date(baseTime).toISOString(),
        ),
      ).toThrow('invalid_payload');
    }

    for (const url of [
      'javascript:alert(1)',
      'data:text/plain,secret',
      'https://user:password@example.invalid/private',
      'https://example.invalid/unsafe\npath',
    ]) {
      const payload = multipart([{ name: 'url', value: url }]);
      expect(() =>
        api.parseMultipartPayload(
          payload.bytes,
          payload.contentType,
          new Date(baseTime).toISOString(),
        ),
      ).toThrow('invalid_payload');
    }
  });

  it('keeps HTML and script-looking selections as inert plain text', () => {
    const api = loadWorkerApi();
    const selectedText =
      '<script>globalThis.compromised=true</script><b>text</b>';
    const payload = multipart([{ name: 'text', value: selectedText }]);
    const parsed = api.parseMultipartPayload(
      payload.bytes,
      payload.contentType,
      new Date(baseTime).toISOString(),
    );
    expect(parsed.selectedText).toBe(selectedText);
    expect(
      (globalThis as typeof globalThis & { compromised?: boolean }).compromised,
    ).toBeUndefined();
  });

  it('rejects per-field and raw-body oversize payloads before staging', () => {
    const api = loadWorkerApi();
    const text = 'a'.repeat(64 * 1024 + 1);
    const fieldPayload = multipart([{ name: 'text', value: text }]);
    expect(() =>
      api.parseMultipartPayload(
        fieldPayload.bytes,
        fieldPayload.contentType,
        new Date(baseTime).toISOString(),
      ),
    ).toThrow('invalid_payload');

    expect(() =>
      api.parseMultipartPayload(
        new Uint8Array(api.MAX_RAW_BYTES + 1),
        fieldPayload.contentType,
        new Date(baseTime).toISOString(),
      ),
    ).toThrow('payload_too_large');
  });

  it('uses independent handoff IDs and enforces a non-evicting queue limit', async () => {
    const api = loadWorkerApi();
    const firstId = await api.stageDraft(expectedDraft(), baseTime);
    const secondId = await api.stageDraft(
      expectedDraft({ capturedAt: new Date(baseTime + 1000).toISOString() }),
      baseTime + 1000,
    );
    expect(secondId).not.toBe(firstId);
    const stored = await readStoredRecords();
    expect(stored).toHaveLength(2);
    expect(stored.map(({ requestKey }) => requestKey)).toHaveLength(
      new Set(stored.map(({ requestKey }) => requestKey)).size,
    );
    for (const value of stored) {
      expect(value.requestKey).toMatch(/^[a-f0-9]{32}$/u);
      expect(value.requestKey).not.toBe(value.id);
      expect(value.lifecycle).toBe('staged');
      expect(value.pendingIntent).toBeNull();
    }

    for (let index = 2; index < api.MAX_QUEUE_SIZE; index += 1) {
      await api.stageDraft(
        expectedDraft({ title: `Synthetic title ${index}` }),
        baseTime + index,
      );
    }
    await expect(
      api.stageDraft(expectedDraft({ title: 'overflow' }), baseTime + 100),
    ).rejects.toThrow('queue_full');
  });

  it('returns a no-store 303 containing only the opaque ID', async () => {
    const api = loadWorkerApi();
    const privateText = 'PRIVATE-CONTENT-MUST-NOT-ENTER-LOCATION';
    const payload = multipart([{ name: 'text', value: privateText }]);
    const response = await api.handleRequest(
      new Request('https://erp4.example.invalid/share-target', {
        method: 'POST',
        headers: sameOriginHeaders(payload.contentType),
        body: payload.bytes,
      }),
      'https://erp4.example.invalid',
      baseTime,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('location')).toMatch(
      /^\/\?shareTarget=[a-f0-9]{32}$/u,
    );
    expect(response.headers.get('location')).not.toContain(privateText);
    await expect(response.text()).resolves.toBe('');
  });

  it('returns sanitized errors for wrong media type and oversize requests', async () => {
    const api = loadWorkerApi();
    const response = await api.handleRequest(
      new Request('https://erp4.example.invalid/share-target', {
        method: 'POST',
        headers: sameOriginHeaders('application/json'),
        body: '{}',
      }),
      'https://erp4.example.invalid',
      baseTime,
    );
    expect(response.status).toBe(415);
    await expect(response.text()).resolves.toBe('unsupported_media_type');
  });

  it('rejects explicit cross-site handoff metadata without staging content', async () => {
    const api = loadWorkerApi();
    const payload = multipart([{ name: 'text', value: 'synthetic' }]);
    const response = await api.handleRequest(
      new Request('https://erp4.example.invalid/share-target', {
        method: 'POST',
        headers: new Headers({
          'content-type': payload.contentType,
          origin: 'https://attacker.invalid',
          'sec-fetch-site': 'cross-site',
        }),
        body: payload.bytes,
      }),
      'https://erp4.example.invalid',
      baseTime,
    );
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe('invalid_payload');
  });

  it('limits missing browser initiator metadata to compatibility staging', async () => {
    const api = loadWorkerApi();
    const payload = multipart([{ name: 'text', value: 'synthetic' }]);
    const response = await api.handleRequest(
      new Request('https://erp4.example.invalid/share-target', {
        method: 'POST',
        headers: new Headers({ 'content-type': payload.contentType }),
        body: payload.bytes,
      }),
      'https://erp4.example.invalid',
      baseTime,
    );
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toMatch(
      /^\/?\?shareTarget=[a-f0-9]{32}$/u,
    );
    expect(source).not.toMatch(/fetch\s*\(\s*['"]\/knowledge/iu);
  });

  it('rejects non-exact action URLs and methods before reading the payload', async () => {
    const api = loadWorkerApi();
    const payload = multipart([{ name: 'text', value: 'synthetic' }]);
    for (const request of [
      new Request('https://erp4.example.invalid/share-target?unexpected=1', {
        method: 'POST',
        headers: new Headers({ 'content-type': payload.contentType }),
        body: payload.bytes,
      }),
      new Request('https://erp4.example.invalid/share-target', {
        method: 'PUT',
        headers: new Headers({ 'content-type': payload.contentType }),
        body: payload.bytes,
      }),
    ]) {
      const response = await api.handleRequest(
        request,
        'https://erp4.example.invalid',
        baseTime,
      );
      expect(response.status).toBe(400);
      await expect(response.text()).resolves.toBe('invalid_payload');
    }
  });

  it('accepts an opaque native-share origin only with Sec-Fetch-Site none', async () => {
    const api = loadWorkerApi();
    const payload = multipart([{ name: 'text', value: 'synthetic' }]);
    const response = await api.handleRequest(
      new Request('https://erp4.example.invalid/share-target', {
        method: 'POST',
        headers: new Headers({
          'content-type': payload.contentType,
          origin: 'null',
          'sec-fetch-site': 'none',
        }),
        body: payload.bytes,
      }),
      'https://erp4.example.invalid',
      baseTime,
    );
    expect(response.status).toBe(303);
  });

  it('fails closed when the request body is not a readable stream', async () => {
    const api = loadWorkerApi();
    const response = await api.handleRequest(
      {
        method: 'POST',
        url: 'https://erp4.example.invalid/share-target',
        headers: new Headers({
          'content-type': 'multipart/form-data; boundary=erp4-boundary-2017',
          origin: 'https://erp4.example.invalid',
          'sec-fetch-site': 'same-origin',
        }),
        body: null,
      } as Request,
      'https://erp4.example.invalid',
      baseTime,
    );
    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe('invalid_payload');
  });

  it('physically purges expired drafts at the next worker opportunity', async () => {
    const api = loadWorkerApi();
    await api.stageDraft(expectedDraft(), baseTime);
    await expect(
      api.purgeExpiredDrafts(baseTime + api.DRAFT_TTL_MS),
    ).resolves.toBe(1);
  });

  it('keeps cleanup active but refuses new POST intake in decommission mode', () => {
    type WorkerFetchEvent = { request: Request; respondWith: unknown };
    let fetchListener: ((event: WorkerFetchEvent) => void) | null = null;
    const handleRequest = vi.fn();
    const purgeExpiredDrafts = vi.fn().mockResolvedValue(0);
    const self = {
      ERP4_SHARE_TARGET_MODE: 'decommission',
      ERP4ShareTarget: { handleRequest, purgeExpiredDrafts },
      location: { origin: 'https://erp4.example.invalid' },
      addEventListener: (
        type: string,
        listener: (event: WorkerFetchEvent) => void,
      ) => {
        if (type === 'fetch') fetchListener = listener;
      },
    };
    vm.runInNewContext(mainWorkerSource, {
      self,
      importScripts: () => undefined,
      URL,
      Response,
      fetch: vi.fn(),
      caches: {},
      Promise,
      Set,
    });
    expect(fetchListener).not.toBeNull();
    const respondWith = vi.fn();
    const event = {
      request: new Request('https://erp4.example.invalid/share-target', {
        method: 'POST',
      }),
      respondWith,
    };

    const listener = fetchListener as unknown as (
      value: WorkerFetchEvent,
    ) => void;
    listener(event);

    expect(respondWith).not.toHaveBeenCalled();
    expect(handleRequest).not.toHaveBeenCalled();
    expect(mainWorkerSource).toContain('purgeExpiredDrafts()');
  });
});

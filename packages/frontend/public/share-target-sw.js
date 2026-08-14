(function initializeShareTarget(globalScope) {
  'use strict';

  const DB_NAME = 'erp4-share-target-drafts';
  const STORE_NAME = 'drafts';
  const DB_VERSION = 1;
  const MAX_RAW_BYTES = 128 * 1024;
  const MAX_DRAFT_BYTES = 128 * 1024;
  const MAX_TITLE_CODE_POINTS = 500;
  const MAX_URL_BYTES = 4096;
  const MAX_TEXT_BYTES = 64 * 1024;
  const MAX_QUEUE_SIZE = 10;
  const DRAFT_TTL_MS = 60 * 60 * 1000;
  const ALLOWED_FIELDS = new Set(['title', 'text', 'url']);
  const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
  const BOUNDARY_PATTERN = /^[0-9A-Za-z'()+_,.\/:=?-]{1,70}$/u;

  function invalidUnicode(value) {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
        index += 1;
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) return true;
      if (
        (code >= 0 && code <= 8) ||
        code === 11 ||
        code === 12 ||
        (code >= 14 && code <= 31) ||
        (code >= 127 && code <= 159) ||
        code === 0xfffd ||
        code === 0xfeff ||
        code === 0x061c ||
        code === 0x200e ||
        code === 0x200f ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2066 && code <= 0x2069)
      ) {
        return true;
      }
    }
    return false;
  }

  function utf8Bytes(value) {
    return new TextEncoder().encode(value).byteLength;
  }

  function normalizeValue(value, options) {
    if (typeof value !== 'string' || invalidUnicode(value)) {
      throw new Error('invalid_payload');
    }
    if (options.codePoints && Array.from(value).length > options.codePoints) {
      throw new Error('invalid_payload');
    }
    if (options.bytes && utf8Bytes(value) > options.bytes) {
      throw new Error('invalid_payload');
    }
    return value === '' ? null : value;
  }

  function normalizeUrl(value) {
    const candidate = normalizeValue(value, { bytes: MAX_URL_BYTES });
    if (candidate === null) return null;
    for (const character of candidate) {
      const code = character.codePointAt(0);
      if (code === undefined || code <= 31 || (code >= 127 && code <= 159)) {
        throw new Error('invalid_payload');
      }
    }
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error('invalid_payload');
    }
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error('invalid_payload');
    }
    return candidate;
  }

  function parseBoundary(contentType) {
    if (typeof contentType !== 'string') return null;
    const pieces = contentType.split(';').map((piece) => piece.trim());
    if (pieces.shift()?.toLowerCase() !== 'multipart/form-data') return null;
    let boundary = null;
    for (const piece of pieces) {
      const match = /^boundary=(?:"([^"]+)"|([^\s]+))$/iu.exec(piece);
      if (!match) continue;
      if (boundary !== null) return null;
      boundary = match[1] ?? match[2] ?? null;
    }
    return boundary && BOUNDARY_PATTERN.test(boundary) ? boundary : null;
  }

  function parseContentDisposition(value) {
    const match =
      /^form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?$/iu.exec(value);
    if (!match || match[2] !== undefined) return null;
    return match[1] ?? null;
  }

  function parseMultipartPayload(bytes, contentType, capturedAt) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_RAW_BYTES) {
      throw new Error('payload_too_large');
    }
    const boundary = parseBoundary(contentType);
    if (!boundary) throw new Error('unsupported_media_type');
    let decoded;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error('invalid_encoding');
    }
    const delimiter = `--${boundary}`;
    if (
      !decoded.startsWith(`${delimiter}\r\n`) ||
      !decoded.endsWith(`${delimiter}--\r\n`)
    ) {
      throw new Error('invalid_payload');
    }
    const segments = decoded
      .slice(delimiter.length + 2)
      .split(`\r\n${delimiter}`);
    const values = Object.create(null);
    for (let index = 0; index < segments.length; index += 1) {
      let segment = segments[index];
      if (index === segments.length - 1) {
        if (segment !== '--\r\n') throw new Error('invalid_payload');
        continue;
      }
      if (index > 0) {
        if (!segment.startsWith('\r\n')) throw new Error('invalid_payload');
        segment = segment.slice(2);
      }
      const bodyWithHeaders = segment;
      const separator = bodyWithHeaders.indexOf('\r\n\r\n');
      if (separator <= 0 || separator > 8192) {
        throw new Error('invalid_payload');
      }
      const headerBlock = bodyWithHeaders.slice(0, separator);
      const value = bodyWithHeaders.slice(separator + 4);
      const headers = Object.create(null);
      for (const headerLine of headerBlock.split('\r\n')) {
        const colon = headerLine.indexOf(':');
        if (colon <= 0) throw new Error('invalid_payload');
        const name = headerLine.slice(0, colon).trim().toLowerCase();
        const headerValue = headerLine.slice(colon + 1).trim();
        if (
          !/^[a-z-]+$/u.test(name) ||
          Object.prototype.hasOwnProperty.call(headers, name) ||
          !['content-disposition', 'content-type'].includes(name)
        ) {
          throw new Error('invalid_payload');
        }
        headers[name] = headerValue;
      }
      const fieldName = parseContentDisposition(headers['content-disposition']);
      if (
        !fieldName ||
        FORBIDDEN_KEYS.has(fieldName) ||
        !ALLOWED_FIELDS.has(fieldName) ||
        Object.prototype.hasOwnProperty.call(values, fieldName)
      ) {
        throw new Error('invalid_payload');
      }
      if (
        headers['content-type'] &&
        !/^text\/plain(?:;\s*charset=utf-8)?$/iu.test(headers['content-type'])
      ) {
        throw new Error('invalid_payload');
      }
      values[fieldName] = value;
    }
    if (Object.keys(values).length === 0) throw new Error('invalid_payload');
    const draft = {
      schemaVersion: 1,
      channel: 'pwa_share_target',
      title: normalizeValue(values.title ?? '', {
        codePoints: MAX_TITLE_CODE_POINTS,
      }),
      url: normalizeUrl(values.url ?? ''),
      selectedText: normalizeValue(values.text ?? '', {
        bytes: MAX_TEXT_BYTES,
      }),
      description: null,
      author: null,
      publishedAt: null,
      capturedAt,
    };
    if (
      draft.title === null &&
      draft.url === null &&
      draft.selectedText === null
    ) {
      throw new Error('invalid_payload');
    }
    if (utf8Bytes(JSON.stringify(draft)) > MAX_DRAFT_BYTES) {
      throw new Error('payload_too_large');
    }
    return draft;
  }

  async function readBoundedRequest(request) {
    const declared = request.headers.get('content-length');
    if (declared !== null) {
      if (!/^\d+$/u.test(declared) || Number(declared) > MAX_RAW_BYTES) {
        throw new Error('payload_too_large');
      }
    }
    if (!request.body || typeof request.body.getReader !== 'function')
      throw new Error('invalid_payload');
    const reader = request.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      total += chunk.byteLength;
      if (total > MAX_RAW_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('payload_too_large');
      }
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      let rejected = false;
      const request = globalScope.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, {
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
        reject(new Error('storage_unavailable'));
      };
      request.onblocked = () => {
        if (rejected) return;
        rejected = true;
        reject(new Error('storage_unavailable'));
      };
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('storage_unavailable'));
    });
  }

  function completeTransaction(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('storage_unavailable'));
      transaction.onabort = () => reject(new Error('storage_unavailable'));
    });
  }

  function newOpaqueId() {
    const bytes = new Uint8Array(16);
    globalScope.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  }

  async function stageDraft(draft, nowMs) {
    if (!globalScope.indexedDB || !globalScope.crypto?.getRandomValues) {
      throw new Error('storage_unavailable');
    }
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const completion = completeTransaction(transaction);
      const store = transaction.objectStore(STORE_NAME);
      const records = await requestResult(store.getAll());
      const current = [];
      for (const record of records) {
        const expiresAt = Date.parse(record?.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
          if (typeof record?.id === 'string') store.delete(record.id);
          continue;
        }
        current.push(record);
      }
      if (current.length >= MAX_QUEUE_SIZE) {
        await completion;
        throw new Error('queue_full');
      }
      const id = newOpaqueId();
      const requestKey = newOpaqueId();
      const createdAt = new Date(nowMs).toISOString();
      store.add({
        id,
        requestKey,
        claimedByActorHash: null,
        lifecycle: 'staged',
        pendingIntent: null,
        schemaVersion: 1,
        draft,
        createdAt,
        expiresAt: new Date(nowMs + DRAFT_TTL_MS).toISOString(),
      });
      await completion;
      return id;
    } finally {
      database.close();
    }
  }

  async function purgeExpiredDrafts(nowMs = Date.now()) {
    if (!globalScope.indexedDB) return 0;
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const completion = completeTransaction(transaction);
      const store = transaction.objectStore(STORE_NAME);
      const records = await requestResult(store.getAll());
      let removed = 0;
      for (const record of records) {
        const expiresAt = Date.parse(record?.expiresAt);
        if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
          if (typeof record?.id === 'string') store.delete(record.id);
          removed += 1;
        }
      }
      await completion;
      return removed;
    } finally {
      database.close();
    }
  }

  function errorResponse(error) {
    const code =
      error instanceof Error &&
      ['payload_too_large', 'unsupported_media_type'].includes(error.message)
        ? error.message
        : error instanceof Error && error.message === 'queue_full'
          ? 'queue_full'
          : error instanceof Error && error.message === 'storage_unavailable'
            ? 'storage_unavailable'
            : 'invalid_payload';
    const status =
      code === 'payload_too_large'
        ? 413
        : code === 'unsupported_media_type'
          ? 415
          : code === 'queue_full'
            ? 429
            : code === 'storage_unavailable'
              ? 503
              : 400;
    return new Response(code, {
      status,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  }

  async function handleRequest(request, origin, nowMs = Date.now()) {
    try {
      const requestUrl = new URL(request.url);
      if (
        request.method !== 'POST' ||
        requestUrl.origin !== origin ||
        requestUrl.pathname !== '/share-target' ||
        requestUrl.search !== '' ||
        requestUrl.hash !== ''
      ) {
        throw new Error('invalid_payload');
      }
      const requestOrigin = request.headers.get('origin');
      const fetchSite = request.headers.get('sec-fetch-site');
      const sameOriginInitiator =
        requestOrigin === origin && fetchSite === 'same-origin';
      const opaqueNativeShare =
        (requestOrigin === null || requestOrigin === 'null') &&
        fetchSite === 'none';
      // Chromium does not expose initiator metadata on every same-origin
      // service-worker Request. Headerless compatibility is limited to local
      // draft staging; this handler never calls an ERP4 API or mutates
      // Knowledge. Explicit cross-site metadata still fails closed.
      const unavailableInitiatorMetadata =
        requestOrigin === null && fetchSite === null;
      if (
        !sameOriginInitiator &&
        !opaqueNativeShare &&
        !unavailableInitiatorMetadata
      ) {
        throw new Error('invalid_payload');
      }
      const bytes = await readBoundedRequest(request);
      const draft = parseMultipartPayload(
        bytes,
        request.headers.get('content-type'),
        new Date(nowMs).toISOString(),
      );
      const id = await stageDraft(draft, nowMs);
      return new Response(null, {
        status: 303,
        headers: {
          'cache-control': 'no-store',
          location: `/?shareTarget=${encodeURIComponent(id)}`,
          'referrer-policy': 'no-referrer',
        },
      });
    } catch (error) {
      return errorResponse(error);
    }
  }

  globalScope.ERP4ShareTarget = Object.freeze({
    DB_NAME,
    STORE_NAME,
    MAX_RAW_BYTES,
    MAX_QUEUE_SIZE,
    DRAFT_TTL_MS,
    handleRequest,
    parseMultipartPayload,
    purgeExpiredDrafts,
    stageDraft,
  });
})(self);

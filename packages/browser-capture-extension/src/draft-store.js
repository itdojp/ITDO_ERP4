import {
  CAPTURE_DRAFT_QUEUE_MAX,
  CAPTURE_DRAFT_TTL_MS,
  hasForbiddenUnicode,
  isActorFingerprint,
  isOpaqueId,
  isOpaqueKey,
  isPlainRecord,
  normalizeCaptureDraft,
} from "./capture-contract.js";

const PREFIX = "erp4-browser-capture-draft:";
const LEGACY_RECENT_KEY = "erp4-browser-capture-recent";
const operationPattern = /^[A-Za-z0-9_-]{22,200}$/u;
const usedNonceLimit = 32;
const cleanupTombstoneKeys = new Set([
  "schemaVersion",
  "id",
  "lifecycle",
  "actorFingerprint",
  "createdAt",
  "expiresAt",
  "usedNonces",
]);

function key(id) {
  return `${PREFIX}${id}`;
}

function normalizePendingIntent(value) {
  if (!isPlainRecord(value)) return null;
  const fields = [
    "title",
    "url",
    "selectedText",
    "description",
    "author",
    "publishedAt",
  ];
  const scopes = ["personal", "organization"];
  const sourceTypes = [
    "web",
    "manual",
    "x",
    "threads",
    "news",
    "pdf",
    "image",
    "other",
  ];
  if (
    !Array.isArray(value.selectedFields) ||
    value.selectedFields.length < 1 ||
    value.selectedFields.some(
      (field, index) =>
        typeof field !== "string" ||
        !fields.includes(field) ||
        value.selectedFields.indexOf(field) !== index,
    ) ||
    typeof value.scope !== "string" ||
    !scopes.includes(value.scope) ||
    !Array.isArray(value.organizationGroupAccountIds) ||
    value.organizationGroupAccountIds.length > 100 ||
    value.organizationGroupAccountIds.some(
      (id, index) =>
        typeof id !== "string" ||
        id.length < 1 ||
        id.length > 100 ||
        hasForbiddenUnicode(id) ||
        value.organizationGroupAccountIds.indexOf(id) !== index,
    ) ||
    typeof value.sourceType !== "string" ||
    !sourceTypes.includes(value.sourceType)
  ) {
    return null;
  }
  if (
    (value.scope === "personal" &&
      value.organizationGroupAccountIds.length !== 0) ||
    (value.scope === "organization" &&
      value.organizationGroupAccountIds.length === 0)
  ) {
    return null;
  }
  return {
    selectedFields: [...value.selectedFields],
    scope: value.scope,
    organizationGroupAccountIds: [...value.organizationGroupAccountIds],
    sourceType: value.sourceType,
  };
}

export function normalizeStoredDraft(value, now = Date.now()) {
  if (!isPlainRecord(value)) return null;
  const lifecycle = value.lifecycle;
  const actorFingerprint =
    value.actorFingerprint === null ||
    isActorFingerprint(value.actorFingerprint)
      ? value.actorFingerprint
      : undefined;
  if (
    value.schemaVersion !== 1 ||
    !isOpaqueId(value.id) ||
    actorFingerprint === undefined ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    Date.parse(value.expiresAt) <= now ||
    Date.parse(value.expiresAt) - Date.parse(value.createdAt) !==
      CAPTURE_DRAFT_TTL_MS ||
    !Array.isArray(value.usedNonces) ||
    value.usedNonces.length > usedNonceLimit ||
    value.usedNonces.some(
      (nonce, index) =>
        !isOpaqueKey(nonce) || value.usedNonces.indexOf(nonce) !== index,
    )
  ) {
    return null;
  }
  if (lifecycle === "cleanup_pending") {
    if (
      actorFingerprint === null ||
      Object.keys(value).some((field) => !cleanupTombstoneKeys.has(field))
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      id: value.id,
      lifecycle,
      actorFingerprint,
      createdAt: value.createdAt,
      expiresAt: value.expiresAt,
      usedNonces: [...value.usedNonces],
    };
  }

  const draft = normalizeCaptureDraft(value.draft);
  const pendingIntent =
    lifecycle === "pending"
      ? normalizePendingIntent(value.pendingIntent)
      : null;
  if (
    !isOpaqueKey(value.requestKey) ||
    !draft ||
    (lifecycle !== "staged" && lifecycle !== "pending") ||
    (lifecycle === "pending" &&
      (!pendingIntent ||
        !operationPattern.test(value.pendingOperationId ?? ""))) ||
    (lifecycle === "staged" &&
      (value.pendingIntent !== null || value.pendingOperationId !== null))
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    id: value.id,
    requestKey: value.requestKey,
    lifecycle,
    pendingOperationId:
      lifecycle === "pending" ? value.pendingOperationId : null,
    pendingIntent,
    actorFingerprint,
    draft,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    usedNonces: [...value.usedNonces],
  };
}

export function createChromeSessionStorage(storageArea) {
  return {
    async entries() {
      return Object.entries(await storageArea.get(null));
    },
    async get(storageKey) {
      return (await storageArea.get(storageKey))[storageKey];
    },
    async set(storageKey, value) {
      await storageArea.set({ [storageKey]: value });
    },
    async remove(storageKey) {
      await storageArea.remove(storageKey);
    },
  };
}

export function createDraftStore(storage, clock = () => Date.now()) {
  let serialization = Promise.resolve();
  const serialized = (operation) => {
    const next = serialization.then(operation, operation);
    serialization = next.catch(() => undefined);
    return next;
  };

  const prune = async () => {
    const now = clock();
    const entries = await storage.entries();
    for (const [storageKey, value] of entries) {
      if (!storageKey.startsWith(PREFIX)) continue;
      if (!normalizeStoredDraft(value, now)) await storage.remove(storageKey);
    }
    // Older builds stored a second recent-pointer key after the draft record.
    // That two-write sequence could be interrupted between writes. Recent
    // drafts are now derived from the bounded record set, so remove the legacy
    // pointer instead of treating it as lifecycle state.
    if ((await storage.get(LEGACY_RECENT_KEY)) !== undefined) {
      await storage.remove(LEGACY_RECENT_KEY);
    }
  };

  const read = async (id) => {
    if (!isOpaqueId(id)) return null;
    const value = await storage.get(key(id));
    const normalized = normalizeStoredDraft(value, clock());
    if (!normalized && value !== undefined) await storage.remove(key(id));
    return normalized;
  };

  return {
    prune: () => serialized(prune),
    stage: (input) =>
      serialized(async () => {
        await prune();
        if (!isPlainRecord(input)) throw new Error("invalid_request");
        const draft = normalizeCaptureDraft(input.draft);
        if (!isOpaqueId(input.id) || !isOpaqueKey(input.requestKey) || !draft) {
          throw new Error("invalid_request");
        }
        const existing = await read(input.id);
        if (existing) {
          if (existing.actorFingerprint !== null) throw new Error("not_found");
          if (
            existing.requestKey !== input.requestKey ||
            JSON.stringify(existing.draft) !== JSON.stringify(draft)
          ) {
            throw new Error("state_conflict");
          }
          return existing;
        }
        const count = (await storage.entries()).filter(([storageKey]) =>
          storageKey.startsWith(PREFIX),
        ).length;
        if (count >= CAPTURE_DRAFT_QUEUE_MAX) throw new Error("queue_full");
        const now = clock();
        const createdAt = new Date(now).toISOString();
        const record = {
          schemaVersion: 1,
          id: input.id,
          requestKey: input.requestKey,
          lifecycle: "staged",
          pendingOperationId: null,
          pendingIntent: null,
          actorFingerprint: null,
          draft,
          createdAt,
          expiresAt: new Date(now + CAPTURE_DRAFT_TTL_MS).toISOString(),
          usedNonces: [],
        };
        await storage.set(key(record.id), record);
        return record;
      }),
    recent: () =>
      serialized(async () => {
        await prune();
        const now = clock();
        const candidates = (await storage.entries())
          .filter(([storageKey]) => storageKey.startsWith(PREFIX))
          .map(([, value]) => normalizeStoredDraft(value, now))
          .filter((value) => value?.actorFingerprint === null)
          .sort(
            (left, right) =>
              Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
              right.id.localeCompare(left.id),
          );
        return candidates[0] ?? null;
      }),
    command: (input) =>
      serialized(async () => {
        await prune();
        if (
          !isPlainRecord(input) ||
          !isOpaqueId(input.id) ||
          !isOpaqueKey(input.nonce) ||
          !isActorFingerprint(input.actorFingerprint)
        ) {
          throw new Error("invalid_request");
        }
        const current = await read(input.id);
        if (!current) {
          // Terminal tombstoning and deletion are idempotent. A lost response
          // after physical deletion must converge without revealing whether
          // the draft ever existed. Other commands still fail closed.
          if (input.command === "cleanup" || input.command === "delete") {
            return { transitioned: false, record: null };
          }
          throw new Error("not_found");
        }
        if (
          current.actorFingerprint !== null &&
          current.actorFingerprint !== input.actorFingerprint
        ) {
          throw new Error("not_found");
        }
        if (current.usedNonces.includes(input.nonce)) {
          throw new Error("replayed_nonce");
        }
        if (current.lifecycle === "cleanup_pending") {
          if (input.command === "delete") {
            await storage.remove(key(current.id));
            return { transitioned: true, record: null };
          }
          if (input.command === "get" || input.command === "cleanup") {
            // A terminal tombstone contains no capture content or request key.
            // Once nonce history is full, repeated content-free reads remain
            // safe and a fresh physical delete must still be possible.
            if (current.usedNonces.length >= usedNonceLimit) {
              return { transitioned: false, record: current };
            }
            const observed = {
              ...current,
              usedNonces: [...current.usedNonces, input.nonce],
            };
            await storage.set(key(observed.id), observed);
            return { transitioned: false, record: observed };
          }
          throw new Error("state_conflict");
        }
        // Never evict a nonce while its draft is live. Forgetting an older
        // nonce would let a delayed command become valid again within the
        // draft TTL. Once the bounded history is full, fail closed for every
        // non-terminal command. A fresh delete remains safe because it
        // removes the complete record; a lost delete response then converges
        // through the idempotent not-found branch above.
        if (current.usedNonces.length >= usedNonceLimit) {
          if (input.command === "cleanup") {
            const tombstone = {
              schemaVersion: 1,
              id: current.id,
              lifecycle: "cleanup_pending",
              actorFingerprint: input.actorFingerprint,
              createdAt: current.createdAt,
              expiresAt: current.expiresAt,
              usedNonces: [...current.usedNonces],
            };
            await storage.set(key(tombstone.id), tombstone);
            return { transitioned: true, record: tombstone };
          }
          if (input.command === "delete") {
            await storage.remove(key(current.id));
            return { transitioned: true, record: null };
          }
          throw new Error("state_conflict");
        }
        const claimed = {
          ...current,
          actorFingerprint: input.actorFingerprint,
          usedNonces: [...current.usedNonces, input.nonce],
        };
        if (input.command === "cleanup") {
          const tombstone = {
            schemaVersion: 1,
            id: claimed.id,
            lifecycle: "cleanup_pending",
            actorFingerprint: claimed.actorFingerprint,
            createdAt: claimed.createdAt,
            expiresAt: claimed.expiresAt,
            usedNonces: [...claimed.usedNonces],
          };
          await storage.set(key(tombstone.id), tombstone);
          return { transitioned: true, record: tombstone };
        }
        if (input.command === "get") {
          await storage.set(key(claimed.id), claimed);
          return { transitioned: false, record: claimed };
        }
        if (input.command === "pending") {
          const intent = normalizePendingIntent(input.pendingIntent);
          const draft = normalizeCaptureDraft(input.draft);
          if (
            !operationPattern.test(input.operationId ?? "") ||
            !intent ||
            !draft
          ) {
            throw new Error("invalid_request");
          }
          if (claimed.lifecycle === "pending") {
            if (
              claimed.pendingOperationId === input.operationId &&
              (JSON.stringify(claimed.pendingIntent) !==
                JSON.stringify(intent) ||
                JSON.stringify(claimed.draft) !== JSON.stringify(draft))
            ) {
              throw new Error("state_conflict");
            }
            await storage.set(key(claimed.id), claimed);
            return { transitioned: false, record: claimed };
          }
          const pending = {
            ...claimed,
            lifecycle: "pending",
            pendingOperationId: input.operationId,
            pendingIntent: intent,
            draft,
          };
          await storage.set(key(pending.id), pending);
          return { transitioned: true, record: pending };
        }
        if (input.command === "staged") {
          if (
            claimed.lifecycle !== "pending" ||
            !operationPattern.test(input.operationId ?? "") ||
            claimed.pendingOperationId !== input.operationId
          ) {
            throw new Error("state_conflict");
          }
          const staged = {
            ...claimed,
            lifecycle: "staged",
            pendingOperationId: null,
            pendingIntent: null,
          };
          await storage.set(key(staged.id), staged);
          return { transitioned: true, record: staged };
        }
        if (input.command === "delete") {
          await storage.remove(key(claimed.id));
          return { transitioned: true, record: null };
        }
        throw new Error("invalid_request");
      }),
    discardUnclaimed: (id) =>
      serialized(async () => {
        const current = await read(id);
        if (!current) return;
        if (current.actorFingerprint !== null) throw new Error("not_found");
        await storage.remove(key(id));
      }),
  };
}

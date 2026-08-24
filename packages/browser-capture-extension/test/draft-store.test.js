import assert from "node:assert/strict";
import test from "node:test";

import {
  CAPTURE_DRAFT_QUEUE_MAX,
  CAPTURE_DRAFT_TTL_MS,
  prepareCaptureStageIntent,
} from "../src/capture-contract.js";
import { createDraftStore } from "../src/draft-store.js";

function memoryStorage() {
  const values = new Map();
  return {
    values,
    async entries() {
      return [...values.entries()];
    },
    async get(key) {
      return values.get(key);
    },
    async set(key, value) {
      values.set(key, structuredClone(value));
    },
    async remove(key) {
      values.delete(key);
    },
  };
}

function input(index = 0) {
  return {
    id: index.toString(16).padStart(32, "0"),
    requestKey: `request_key_${String(index).padStart(22, "0")}`,
    draft: {
      schemaVersion: 1,
      channel: "browser_extension",
      title: `Synthetic ${index}`,
      url: "https://example.invalid/",
      selectedText: "selected",
      description: null,
      author: null,
      publishedAt: null,
      capturedAt: "2026-08-14T00:00:00.000Z",
    },
  };
}

const actor = "a".repeat(64);
const otherActor = "b".repeat(64);
const nonce = (character) => character.repeat(24);
const indexedNonce = (index) => `nonce_${String(index).padStart(22, "0")}`;
const pendingIntent = {
  selectedFields: ["title", "url", "selectedText"],
  scope: "personal",
  organizationGroupAccountIds: [],
  sourceType: "web",
};

test("claims a staged draft, fixes exact pending intent, and restores only its operation", async () => {
  const storage = memoryStorage();
  const now = Date.parse("2026-08-14T00:00:00.000Z");
  const store = createDraftStore(storage, () => now);
  const staged = await store.stage(input());
  assert.equal(staged.actorFingerprint, null);

  const claimed = await store.command({
    command: "get",
    id: input().id,
    nonce: nonce("c"),
    actorFingerprint: actor,
  });
  assert.equal(claimed.record.actorFingerprint, actor);

  const pending = await store.command({
    command: "pending",
    id: input().id,
    nonce: nonce("d"),
    actorFingerprint: actor,
    operationId: nonce("o"),
    pendingIntent,
    draft: { ...input().draft, title: "Edited exact title" },
  });
  assert.equal(pending.transitioned, true);
  assert.equal(pending.record.lifecycle, "pending");
  assert.equal(pending.record.draft.title, "Edited exact title");

  const resumed = await store.command({
    command: "pending",
    id: input().id,
    nonce: nonce("h"),
    actorFingerprint: actor,
    operationId: nonce("o"),
    pendingIntent,
    draft: { ...input().draft, title: "Edited exact title" },
  });
  assert.equal(resumed.transitioned, false);
  assert.equal(resumed.record.pendingOperationId, nonce("o"));

  await assert.rejects(
    store.command({
      command: "pending",
      id: input().id,
      nonce: nonce("i"),
      actorFingerprint: actor,
      operationId: nonce("o"),
      pendingIntent,
      draft: { ...input().draft, title: "Mismatched retry" },
    }),
    /state_conflict/u,
  );

  const loser = await store.command({
    command: "pending",
    id: input().id,
    nonce: nonce("e"),
    actorFingerprint: actor,
    operationId: nonce("p"),
    pendingIntent,
    draft: input().draft,
  });
  assert.equal(loser.transitioned, false);
  assert.equal(loser.record.pendingOperationId, nonce("o"));

  await assert.rejects(
    store.command({
      command: "staged",
      id: input().id,
      nonce: nonce("f"),
      actorFingerprint: actor,
      operationId: nonce("p"),
    }),
    /state_conflict/u,
  );
  const restored = await store.command({
    command: "staged",
    id: input().id,
    nonce: nonce("g"),
    actorFingerprint: actor,
    operationId: nonce("o"),
  });
  assert.equal(restored.record.lifecycle, "staged");
});

test("rejects actor switching and one-time nonce replay without revealing the record", async () => {
  const storage = memoryStorage();
  const now = Date.parse("2026-08-14T00:00:00.000Z");
  const store = createDraftStore(storage, () => now);
  await store.stage(input());
  await store.command({
    command: "get",
    id: input().id,
    nonce: nonce("h"),
    actorFingerprint: actor,
  });
  await assert.rejects(
    store.command({
      command: "get",
      id: input().id,
      nonce: nonce("i"),
      actorFingerprint: otherActor,
    }),
    /not_found/u,
  );
  await assert.rejects(
    store.command({
      command: "get",
      id: input().id,
      nonce: nonce("h"),
      actorFingerprint: actor,
    }),
    /replayed_nonce/u,
  );
});

test("fails closed when nonce history is full and still permits terminal cleanup", async () => {
  const storage = memoryStorage();
  const now = Date.parse("2026-08-14T00:00:00.000Z");
  const store = createDraftStore(storage, () => now);
  await store.stage(input());

  for (let index = 0; index < 32; index += 1) {
    await store.command({
      command: "get",
      id: input().id,
      nonce: indexedNonce(index),
      actorFingerprint: actor,
    });
  }
  await assert.rejects(
    store.command({
      command: "get",
      id: input().id,
      nonce: indexedNonce(32),
      actorFingerprint: actor,
    }),
    /state_conflict/u,
  );
  await assert.rejects(
    store.command({
      command: "get",
      id: input().id,
      nonce: indexedNonce(0),
      actorFingerprint: actor,
    }),
    /replayed_nonce/u,
  );

  const removed = await store.command({
    command: "delete",
    id: input().id,
    nonce: indexedNonce(33),
    actorFingerprint: actor,
  });
  assert.equal(removed.record, null);
  assert.deepEqual(
    await store.command({
      command: "delete",
      id: input().id,
      nonce: indexedNonce(33),
      actorFingerprint: actor,
    }),
    { transitioned: false, record: null },
  );
});

test("serializes concurrent pending transitions onto one operation", async () => {
  const storage = memoryStorage();
  const now = Date.parse("2026-08-14T00:00:00.000Z");
  const store = createDraftStore(storage, () => now);
  await store.stage(input());
  const [first, second] = await Promise.all([
    store.command({
      command: "pending",
      id: input().id,
      nonce: nonce("j"),
      actorFingerprint: actor,
      operationId: nonce("q"),
      pendingIntent,
      draft: input().draft,
    }),
    store.command({
      command: "pending",
      id: input().id,
      nonce: nonce("k"),
      actorFingerprint: actor,
      operationId: nonce("r"),
      pendingIntent,
      draft: input().draft,
    }),
  ]);
  assert.equal([first, second].filter((value) => value.transitioned).length, 1);
  assert.equal(
    first.record.pendingOperationId,
    second.record.pendingOperationId,
  );
});

test("bounds the session queue and removes expired content on the next execution", async () => {
  const storage = memoryStorage();
  let now = Date.parse("2026-08-14T00:00:00.000Z");
  const store = createDraftStore(storage, () => now);
  for (let index = 0; index < CAPTURE_DRAFT_QUEUE_MAX; index += 1) {
    await store.stage(input(index));
  }
  await assert.rejects(
    store.stage(input(CAPTURE_DRAFT_QUEUE_MAX)),
    /queue_full/u,
  );
  now += CAPTURE_DRAFT_TTL_MS + 1;
  await store.prune();
  assert.equal(
    [...storage.values.keys()].some((key) =>
      key.startsWith("erp4-browser-capture-draft:"),
    ),
    false,
  );
});

test("popup discard cannot remove a draft after canonical actor claim", async () => {
  const storage = memoryStorage();
  const now = Date.parse("2026-08-14T00:00:00.000Z");
  const store = createDraftStore(storage, () => now);
  await store.stage(input());
  await store.command({
    command: "get",
    id: input().id,
    nonce: nonce("s"),
    actorFingerprint: actor,
  });
  await assert.rejects(store.discardUnclaimed(input().id), /not_found/u);
  const removed = await store.command({
    command: "delete",
    id: input().id,
    nonce: nonce("t"),
    actorFingerprint: actor,
  });
  assert.equal(removed.record, null);
});

test("claimed drafts are not returned to the unauthenticated popup", async () => {
  const storage = memoryStorage();
  const now = Date.parse("2026-08-14T00:00:00.000Z");
  const store = createDraftStore(storage, () => now);
  const stagedInput = input(6);
  await store.stage(stagedInput);
  assert.equal((await store.recent())?.id, stagedInput.id);
  await store.command({
    command: "get",
    id: stagedInput.id,
    nonce: "n".repeat(32),
    actorFingerprint: "a".repeat(64),
  });
  assert.equal(await store.recent(), null);
  await assert.rejects(store.stage(stagedInput), /not_found/u);
});

test("same local draft ID accepts only the exact staged request", async () => {
  const storage = memoryStorage();
  const now = Date.parse("2026-08-14T00:00:00.000Z");
  const store = createDraftStore(storage, () => now);
  const stagedInput = input(7);
  const first = await store.stage(stagedInput);
  assert.equal((await store.stage(stagedInput)).id, first.id);
  await assert.rejects(
    store.stage({ ...stagedInput, requestKey: "s".repeat(32) }),
    /state_conflict/u,
  );
  await assert.rejects(
    store.stage({
      ...stagedInput,
      draft: {
        ...stagedInput.draft,
        title: "Different synthetic title",
      },
    }),
    /state_conflict/u,
  );
});

test("popup retry intent converges after a successful stage response is lost", async () => {
  const storage = memoryStorage();
  const now = Date.parse("2026-08-14T00:00:00.000Z");
  const store = createDraftStore(storage, () => now);
  const draft = input(70).draft;
  const firstIntent = prepareCaptureStageIntent(
    draft,
    ["title", "url", "selectedText"],
    null,
  );
  assert.ok(firstIntent);

  await store.stage(firstIntent);
  // A new popup/service-worker instance must recover the staged record from
  // the bounded record set without a separately-written recent pointer.
  const reopenedStore = createDraftStore(storage, () => now);
  assert.equal((await reopenedStore.recent())?.id, firstIntent.id);
  const retryIntent = prepareCaptureStageIntent(
    draft,
    ["title", "url", "selectedText"],
    firstIntent,
  );
  assert.strictEqual(retryIntent, firstIntent);
  assert.equal((await store.stage(retryIntent)).id, firstIntent.id);
  assert.equal(
    [...storage.values.keys()].filter((key) =>
      key.startsWith("erp4-browser-capture-draft:"),
    ).length,
    1,
  );
  assert.equal(storage.values.has("erp4-browser-capture-recent"), false);
});

test("accepts the complete source allowlist and enforces exact scope groups", async () => {
  const storage = memoryStorage();
  const now = Date.parse("2026-08-14T00:00:00.000Z");
  const store = createDraftStore(storage, () => now);
  await store.stage(input(8));

  await assert.rejects(
    store.command({
      command: "pending",
      id: input(8).id,
      nonce: nonce("u"),
      actorFingerprint: actor,
      operationId: nonce("v"),
      pendingIntent: {
        ...pendingIntent,
        organizationGroupAccountIds: ["synthetic-group"],
      },
      draft: input(8).draft,
    }),
    /invalid_request/u,
  );
  await assert.rejects(
    store.command({
      command: "pending",
      id: input(8).id,
      nonce: nonce("w"),
      actorFingerprint: actor,
      operationId: nonce("x"),
      pendingIntent: {
        ...pendingIntent,
        scope: "organization",
      },
      draft: input(8).draft,
    }),
    /invalid_request/u,
  );

  const accepted = await store.command({
    command: "pending",
    id: input(8).id,
    nonce: nonce("y"),
    actorFingerprint: actor,
    operationId: nonce("z"),
    pendingIntent: { ...pendingIntent, sourceType: "other" },
    draft: input(8).draft,
  });
  assert.equal(accepted.record.pendingIntent.sourceType, "other");

  await store.stage(input(10));
  const oneHundredGroups = Array.from(
    { length: 100 },
    (_, index) => `synthetic-group-${String(index).padStart(3, "0")}`,
  );
  const organization = await store.command({
    command: "pending",
    id: input(10).id,
    nonce: nonce("2"),
    actorFingerprint: actor,
    operationId: nonce("3"),
    pendingIntent: {
      ...pendingIntent,
      scope: "organization",
      organizationGroupAccountIds: oneHundredGroups,
    },
    draft: input(10).draft,
  });
  assert.equal(
    organization.record.pendingIntent.organizationGroupAccountIds.length,
    100,
  );

  await store.stage(input(11));
  await assert.rejects(
    store.command({
      command: "pending",
      id: input(11).id,
      nonce: nonce("4"),
      actorFingerprint: actor,
      operationId: nonce("5"),
      pendingIntent: {
        ...pendingIntent,
        scope: "organization",
        organizationGroupAccountIds: [
          ...oneHundredGroups,
          "synthetic-group-over-limit",
        ],
      },
      draft: input(11).draft,
    }),
    /invalid_request/u,
  );
});

test("terminal delete remains idempotent after a response is lost", async () => {
  const storage = memoryStorage();
  const now = Date.parse("2026-08-14T00:00:00.000Z");
  const store = createDraftStore(storage, () => now);
  await store.stage(input(9));
  const first = await store.command({
    command: "delete",
    id: input(9).id,
    nonce: nonce("1"),
    actorFingerprint: actor,
  });
  assert.equal(first.transitioned, true);
  const retry = await store.command({
    command: "delete",
    id: input(9).id,
    nonce: nonce("2"),
    actorFingerprint: actor,
  });
  assert.deepEqual(retry, { transitioned: false, record: null });
});

test("persists a content-free tombstone before retrying physical deletion", async () => {
  const storage = memoryStorage();
  const now = Date.parse("2026-08-14T00:00:00.000Z");
  const store = createDraftStore(storage, () => now);
  await store.stage(input(13));
  await store.command({
    command: "get",
    id: input(13).id,
    nonce: nonce("6"),
    actorFingerprint: actor,
  });

  const cleanup = await store.command({
    command: "cleanup",
    id: input(13).id,
    nonce: nonce("7"),
    actorFingerprint: actor,
  });
  assert.equal(cleanup.transitioned, true);
  assert.equal(cleanup.record.lifecycle, "cleanup_pending");
  for (const sensitiveField of [
    "requestKey",
    "draft",
    "pendingIntent",
    "pendingOperationId",
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(cleanup.record, sensitiveField),
      false,
    );
  }
  assert.equal(await store.recent(), null);

  // A response loss after the tombstone write converges without restoring
  // content, and a physical delete failure leaves only the tombstone behind.
  const repeatedCleanup = await store.command({
    command: "cleanup",
    id: input(13).id,
    nonce: nonce("8"),
    actorFingerprint: actor,
  });
  assert.equal(repeatedCleanup.transitioned, false);
  assert.equal(repeatedCleanup.record.lifecycle, "cleanup_pending");

  const remove = storage.remove.bind(storage);
  let rejectPhysicalDelete = true;
  storage.remove = async (storageKey) => {
    if (rejectPhysicalDelete && storageKey.endsWith(input(13).id)) {
      rejectPhysicalDelete = false;
      throw new Error("synthetic physical delete failure");
    }
    await remove(storageKey);
  };
  await assert.rejects(
    store.command({
      command: "delete",
      id: input(13).id,
      nonce: nonce("9"),
      actorFingerprint: actor,
    }),
    /synthetic physical delete failure/u,
  );

  const reopened = createDraftStore(storage, () => now);
  const observed = await reopened.command({
    command: "get",
    id: input(13).id,
    nonce: nonce("a"),
    actorFingerprint: actor,
  });
  assert.equal(observed.record.lifecycle, "cleanup_pending");
  assert.equal("draft" in observed.record, false);
  assert.equal("requestKey" in observed.record, false);

  await reopened.command({
    command: "delete",
    id: input(13).id,
    nonce: nonce("b"),
    actorFingerprint: actor,
  });
  assert.deepEqual(
    await reopened.command({
      command: "delete",
      id: input(13).id,
      nonce: nonce("c"),
      actorFingerprint: actor,
    }),
    { transitioned: false, record: null },
  );
  assert.deepEqual(
    await reopened.command({
      command: "cleanup",
      id: input(13).id,
      nonce: nonce("d"),
      actorFingerprint: actor,
    }),
    { transitioned: false, record: null },
  );
});

test("popup discard converges after physical deletion response loss", async () => {
  const storage = memoryStorage();
  const now = Date.parse("2026-08-14T00:00:00.000Z");
  const store = createDraftStore(storage, () => now);
  await store.stage(input(12));
  await store.discardUnclaimed(input(12).id);
  await store.discardUnclaimed(input(12).id);
  assert.equal(
    [...storage.values.keys()].some((storageKey) =>
      storageKey.endsWith(input(12).id),
    ),
    false,
  );
});

import { ERP4_CAPTURE_ORIGIN } from "./config.js";
import {
  isActorFingerprint,
  isOpaqueId,
  isOpaqueKey,
  isPlainRecord,
} from "./capture-contract.js";
import { isExactErp4Sender, isExtensionPageSender } from "./bridge-contract.js";
import { createChromeSessionStorage, createDraftStore } from "./draft-store.js";

const store = createDraftStore(
  createChromeSessionStorage(chrome.storage.session),
);

const safeCode = (error) => {
  const code = error instanceof Error ? error.message : "";
  return [
    "invalid_request",
    "not_found",
    "queue_full",
    "replayed_nonce",
    "state_conflict",
  ].includes(code)
    ? code
    : "storage_unavailable";
};

function safeRecord(record) {
  if (!record) return null;
  if (record.lifecycle === "cleanup_pending") {
    return {
      schemaVersion: 1,
      id: record.id,
      lifecycle: record.lifecycle,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    };
  }
  return {
    schemaVersion: 1,
    id: record.id,
    requestKey: record.requestKey,
    lifecycle: record.lifecycle,
    pendingOperationId: record.pendingOperationId,
    pendingIntent: record.pendingIntent,
    draft: record.draft,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
  };
}

async function handleExtensionPageMessage(message, sender) {
  if (
    !isExtensionPageSender(sender, chrome.runtime) ||
    !isPlainRecord(message)
  ) {
    return { ok: false, code: "invalid_request" };
  }
  try {
    if (message.type === "erp4-browser-capture-stage-v1") {
      const record = await store.stage({
        id: message.id,
        requestKey: message.requestKey,
        draft: message.draft,
      });
      return { ok: true, record: safeRecord(record) };
    }
    if (message.type === "erp4-browser-capture-recent-v1") {
      return { ok: true, record: safeRecord(await store.recent()) };
    }
    if (
      message.type === "erp4-browser-capture-discard-unclaimed-v1" &&
      isOpaqueId(message.id)
    ) {
      await store.discardUnclaimed(message.id);
      return { ok: true, record: null };
    }
    return { ok: false, code: "invalid_request" };
  } catch (error) {
    return { ok: false, code: safeCode(error) };
  }
}

async function handleErp4Message(message, sender) {
  if (
    !isExactErp4Sender(sender, chrome.runtime, ERP4_CAPTURE_ORIGIN) ||
    !isPlainRecord(message) ||
    message.type !== "erp4-browser-capture-command-v1" ||
    message.schemaVersion !== 1 ||
    !["get", "pending", "staged", "cleanup", "delete"].includes(
      message.command,
    ) ||
    !isOpaqueId(message.id) ||
    !isOpaqueKey(message.nonce) ||
    !isActorFingerprint(message.actorFingerprint)
  ) {
    return { ok: false, code: "invalid_request" };
  }
  try {
    const result = await store.command({
      command: message.command,
      id: message.id,
      nonce: message.nonce,
      actorFingerprint: message.actorFingerprint,
      operationId: message.operationId,
      pendingIntent: message.pendingIntent,
      draft: message.draft,
    });
    return {
      ok: true,
      transitioned: result.transitioned,
      record: safeRecord(result.record),
    };
  } catch (error) {
    return { ok: false, code: safeCode(error) };
  }
}

async function initialize() {
  await chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  await store.prune();
}

chrome.runtime.onInstalled.addListener(() => {
  void initialize().catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => {
  void initialize().catch(() => undefined);
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const response = isExtensionPageSender(sender, chrome.runtime)
    ? handleExtensionPageMessage(message, sender)
    : handleErp4Message(message, sender);
  void response
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, code: "storage_unavailable" }));
  // Keep the message channel open without depending on Promise-returning
  // listener support in older managed Chromium deployments.
  return true;
});

void initialize().catch(() => undefined);

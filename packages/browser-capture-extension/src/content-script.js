(() => {
  const exactOrigin = __ERP4_CAPTURE_ORIGIN_JSON__;
  const commands = new Set(["get", "pending", "staged", "cleanup", "delete"]);
  const opaqueId = /^[0-9a-f]{32}$/u;
  const opaqueKey = /^[A-Za-z0-9_-]{22,200}$/u;
  const actorFingerprint = /^[0-9a-f]{64}$/u;

  if (window.location.origin !== exactOrigin) return;

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== exactOrigin ||
      !event.data ||
      typeof event.data !== "object" ||
      Array.isArray(event.data)
    ) {
      return;
    }
    const message = event.data;
    if (
      message.source !== "erp4-page" ||
      message.type !== "erp4-browser-capture-command-v1" ||
      message.schemaVersion !== 1 ||
      !commands.has(message.command) ||
      !opaqueId.test(message.id ?? "") ||
      !opaqueKey.test(message.nonce ?? "") ||
      !actorFingerprint.test(message.actorFingerprint ?? "")
    ) {
      return;
    }
    const request = {
      type: "erp4-browser-capture-command-v1",
      schemaVersion: 1,
      command: message.command,
      id: message.id,
      nonce: message.nonce,
      actorFingerprint: message.actorFingerprint,
      ...(message.operationId ? { operationId: message.operationId } : {}),
      ...(message.pendingIntent
        ? { pendingIntent: message.pendingIntent }
        : {}),
      ...(message.draft ? { draft: message.draft } : {}),
    };
    chrome.runtime
      .sendMessage(request)
      .then((response) => {
        window.postMessage(
          {
            source: "erp4-extension",
            type: "erp4-browser-capture-response-v1",
            schemaVersion: 1,
            command: message.command,
            id: message.id,
            nonce: message.nonce,
            response,
          },
          exactOrigin,
        );
      })
      .catch(() => {
        window.postMessage(
          {
            source: "erp4-extension",
            type: "erp4-browser-capture-response-v1",
            schemaVersion: 1,
            command: message.command,
            id: message.id,
            nonce: message.nonce,
            response: { ok: false, code: "extension_unavailable" },
          },
          exactOrigin,
        );
      });
  });
})();

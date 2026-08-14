export function isExtensionPageSender(sender, runtime) {
  return (
    sender?.id === runtime.id &&
    typeof sender.url === "string" &&
    sender.url.startsWith(runtime.getURL(""))
  );
}

export function isExactErp4Sender(sender, runtime, erp4Origin) {
  try {
    const senderUrl = new URL(sender?.url ?? sender?.tab?.url ?? "");
    const senderOrigin = sender?.origin
      ? new URL(sender.origin).origin
      : senderUrl.origin;
    return (
      sender?.id === runtime.id &&
      senderUrl.origin === erp4Origin &&
      senderOrigin === erp4Origin
    );
  } catch {
    return false;
  }
}

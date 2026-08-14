export const forbiddenExtensionCapabilities = [
  /\bchrome\.cookies\b/u,
  /\bchrome\.history\b/u,
  /\bchrome\.webRequest\b/u,
  /\bchrome\.downloads\b/u,
  /\bchrome\.debugger\b/u,
  /\bchrome\.nativeMessaging\b/u,
  /\binnerHTML\b/u,
  /\beval\s*\(/u,
  /\bnew\s+Function\b/u,
  /\bfetch\s*\(/u,
  /\bXMLHttpRequest\b/u,
  /\bWebSocket\b/u,
  /\bEventSource\b/u,
  /\bsendBeacon\s*\(/u,
  /\bchrome\.storage\.(?:local|sync|managed)\b/u,
  /\bdocument\.cookie\b/u,
  /\blocalStorage\b/u,
  /\bsessionStorage\b/u,
];

export function assertNoForbiddenExtensionCapabilities(source, label) {
  const matched = forbiddenExtensionCapabilities.find((pattern) =>
    pattern.test(source),
  );
  if (matched) throw new Error(`forbidden ${label} capability: ${matched}`);
}

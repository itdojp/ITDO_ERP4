export const CAPTURE_SCHEMA_VERSION = 1;
export const CAPTURE_DRAFT_TTL_MS = 10 * 60 * 1000;
export const CAPTURE_DRAFT_QUEUE_MAX = 10;
export const CAPTURE_BRIDGE_TIMEOUT_MS = 5_000;

export const captureFields = [
  "title",
  "url",
  "selectedText",
  "description",
  "author",
  "publishedAt",
];

export const captureLimits = {
  titleCodePoints: 500,
  urlBytes: 4_096,
  selectedTextBytes: 64 * 1024,
  descriptionBytes: 16 * 1024,
  authorCodePoints: 500,
  publishedAtBytes: 200,
  totalBytes: 128 * 1024,
};

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const encoder = new TextEncoder();
const trackingQueryName = /^(?:utm_.+|fbclid|gclid|mc_cid|mc_eid)$/iu;
const credentialQueryTokens = new Set([
  "assertion",
  "auth",
  "authorization",
  "code",
  "credential",
  "expires",
  "jwt",
  "key",
  "oauth",
  "passphrase",
  "passwd",
  "password",
  "policy",
  "proof",
  "pwd",
  "relaystate",
  "samlartifact",
  "samlart",
  "samlrequest",
  "sid",
  "secret",
  "sessid",
  "session",
  "sig",
  "signature",
  "state",
  "ticket",
  "token",
  "verifier",
]);
const credentialPathSegmentNames = new Set([
  "accesstoken",
  "apikey",
  "credential",
  "jsessionid",
  "jwt",
  "password",
  "passwd",
  "phpsessid",
  "privatekey",
  "pwd",
  "refreshtoken",
  "resourcekey",
  "samlart",
  "samlartifact",
  "secret",
  "session",
  "sessionid",
  "sessid",
  "sid",
  "ticket",
  "token",
]);
const nestedUrlCandidateLimit = 32;
const nestedUrlParseOperationLimit = 128;

export function isPlainRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function hasForbiddenUnicode(value) {
  if (typeof value !== "string") return true;
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

export function utf8Bytes(value) {
  return encoder.encode(value).byteLength;
}

function cleanString(value, { bytes, codePoints } = {}) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || hasForbiddenUnicode(value)) return undefined;
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (!normalized) return null;
  if (
    (bytes !== undefined && utf8Bytes(normalized) > bytes) ||
    (codePoints !== undefined && Array.from(normalized).length > codePoints)
  ) {
    return undefined;
  }
  return normalized;
}

function exactInstant(value, required) {
  const candidate = cleanString(value, {
    bytes: captureLimits.publishedAtBytes,
  });
  if (candidate === undefined || (required && candidate === null))
    return undefined;
  if (candidate === null) return null;
  const parsed = new Date(candidate);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === candidate
    ? candidate
    : undefined;
}

function isCredentialQueryName(name) {
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
  if (tokens.some((token) => credentialQueryTokens.has(token))) return true;
  const compact = name.toLowerCase().replace(/[^a-z0-9]/gu, "");
  if (compact.startsWith("xamz") || compact.startsWith("xgoog")) return true;
  if (
    [
      "auth",
      "awsaccesskeyid",
      "code",
      "expires",
      "googleaccessid",
      "key",
      "keypairid",
      "policy",
      "privatekey",
      "phpsessid",
      "relaystate",
      "resourcekey",
      "samlart",
      "samlartifact",
      "samlrequest",
      "sessid",
      "sig",
      "sid",
      "state",
    ].includes(compact)
  ) {
    return true;
  }
  return [
    "accesstoken",
    "accesskey",
    "apikey",
    "assertion",
    "authorization",
    "clientassertion",
    "credential",
    "dpop",
    "googleaccessid",
    "jwt",
    "oauth",
    "passphrase",
    "passwd",
    "password",
    "privatekey",
    "proof",
    "resourcekey",
    "samlresponse",
    "secret",
    "session",
    "signature",
    "signedheaders",
    "softwarestatement",
    "ticket",
    "token",
    "verifier",
    "wresult",
  ].some((marker) => compact.includes(marker));
}

const percentEncodedByte = /%([0-9a-f]{2})/giu;

function decodePercentBytes(value) {
  return value.replace(percentEncodedByte, (_match, byte) =>
    String.fromCharCode(Number.parseInt(byte, 16)),
  );
}

function isCredentialQueryNameDeep(name) {
  let candidate = name;
  const maximumLayers = Math.floor(candidate.length / 2) + 1;
  for (let index = 0; index <= maximumLayers; index += 1) {
    if (isCredentialQueryName(candidate)) return true;
    const decoded = decodePercentBytes(candidate);
    if (decoded === candidate) return candidate.includes("%");
    if (index === maximumLayers) return true;
    candidate = decoded;
  }
  return true;
}

function isCredentialPathSegmentDeep(segment) {
  let candidate = segment;
  const maximumLayers = Math.floor(candidate.length / 2) + 1;
  for (let index = 0; index <= maximumLayers; index += 1) {
    const compact = candidate.toLowerCase().replace(/[^a-z0-9]/gu, "");
    if (credentialPathSegmentNames.has(compact)) return true;
    const decoded = decodePercentBytes(candidate);
    if (decoded === candidate) return candidate.includes("%");
    if (index === maximumLayers) return true;
    candidate = decoded;
  }
  return true;
}

function hasCredentialNamedPath(value) {
  const segments = value.split("/").filter(Boolean);
  return segments.some(
    (segment, index) =>
      index + 1 < segments.length &&
      isCredentialPathSegmentDeep(segment) &&
      segments[index + 1].length > 0,
  );
}

function hasCredentialQueryParams(value) {
  const pending = [value.replace(/;/gu, "&")];
  const inspected = new Set();
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (candidate === undefined || inspected.has(candidate)) continue;
    inspected.add(candidate);
    const params = new URLSearchParams(candidate);
    for (const [name, nestedValue] of params.entries()) {
      if (isCredentialQueryNameDeep(name)) return true;
      if (nestedValue.includes("=") && nestedValue.length < candidate.length) {
        pending.push(nestedValue.replace(/;/gu, "&"));
      }
    }
  }
  return false;
}

function hasCredentialQueryText(value) {
  for (const separator of ["?", "#"]) {
    const index = value.indexOf(separator);
    if (index >= 0 && hasCredentialQueryParams(value.slice(index + 1))) {
      return true;
    }
  }
  const embeddedDelimiterIndex = value.search(/[&;]/u);
  return (
    embeddedDelimiterIndex >= 0 &&
    hasCredentialQueryParams(value.slice(embeddedDelimiterIndex + 1))
  );
}

function hasCredentialQueryAssignment(value) {
  const assignmentIndex = value.indexOf("=");
  return assignmentIndex > 0 && hasCredentialQueryParams(value);
}

function hasUrlParserIgnoredAsciiWhitespace(value) {
  return value.includes("\t") || value.includes("\n") || value.includes("\r");
}

function startsWithAsciiIgnoreCase(value, index, expected) {
  if (index + expected.length > value.length) return false;
  for (let offset = 0; offset < expected.length; offset += 1) {
    const code = value.charCodeAt(index + offset);
    const foldedCode = code >= 0x41 && code <= 0x5a ? code + 0x20 : code;
    if (foldedCode !== expected.charCodeAt(offset)) return false;
  }
  return true;
}

function startsWithHttpScheme(value, index) {
  return (
    startsWithAsciiIgnoreCase(value, index, "http:") ||
    startsWithAsciiIgnoreCase(value, index, "https:")
  );
}

function createNestedUrlParseBudget() {
  return { remaining: nestedUrlParseOperationLimit };
}

function consumeNestedUrlParseBudget(budget) {
  if (budget.remaining <= 0) return false;
  budget.remaining -= 1;
  return true;
}

function findNestedUrlStarts(value) {
  const starts = [];
  for (let index = 0; index < value.length; index += 1) {
    const current = value[index];
    const next = value[index + 1];
    const isSlashLikePair =
      (current === "/" || current === "\\") && (next === "/" || next === "\\");
    if (!isSlashLikePair && !startsWithHttpScheme(value, index)) {
      continue;
    }
    starts.push(index);
    if (starts.length > nestedUrlCandidateLimit) return null;
  }
  return starts;
}

function hasNestedUrlMarker(value) {
  const starts = findNestedUrlStarts(value);
  return starts === null || starts.length > 0;
}

function parseNestedHttpUrl(value, budget) {
  // WHATWG URL parsing removes ASCII TAB/LF/CR before parsing. Reject these
  // characters at every decode layer so they cannot split an embedded scheme
  // during inspection and then be removed by a later URL consumer.
  let candidate = value;
  const maximumLayers = Math.floor(candidate.length / 2) + 1;
  for (let index = 0; index <= maximumLayers; index += 1) {
    if (hasUrlParserIgnoredAsciiWhitespace(candidate)) {
      return { kind: "unsafe" };
    }
    candidate = candidate.trim();
    if (
      hasCredentialQueryAssignment(candidate) ||
      hasCredentialQueryText(candidate)
    ) {
      return { kind: "unsafe" };
    }
    // WHATWG accepts HTTP(S) special URLs with zero, one, or two slash-like
    // separators. Inspect every bounded absolute or scheme-relative marker so
    // an earlier malformed candidate cannot hide later nested userinfo.
    const nestedUrlStarts = findNestedUrlStarts(candidate);
    if (nestedUrlStarts === null) return { kind: "unsafe" };
    const parseStarts =
      nestedUrlStarts.length > 0
        ? nestedUrlStarts
        : candidate.startsWith("/") ||
            candidate.startsWith("\\") ||
            candidate.startsWith("?")
          ? [0]
          : [];
    let firstParsedUrl;
    let parseFailed = false;
    for (const nestedUrlIndex of parseStarts) {
      const parseCandidate = candidate.slice(nestedUrlIndex);
      if (!consumeNestedUrlParseBudget(budget)) return { kind: "unsafe" };
      try {
        const parsed = startsWithHttpScheme(parseCandidate, 0)
          ? new URL(parseCandidate)
          : new URL(parseCandidate, "https://nested.invalid");
        if (parsed.protocol === "https:" || parsed.protocol === "http:") {
          if (parsed.username || parsed.password) {
            return { kind: "url", url: parsed };
          }
          firstParsedUrl ??= parsed;
        }
      } catch {
        parseFailed = true;
      }
    }
    if (firstParsedUrl && !parseFailed) {
      return { kind: "url", url: firstParsedUrl };
    }
    const decoded = decodePercentBytes(candidate);
    if (decoded === candidate) {
      return parseFailed ? { kind: "unsafe" } : { kind: "none" };
    }
    if (index === maximumLayers) return { kind: "unsafe" };
    candidate = decoded;
  }
  return { kind: "unsafe" };
}

function hasCredentialFragment(url, budget, depth = 0) {
  if (!url.hash) return false;
  const nested = parseNestedHttpUrl(url.hash, budget);
  if (nested.kind === "unsafe") return true;
  if (nested.kind === "none") return false;
  if (nested.url.username || nested.url.password || depth >= 3) return true;
  return (
    hasCredentialFragment(nested.url, budget, depth + 1) ||
    hasCredentialBearingPath(nested.url, budget, depth + 1) ||
    hasCredentialBearingNestedUrl(nested.url, budget, depth + 1)
  );
}

function hasCredentialBearingNestedUrl(url, budget, depth = 0) {
  for (const [name, value] of url.searchParams.entries()) {
    if (isCredentialQueryNameDeep(name)) return true;
    const nested = parseNestedHttpUrl(value, budget);
    if (nested.kind === "unsafe") return true;
    if (nested.kind === "none") continue;
    if (
      nested.url.username ||
      nested.url.password ||
      hasCredentialFragment(nested.url, budget, depth + 1) ||
      hasCredentialBearingPath(nested.url, budget, depth + 1) ||
      depth >= 3 ||
      hasCredentialBearingNestedUrl(nested.url, budget, depth + 1)
    ) {
      return true;
    }
  }
  return false;
}

function hasCredentialBearingPath(url, budget, depth = 0) {
  let candidate = url.pathname;
  const maximumLayers = Math.floor(candidate.length / 2) + 1;
  for (let index = 0; index <= maximumLayers; index += 1) {
    if (
      hasCredentialQueryText(candidate) ||
      hasCredentialNamedPath(candidate) ||
      candidate
        .split("/")
        .some(
          (segment) =>
            segment.includes(";") &&
            hasCredentialQueryParams(segment.slice(segment.indexOf(";") + 1)),
        )
    ) {
      return true;
    }
    const nested = parseNestedHttpUrl(candidate, budget);
    if (nested.kind === "unsafe") return true;
    if (
      nested.kind === "url" &&
      (nested.url.username ||
        nested.url.password ||
        hasCredentialFragment(nested.url, budget, depth + 1) ||
        hasCredentialBearingNestedUrl(nested.url, budget, depth + 1) ||
        (hasNestedUrlMarker(candidate) &&
          (depth >= 3 ||
            hasCredentialBearingPath(nested.url, budget, depth + 1))))
    ) {
      return true;
    }
    const decoded = decodePercentBytes(candidate);
    if (decoded === candidate) return false;
    if (index === maximumLayers) return true;
    candidate = decoded;
  }
  return true;
}

function safeUrl(value) {
  const candidate = cleanString(value, { bytes: captureLimits.urlBytes });
  if (candidate === undefined || candidate === null) return candidate;
  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password
    ) {
      return undefined;
    }
    const budget = createNestedUrlParseBudget();
    if (
      hasCredentialFragment(parsed, budget) ||
      hasCredentialBearingPath(parsed, budget)
    ) {
      return undefined;
    }
    if (hasCredentialBearingNestedUrl(parsed, budget)) return undefined;
    parsed.hash = "";
    for (const [name] of [...parsed.searchParams.entries()]) {
      if (trackingQueryName.test(name)) parsed.searchParams.delete(name);
    }
    parsed.searchParams.sort();
    return parsed.href;
  } catch {
    return undefined;
  }
}

function hasDangerousShape(value) {
  return (
    !isPlainRecord(value) ||
    Object.keys(value).some(
      (key) => forbiddenKeys.has(key) || hasForbiddenUnicode(key),
    ) ||
    Object.values(value).some(
      (entry) => typeof entry === "object" && entry !== null,
    ) ||
    Object.values(value).some(
      (entry) => typeof entry === "string" && hasForbiddenUnicode(entry),
    )
  );
}

export function normalizeExtractedCapture(
  value,
  capturedAt = new Date().toISOString(),
) {
  if (!isPlainRecord(value)) return null;
  try {
    if (utf8Bytes(JSON.stringify(value)) > captureLimits.totalBytes)
      return null;
  } catch {
    return null;
  }
  if (hasDangerousShape(value)) return null;
  const title = cleanString(value.title, {
    codePoints: captureLimits.titleCodePoints,
  });
  const url = safeUrl(value.url);
  const selectedText = cleanString(value.selectedText, {
    bytes: captureLimits.selectedTextBytes,
  });
  const description = cleanString(value.description, {
    bytes: captureLimits.descriptionBytes,
  });
  const author = cleanString(value.author, {
    codePoints: captureLimits.authorCodePoints,
  });
  const publishedAt = exactInstant(value.publishedAt, false);
  const exactCapturedAt = exactInstant(capturedAt, true);
  if (
    [title, url, selectedText, description, author, publishedAt].some(
      (entry) => entry === undefined,
    ) ||
    typeof exactCapturedAt !== "string"
  ) {
    return null;
  }
  const draft = {
    schemaVersion: CAPTURE_SCHEMA_VERSION,
    channel: "browser_extension",
    title,
    url,
    selectedText,
    description,
    author,
    publishedAt,
    capturedAt: exactCapturedAt,
  };
  return utf8Bytes(JSON.stringify(draft)) <= captureLimits.totalBytes
    ? draft
    : null;
}

export function normalizeCaptureDraft(value) {
  if (
    hasDangerousShape(value) ||
    value.schemaVersion !== CAPTURE_SCHEMA_VERSION ||
    value.channel !== "browser_extension"
  ) {
    return null;
  }
  return normalizeExtractedCapture(value, value.capturedAt);
}

export function defaultSelectedFields(draft) {
  return captureFields.filter(
    (field) =>
      ["title", "url", "selectedText"].includes(field) &&
      draft[field] !== null &&
      draft[field] !== "",
  );
}

export function applySelectedFields(draft, selectedFields) {
  if (
    !Array.isArray(selectedFields) ||
    selectedFields.length === 0 ||
    selectedFields.some(
      (field, index) =>
        !captureFields.includes(field) ||
        selectedFields.indexOf(field) !== index ||
        draft[field] === null,
    )
  ) {
    return null;
  }
  return {
    ...draft,
    ...Object.fromEntries(
      captureFields.map((field) => [
        field,
        selectedFields.includes(field) ? draft[field] : null,
      ]),
    ),
  };
}

export function prepareCaptureStageIntent(
  draft,
  selectedFields,
  existingIntent = null,
) {
  if (existingIntent !== null) return existingIntent;
  const selectedDraft = applySelectedFields(draft, selectedFields);
  if (!selectedDraft) return null;
  return {
    id: randomOpaqueId(),
    requestKey: randomOpaqueKey(),
    draft: selectedDraft,
  };
}

export function isOpaqueId(value) {
  return typeof value === "string" && /^[0-9a-f]{32}$/u.test(value);
}

export function isOpaqueKey(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{22,200}$/u.test(value);
}

export function isActorFingerprint(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

export function randomOpaqueId() {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function randomOpaqueKey(bytes = 24) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

import {
  isAllowedKnowledgeValue,
  isBoundedKnowledgeId,
  isRoleOriginCompatible,
  parseOptionalKnowledgeDate,
} from './knowledgeProvenanceValidation.js';
import {
  knowledgeConversationItemRelationTypes,
  knowledgeConversationRoles,
  knowledgeConversationSourceTypes,
  knowledgeProvenanceOrigins,
  type KnowledgeConversationSourceType,
} from './knowledgeProvenancePorts.js';
import {
  knowledgeConversationImportLimits,
  knowledgeConversationImportModels,
  knowledgeConversationImportProviders,
  knowledgeConversationImportToolNames,
  type CanonicalKnowledgeConversationImport,
  type KnowledgeConversationImportLinkedItem,
  type KnowledgeConversationImportModel,
  type KnowledgeConversationImportProvider,
  type KnowledgeConversationImportToolName,
  type KnowledgeConversationImportTurn,
} from './knowledgeConversationImportPorts.js';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MARKDOWN_HEADER = '# Knowledge Conversation v1';
const MARKDOWN_TURN = '## Turn';
const FORBIDDEN_OBJECT_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

export type KnowledgeConversationImportParserCode =
  | 'invalid_envelope'
  | 'invalid_utf8'
  | 'malformed_json'
  | 'json_limit_exceeded'
  | 'markdown_invalid'
  | 'input_oversize'
  | 'conversation_oversize'
  | 'turn_limit_exceeded'
  | 'linked_item_limit_exceeded'
  | 'invalid_conversation'
  | 'invalid_turn'
  | 'invalid_linked_item';

export class KnowledgeConversationImportParserError extends Error {
  constructor(readonly code: KnowledgeConversationImportParserCode) {
    super(code);
    this.name = 'KnowledgeConversationImportParserError';
  }
}

export type ParsedKnowledgeConversationImport = {
  canonical: CanonicalKnowledgeConversationImport;
  warnings: string[];
  rejectedFields: string[];
};

type PlainRecord = Record<string, unknown>;

function fail(code: KnowledgeConversationImportParserCode): never {
  throw new KnowledgeConversationImportParserError(code);
}

function isPlainRecord(value: unknown): value is PlainRecord {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function requireRecord(
  value: unknown,
  allowedKeys: readonly string[],
  code: KnowledgeConversationImportParserCode,
): PlainRecord {
  if (!isPlainRecord(value)) fail(code);
  const allowed = new Set(allowedKeys);
  if (
    Object.keys(value).some(
      (key) => FORBIDDEN_OBJECT_KEYS.has(key) || !allowed.has(key),
    )
  ) {
    fail(code);
  }
  return value;
}

function hasInvalidUnicode(value: string, allowContentWhitespace: boolean) {
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
      code === 0 ||
      (code < 0x20 &&
        !(allowContentWhitespace && (code === 0x09 || code === 0x0a))) ||
      code === 0x7f ||
      code === 0x2028 ||
      code === 0x2029 ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      code === 0xfeff
    ) {
      return true;
    }
  }
  return false;
}

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n?/g, '\n');
}

function boundedText(value: unknown, maximumCodePoints: number): string {
  if (typeof value !== 'string' || hasInvalidUnicode(value, false)) {
    fail('invalid_conversation');
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized !== value.trim() ||
    [...normalized].length > maximumCodePoints
  ) {
    fail('invalid_conversation');
  }
  return normalized;
}

function boundedContent(value: unknown): string {
  if (typeof value !== 'string' || hasInvalidUnicode(value, true)) {
    fail('invalid_turn');
  }
  const normalized = normalizeLineEndings(value).trim();
  if (
    normalized.length === 0 ||
    Buffer.byteLength(normalized, 'utf8') >
      knowledgeConversationImportLimits.turnBytes
  ) {
    fail('invalid_turn');
  }
  return normalized;
}

function optionalVocabulary<T extends string>(
  value: unknown,
  values: readonly T[],
  code: KnowledgeConversationImportParserCode = 'invalid_conversation',
): T | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'string' ||
    [...value].length >
      knowledgeConversationImportLimits.vocabularyCodePoints ||
    !values.some((candidate) => candidate === value)
  ) {
    fail(code);
  }
  return value as T;
}

function parseOccurredAt(value: unknown): string | null {
  const parsed = parseOptionalKnowledgeDate(value);
  if (parsed === undefined) fail('invalid_turn');
  return parsed?.toISOString() ?? null;
}

function parseTurn(value: unknown): KnowledgeConversationImportTurn {
  const record = requireRecord(
    value,
    ['role', 'origin', 'content', 'name', 'occurredAt'],
    'invalid_turn',
  );
  const role = record.role;
  const origin = record.origin;
  if (
    !isAllowedKnowledgeValue(knowledgeConversationRoles, role) ||
    !isAllowedKnowledgeValue(knowledgeProvenanceOrigins, origin) ||
    !isRoleOriginCompatible(role, origin)
  ) {
    fail('invalid_turn');
  }
  const name = optionalVocabulary(
    record.name,
    knowledgeConversationImportToolNames,
    'invalid_turn',
  );
  if (role !== 'tool' && name !== null) fail('invalid_turn');
  return {
    role,
    origin,
    content: boundedContent(record.content),
    name: name as KnowledgeConversationImportToolName | null,
    occurredAt: parseOccurredAt(record.occurredAt),
  };
}

function parseConversation(value: unknown) {
  const record = requireRecord(
    value,
    ['title', 'provider', 'model', 'turns'],
    'invalid_conversation',
  );
  if (!Array.isArray(record.turns) || record.turns.length === 0) {
    fail('invalid_conversation');
  }
  if (record.turns.length > knowledgeConversationImportLimits.turns) {
    fail('turn_limit_exceeded');
  }
  return {
    title: boundedText(
      record.title,
      knowledgeConversationImportLimits.titleCodePoints,
    ),
    provider: optionalVocabulary(
      record.provider,
      knowledgeConversationImportProviders,
    ) as KnowledgeConversationImportProvider | null,
    model: optionalVocabulary(
      record.model,
      knowledgeConversationImportModels,
    ) as KnowledgeConversationImportModel | null,
    turns: record.turns.map(parseTurn),
  };
}

function parseLinkedItems(
  value: unknown,
): KnowledgeConversationImportLinkedItem[] {
  if (!Array.isArray(value)) fail('invalid_linked_item');
  if (value.length > knowledgeConversationImportLimits.linkedItems) {
    fail('linked_item_limit_exceeded');
  }
  const seen = new Set<string>();
  const parsed = value.map((entry, ordinal) => {
    const record = requireRecord(
      entry,
      ['itemId', 'relationType'],
      'invalid_linked_item',
    );
    if (
      !isBoundedKnowledgeId(record.itemId) ||
      !isAllowedKnowledgeValue(
        knowledgeConversationItemRelationTypes,
        record.relationType,
      ) ||
      seen.has(record.itemId)
    ) {
      fail('invalid_linked_item');
    }
    seen.add(record.itemId);
    return {
      itemId: record.itemId,
      relationType: record.relationType,
      ordinal,
    };
  });
  if (parsed.filter((item) => item.relationType === 'primary').length > 1) {
    fail('invalid_linked_item');
  }
  return parsed;
}

function decodeCanonicalBase64Url(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0) {
    fail('invalid_envelope');
  }
  const maximumEncodedLength = Math.ceil(
    (knowledgeConversationImportLimits.rawBytes * 4) / 3,
  );
  if (value.length > maximumEncodedLength) fail('input_oversize');
  if (!BASE64URL_PATTERN.test(value) || value.length % 4 === 1) {
    fail('invalid_envelope');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.length === 0 ||
    decoded.length > knowledgeConversationImportLimits.rawBytes ||
    decoded.toString('base64url') !== value
  ) {
    fail(
      decoded.length > knowledgeConversationImportLimits.rawBytes
        ? 'input_oversize'
        : 'invalid_envelope',
    );
  }
  return decoded;
}

function decodeFatalUtf8(value: unknown): string {
  const decoded = decodeCanonicalBase64Url(value);
  if (
    (decoded[0] === 0xef && decoded[1] === 0xbb && decoded[2] === 0xbf) ||
    decoded.includes(0)
  ) {
    fail('invalid_utf8');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(decoded);
  } catch {
    fail('invalid_utf8');
  }
}

function scanJsonComplexity(input: string) {
  let index = 0;
  let nodes = 0;

  function skipWhitespace() {
    while (
      input[index] === ' ' ||
      input[index] === '\n' ||
      input[index] === '\r' ||
      input[index] === '\t'
    ) {
      index += 1;
    }
  }

  function scanString(): string {
    if (input[index] !== '"') fail('malformed_json');
    const start = index;
    index += 1;
    while (index < input.length) {
      const code = input.charCodeAt(index);
      if (code === 0x22) {
        index += 1;
        try {
          const decoded = JSON.parse(input.slice(start, index)) as unknown;
          if (typeof decoded !== 'string' || hasInvalidUnicode(decoded, true)) {
            fail('malformed_json');
          }
          return decoded;
        } catch (error) {
          if (error instanceof KnowledgeConversationImportParserError) {
            throw error;
          }
          fail('malformed_json');
        }
      }
      if (code < 0x20) fail('malformed_json');
      if (code !== 0x5c) {
        index += 1;
        continue;
      }
      index += 1;
      const escaped = input[index];
      if (escaped === undefined) fail('malformed_json');
      if ('"\\/bfnrt'.includes(escaped)) {
        index += 1;
        continue;
      }
      if (escaped !== 'u') fail('malformed_json');
      if (!/^[0-9a-fA-F]{4}$/.test(input.slice(index + 1, index + 5))) {
        fail('malformed_json');
      }
      index += 5;
    }
    fail('malformed_json');
  }

  function countContainer(depth: number) {
    nodes += 1;
    if (
      depth > knowledgeConversationImportLimits.jsonDepth ||
      nodes > knowledgeConversationImportLimits.jsonNodes
    ) {
      fail('json_limit_exceeded');
    }
  }

  function scanValue(depth: number): void {
    skipWhitespace();
    const current = input[index];
    if (current === '{') {
      countContainer(depth);
      index += 1;
      skipWhitespace();
      if (input[index] === '}') {
        index += 1;
        return;
      }
      const keys = new Set<string>();
      while (index < input.length) {
        const key = scanString();
        if (FORBIDDEN_OBJECT_KEYS.has(key) || keys.has(key)) {
          fail('malformed_json');
        }
        keys.add(key);
        skipWhitespace();
        if (input[index] !== ':') fail('malformed_json');
        index += 1;
        scanValue(depth + 1);
        skipWhitespace();
        if (input[index] === '}') {
          index += 1;
          return;
        }
        if (input[index] !== ',') fail('malformed_json');
        index += 1;
        skipWhitespace();
      }
      fail('malformed_json');
    }
    if (current === '[') {
      countContainer(depth);
      index += 1;
      skipWhitespace();
      if (input[index] === ']') {
        index += 1;
        return;
      }
      while (index < input.length) {
        scanValue(depth + 1);
        skipWhitespace();
        if (input[index] === ']') {
          index += 1;
          return;
        }
        if (input[index] !== ',') fail('malformed_json');
        index += 1;
      }
      fail('malformed_json');
    }
    if (current === '"') {
      scanString();
      return;
    }
    for (const literal of ['true', 'false', 'null']) {
      if (input.startsWith(literal, index)) {
        index += literal.length;
        return;
      }
    }
    const number = input
      .slice(index)
      .match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u)?.[0];
    if (!number) fail('malformed_json');
    index += number.length;
  }

  skipWhitespace();
  scanValue(1);
  skipWhitespace();
  if (index !== input.length) fail('malformed_json');
}

function parseJsonInput(value: unknown) {
  const decoded = decodeFatalUtf8(value);
  scanJsonComplexity(decoded);
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded) as unknown;
  } catch {
    fail('malformed_json');
  }
  return parseConversation(parsed);
}

function parseMetadataLines(
  lines: string[],
  start: number,
  allowedKeys: readonly string[],
): { values: Record<string, string>; next: number } {
  const values: Record<string, string> = {};
  let index = start;
  const allowed = new Set(allowedKeys);
  for (; index < lines.length && lines[index] !== ''; index += 1) {
    const line = lines[index] ?? '';
    if (
      Buffer.byteLength(line, 'utf8') >
      knowledgeConversationImportLimits.markdownMetadataLineBytes
    ) {
      fail('markdown_invalid');
    }
    const separator = line.indexOf(': ');
    if (separator < 1) fail('markdown_invalid');
    const key = line.slice(0, separator);
    const rawValue = line.slice(separator + 2);
    if (!allowed.has(key) || key in values || rawValue.length === 0) {
      fail('markdown_invalid');
    }
    values[key] = rawValue;
  }
  if (lines[index] !== '') fail('markdown_invalid');
  return { values, next: index + 1 };
}

function parseMarkdownInput(value: unknown) {
  const decoded = normalizeLineEndings(decodeFatalUtf8(value));
  const lines = decoded.split('\n');
  if (
    lines.length > knowledgeConversationImportLimits.markdownLines ||
    lines[0] !== MARKDOWN_HEADER
  ) {
    fail('markdown_invalid');
  }
  const header = parseMetadataLines(lines, 1, ['title', 'provider', 'model']);
  const turns: KnowledgeConversationImportTurn[] = [];
  let index = header.next;
  while (index < lines.length) {
    while (lines[index] === '') index += 1;
    if (index >= lines.length) break;
    if (lines[index] !== MARKDOWN_TURN) fail('markdown_invalid');
    const metadata = parseMetadataLines(lines, index + 1, [
      'role',
      'origin',
      'name',
      'occurredAt',
    ]);
    index = metadata.next;
    const body: string[] = [];
    while (index < lines.length && lines[index] !== MARKDOWN_TURN) {
      if ((lines[index] ?? '').startsWith('## ')) fail('markdown_invalid');
      body.push(lines[index] ?? '');
      index += 1;
    }
    turns.push(
      parseTurn({
        role: metadata.values.role,
        origin: metadata.values.origin,
        content: body.join('\n'),
        name: metadata.values.name,
        occurredAt: metadata.values.occurredAt,
      }),
    );
    if (turns.length > knowledgeConversationImportLimits.turns) {
      fail('turn_limit_exceeded');
    }
  }
  return parseConversation({
    title: header.values.title,
    provider: header.values.provider,
    model: header.values.model,
    turns,
  });
}

function canonicalJson(
  input: Omit<CanonicalKnowledgeConversationImport, 'canonicalPayloadHash'>,
) {
  return JSON.stringify({
    version: input.version,
    format: input.format,
    title: input.title,
    provider: input.provider,
    model: input.model,
    turns: input.turns.map((turn) => ({
      role: turn.role,
      origin: turn.origin,
      content: turn.content,
      name: turn.name,
      occurredAt: turn.occurredAt,
    })),
    linkedItems: input.linkedItems.map((item) => ({
      itemId: item.itemId,
      relationType: item.relationType,
      ordinal: item.ordinal,
    })),
  });
}

function canonicalHash(serialized: string) {
  return createHash('sha256')
    .update('erp4:knowledge:conversation-import-payload:v1\0', 'utf8')
    .update(serialized, 'utf8')
    .digest('hex');
}

export function bindKnowledgeConversationImportToOwner(
  canonical: CanonicalKnowledgeConversationImport,
  ownerUserId: string,
): CanonicalKnowledgeConversationImport {
  return {
    ...canonical,
    canonicalPayloadHash: createHash('sha256')
      .update('erp4:knowledge:conversation-import-owner-payload:v1\0', 'utf8')
      .update(ownerUserId, 'utf8')
      .update('\0', 'utf8')
      .update(canonical.canonicalPayloadHash, 'ascii')
      .digest('hex'),
  };
}

export function parseKnowledgeConversationImport(
  value: unknown,
): ParsedKnowledgeConversationImport {
  const envelope = requireRecord(
    value,
    ['format', 'inputBase64', 'linkedItems'],
    'invalid_envelope',
  );
  if (
    !isAllowedKnowledgeValue(knowledgeConversationSourceTypes, envelope.format)
  ) {
    fail('invalid_envelope');
  }
  const format: KnowledgeConversationSourceType = envelope.format;
  const linkedItems = parseLinkedItems(envelope.linkedItems);
  if (envelope.inputBase64 === undefined) fail('invalid_envelope');
  const conversation =
    format === 'markdown'
      ? parseMarkdownInput(envelope.inputBase64)
      : parseJsonInput(envelope.inputBase64);
  const withoutHash = {
    version: 1 as const,
    format,
    ...conversation,
    linkedItems,
  };
  const serialized = canonicalJson(withoutHash);
  if (
    Buffer.byteLength(serialized, 'utf8') >
    knowledgeConversationImportLimits.canonicalBytes
  ) {
    fail('conversation_oversize');
  }
  return {
    canonical: {
      ...withoutHash,
      canonicalPayloadHash: canonicalHash(serialized),
    },
    warnings: [],
    rejectedFields: [],
  };
}

export function encodeKnowledgeConversationImportInput(value: string | Buffer) {
  return Buffer.from(value).toString('base64url');
}

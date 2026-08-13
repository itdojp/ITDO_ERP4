import { createHash } from 'node:crypto';

import { knowledgeLlmLimits } from './knowledgeLlmConfig.js';
import { sha256KnowledgeText } from './knowledgeProvenanceValidation.js';

export const knowledgeLlmContextSourceTypes = [
  'snapshot',
  'annotation_revision',
  'conversation_turn',
  'synthesis_version',
  'thread_promotion_message',
] as const;
export type KnowledgeLlmContextSourceType =
  (typeof knowledgeLlmContextSourceTypes)[number];

export type KnowledgeLlmSelectedContextSource = {
  sourceType: KnowledgeLlmContextSourceType;
  sourceId: string;
  exactSourceVersion: number;
  exactSourceHash: string;
  /** Exact sanitized text that will be dispatched. Never persisted by budget code. */
  representation: string;
};

export type KnowledgeLlmContextFingerprintSource = {
  ordinal: number;
  sourceType: KnowledgeLlmContextSourceType;
  sourceId: string;
  exactSourceVersion: number;
  exactSourceHash: string;
  representationHash: string;
  byteLength: number;
  estimatedTokens: number;
};

function lengthPrefixed(value: string): Buffer {
  const encoded = Buffer.from(value, 'utf8');
  return Buffer.concat([
    Buffer.from(`${encoded.byteLength}:`, 'ascii'),
    encoded,
  ]);
}

function sourceFingerprint(
  source: KnowledgeLlmContextFingerprintSource,
): string {
  const hash = createHash('sha256');
  hash.update('erp4:knowledge:llm-context-source:v1\0', 'utf8');
  for (const value of [
    source.ordinal.toString(),
    source.sourceType,
    source.sourceId,
    source.exactSourceVersion.toString(),
    source.exactSourceHash,
    source.representationHash,
    source.byteLength.toString(),
    source.estimatedTokens.toString(),
  ]) {
    hash.update(lengthPrefixed(value));
  }
  return hash.digest('hex');
}

/**
 * Opaque, order-sensitive fingerprint mirrored by the PostgreSQL dispatch
 * guard. Raw source identifiers never leave this digest boundary.
 */
export function knowledgeLlmContextFingerprint(
  sources: readonly KnowledgeLlmContextFingerprintSource[],
): string {
  const ordered = [...sources].sort(
    (left, right) => left.ordinal - right.ordinal,
  );
  const hash = createHash('sha256');
  hash.update('erp4:knowledge:llm-context-fingerprint:v1\0', 'utf8');
  for (const source of ordered) hash.update(sourceFingerprint(source), 'ascii');
  return hash.digest('hex');
}

export function knowledgeLlmContextRepresentationHash(content: string): string {
  return sha256KnowledgeText('llm-context-representation', content);
}

export function knowledgeLlmContextEstimatedTokens(byteLength: number): number {
  if (!Number.isSafeInteger(byteLength) || byteLength < 1) {
    throw new Error('invalid_knowledge_llm_context_bytes');
  }
  return byteLength * 2 + knowledgeLlmLimits.sourceFramingTokens;
}

const sha256Pattern = /^[0-9a-f]{64}$/;
const allowedSourceTypes = new Set<KnowledgeLlmContextSourceType>([
  'snapshot',
  'annotation_revision',
  'conversation_turn',
  'synthesis_version',
  'thread_promotion_message',
]);

const sourceTypeLimits: Record<KnowledgeLlmContextSourceType, number> = {
  snapshot: knowledgeLlmLimits.snapshots,
  annotation_revision: knowledgeLlmLimits.annotationRevisions,
  conversation_turn: knowledgeLlmLimits.conversationTurns,
  synthesis_version: knowledgeLlmLimits.synthesisVersions,
  thread_promotion_message: knowledgeLlmLimits.threadPromotionMessages,
};

function boundedSourceId(value: string): boolean {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length > 0 &&
    [...value].length <= 255 &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    })
  );
}

/**
 * Derives every reservation/provenance binding from one typed, ordered source
 * structure. Callers cannot provide an independent fingerprint or token count.
 */
export function deriveKnowledgeLlmSelectedContext(
  selected: readonly KnowledgeLlmSelectedContextSource[],
): {
  sources: KnowledgeLlmContextFingerprintSource[];
  representations: string[];
  fingerprint: string;
  totalBytes: number;
  totalEstimatedTokens: number;
} {
  if (
    !Array.isArray(selected) ||
    selected.length > knowledgeLlmLimits.totalSources
  ) {
    throw new Error('invalid_knowledge_llm_context');
  }
  const counts = new Map<KnowledgeLlmContextSourceType, number>();
  const identities = new Set<string>();
  let totalBytes = 0;
  let totalEstimatedTokens = 0;
  const representations: string[] = [];
  const sources = selected.map((source, ordinal) => {
    const sourceType = source?.sourceType as
      KnowledgeLlmContextSourceType | undefined;
    if (
      source === null ||
      typeof source !== 'object' ||
      sourceType === undefined ||
      !allowedSourceTypes.has(sourceType) ||
      !boundedSourceId(source.sourceId) ||
      !Number.isSafeInteger(source.exactSourceVersion) ||
      source.exactSourceVersion < 1 ||
      !sha256Pattern.test(source.exactSourceHash) ||
      typeof source.representation !== 'string'
    ) {
      throw new Error('invalid_knowledge_llm_context');
    }
    const identity = `${sourceType}\0${source.sourceId}`;
    if (identities.has(identity)) {
      throw new Error('invalid_knowledge_llm_context');
    }
    identities.add(identity);
    const count = (counts.get(sourceType) ?? 0) + 1;
    counts.set(sourceType, count);
    if (count > sourceTypeLimits[sourceType]) {
      throw new Error('invalid_knowledge_llm_context');
    }
    const byteLength = Buffer.byteLength(source.representation, 'utf8');
    if (byteLength < 1 || byteLength > knowledgeLlmLimits.sourceBytes) {
      throw new Error('invalid_knowledge_llm_context');
    }
    totalBytes += byteLength;
    if (totalBytes > knowledgeLlmLimits.totalContextBytes) {
      throw new Error('invalid_knowledge_llm_context');
    }
    const estimatedTokens = knowledgeLlmContextEstimatedTokens(byteLength);
    totalEstimatedTokens += estimatedTokens;
    if (!Number.isSafeInteger(totalEstimatedTokens)) {
      throw new Error('invalid_knowledge_llm_context');
    }
    representations.push(source.representation);
    return {
      ordinal,
      sourceType,
      sourceId: source.sourceId,
      exactSourceVersion: source.exactSourceVersion,
      exactSourceHash: source.exactSourceHash,
      representationHash: knowledgeLlmContextRepresentationHash(
        source.representation,
      ),
      byteLength,
      estimatedTokens,
    };
  });
  return {
    sources,
    representations,
    fingerprint: knowledgeLlmContextFingerprint(sources),
    totalBytes,
    totalEstimatedTokens,
  };
}

/**
 * Revalidates the representation-free rows handed to the persistence port.
 * The port never accepts a caller-supplied fingerprint without the exact
 * ordered source records that produced it.
 */
export function validKnowledgeLlmContextFingerprintSources(
  sources: readonly KnowledgeLlmContextFingerprintSource[],
  expectedFingerprint: string,
): boolean {
  try {
    if (
      !Array.isArray(sources) ||
      sources.length > knowledgeLlmLimits.totalSources ||
      !sha256Pattern.test(expectedFingerprint)
    ) {
      return false;
    }
    const counts = new Map<KnowledgeLlmContextSourceType, number>();
    const identities = new Set<string>();
    let totalBytes = 0;
    for (const [ordinal, source] of sources.entries()) {
      const sourceType = source?.sourceType as
        KnowledgeLlmContextSourceType | undefined;
      if (
        source === null ||
        typeof source !== 'object' ||
        source.ordinal !== ordinal ||
        sourceType === undefined ||
        !allowedSourceTypes.has(sourceType) ||
        !boundedSourceId(source.sourceId) ||
        !Number.isSafeInteger(source.exactSourceVersion) ||
        source.exactSourceVersion < 1 ||
        !sha256Pattern.test(source.exactSourceHash) ||
        !sha256Pattern.test(source.representationHash) ||
        !Number.isSafeInteger(source.byteLength) ||
        source.byteLength < 1 ||
        source.byteLength > knowledgeLlmLimits.sourceBytes ||
        !Number.isSafeInteger(source.estimatedTokens) ||
        source.estimatedTokens !==
          knowledgeLlmContextEstimatedTokens(source.byteLength)
      ) {
        return false;
      }
      const identity = `${sourceType}\0${source.sourceId}`;
      if (identities.has(identity)) return false;
      identities.add(identity);
      const count = (counts.get(sourceType) ?? 0) + 1;
      counts.set(sourceType, count);
      if (count > sourceTypeLimits[sourceType]) return false;
      totalBytes += source.byteLength;
      if (totalBytes > knowledgeLlmLimits.totalContextBytes) return false;
    }
    return knowledgeLlmContextFingerprint(sources) === expectedFingerprint;
  } catch {
    return false;
  }
}

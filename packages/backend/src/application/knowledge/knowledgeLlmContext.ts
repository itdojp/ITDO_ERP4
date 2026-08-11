import { createHash } from 'node:crypto';

import type { KnowledgeLlmContextSourceType } from './knowledgeLlmBudgetPorts.js';
import { knowledgeLlmLimits } from './knowledgeLlmConfig.js';
import { sha256KnowledgeText } from './knowledgeProvenanceValidation.js';

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

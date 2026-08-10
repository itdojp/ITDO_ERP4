import { knowledgeShareLimits } from '../../application/knowledge/knowledgeSharePorts.js';
import { normalizeKnowledgeCanonicalUrl } from '../../application/knowledge/knowledgeItemUseCases.js';

const synthesisQuestionMaximumBytes = 4096;

export function strictQuestions(value: unknown): string[] | null {
  if (
    !Array.isArray(value) ||
    value.length > knowledgeShareLimits.unresolvedQuestions ||
    value.some(
      (entry) =>
        typeof entry !== 'string' ||
        Buffer.byteLength(entry, 'utf8') < 1 ||
        Buffer.byteLength(entry, 'utf8') > synthesisQuestionMaximumBytes,
    )
  ) {
    return null;
  }
  return value as string[];
}

export function boundedUtf8Excerpt(value: string | null): string | undefined {
  if (value === null) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  let excerpt = '';
  let bytes = 0;
  for (const character of normalized) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > knowledgeShareLimits.excerptBytes) break;
    excerpt += character;
    bytes += characterBytes;
  }
  const result = excerpt.trimEnd();
  return result || undefined;
}

export function safeCanonicalUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    const hostname = url.hostname.toLowerCase();
    // WHATWG URL parsing preserves a DNS absolute-name trailing dot. Reject it
    // before provider matching so encoded/unicode variants cannot bypass it.
    if (hostname.endsWith('.')) return undefined;
    if (
      hostname === 'drive.google.com' ||
      hostname === 'docs.google.com' ||
      hostname === 'storage.cloud.google.com' ||
      hostname === 'storage.googleapis.com' ||
      hostname === 'www.googleapis.com' ||
      hostname.endsWith('.googleapis.com') ||
      hostname.endsWith('.googleusercontent.com')
    ) {
      return undefined;
    }
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    const normalized = normalizeKnowledgeCanonicalUrl(url.toString());
    if (!normalized.ok || !normalized.value) return undefined;
    return Buffer.byteLength(normalized.value, 'utf8') <=
      knowledgeShareLimits.urlBytes
      ? normalized.value
      : undefined;
  } catch {
    return undefined;
  }
}

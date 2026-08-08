import { describe, expect, it } from 'vitest';

import {
  buildManualKnowledgeConversation,
  encodeKnowledgeImportInput,
  formatKnowledgeConfidence,
  roleOriginCompatible,
  utf8Length,
} from './knowledgeProvenanceModel';

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/gu, '+').replace(/_/gu, '/');
  return decodeURIComponent(
    [...atob(padded)]
      .map((entry) => `%${entry.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join(''),
  );
}

describe('knowledgeProvenanceModel', () => {
  it('encodes Unicode input as canonical unpadded base64url', () => {
    const input = `${'会話'.repeat(20_000)} / + =`;
    const encoded = encodeKnowledgeImportInput(input);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(encoded).not.toContain('=');
    expect(decodeBase64Url(encoded)).toBe(input);
    expect(utf8Length('会話')).toBe(6);
  });

  it('builds a strict one-turn manual payload without provider inference', () => {
    expect(
      JSON.parse(
        buildManualKnowledgeConversation({
          title: '  検証会話  ',
          role: 'assistant',
          origin: 'ai',
          content: '結論',
        }),
      ),
    ).toEqual({
      title: '検証会話',
      provider: null,
      model: null,
      turns: [
        {
          role: 'assistant',
          origin: 'ai',
          content: '結論',
          name: null,
          occurredAt: null,
        },
      ],
    });
  });

  it('keeps role and origin as separate compatible vocabularies', () => {
    expect(roleOriginCompatible('user', 'user')).toBe(true);
    expect(roleOriginCompatible('user', 'external')).toBe(true);
    expect(roleOriginCompatible('assistant', 'ai')).toBe(true);
    expect(roleOriginCompatible('assistant', 'external')).toBe(true);
    expect(roleOriginCompatible('system', 'system')).toBe(true);
    expect(roleOriginCompatible('tool', 'tool')).toBe(true);
    expect(roleOriginCompatible('assistant', 'user')).toBe(false);
    expect(roleOriginCompatible('system', 'ai')).toBe(false);
    expect(
      JSON.parse(
        buildManualKnowledgeConversation({
          title: 'Tool turn',
          role: 'tool',
          origin: 'tool',
          content: 'tool result',
        }),
      ).turns[0].name,
    ).toBe('other');
  });

  it('formats basis points without guessing an unset value', () => {
    expect(formatKnowledgeConfidence(null)).toBe('未設定');
    expect(formatKnowledgeConfidence(8_750)).toBe('87.50%');
  });
});

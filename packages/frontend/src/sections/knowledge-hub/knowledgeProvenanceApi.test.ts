import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiResponse } = vi.hoisted(() => ({ apiResponse: vi.fn() }));
vi.mock('../../api', () => ({ apiResponse }));

import { KnowledgeHubApiError } from './knowledgeHubApi';
import {
  appendKnowledgeSynthesisVersion,
  commitKnowledgeConversationImport,
  createKnowledgeAnnotation,
  createKnowledgeSynthesis,
  deleteKnowledgeAnnotation,
  getKnowledgeAnnotationCapabilities,
  getKnowledgeSynthesis,
  listKnowledgeAnnotationRevisions,
  listKnowledgeAnnotations,
  listKnowledgeConversations,
  listKnowledgeConversationTurns,
  listKnowledgeSyntheses,
  listKnowledgeSynthesisVersions,
  previewKnowledgeConversationImport,
  reviseKnowledgeAnnotation,
} from './knowledgeProvenanceApi';

const revision = {
  id: 'revision-1',
  annotationId: 'annotation-1',
  revision: 1,
  kind: 'note',
  origin: 'user',
  content: '本人の見解',
  createdAt: '2026-08-08T00:00:00.000Z',
  createdBy: 'actor-secret',
  providerKey: 'must-drop',
};
const annotation = {
  id: 'annotation-1',
  knowledgeItemId: 'item-1',
  ownerUserId: 'owner-secret',
  authorUserId: 'actor-secret',
  scope: 'personal',
  organizationId: null,
  kind: 'note',
  origin: 'user',
  currentRevision: 1,
  deletedAt: null,
  createdAt: '2026-08-08T00:00:00.000Z',
  createdBy: 'actor-secret',
  updatedAt: '2026-08-08T00:00:00.000Z',
  updatedBy: 'actor-secret',
  revision,
  unknown: 'must-drop',
};
const conversation = {
  id: 'conversation-1',
  ownerUserId: 'owner-secret',
  title: '合成会話',
  sourceType: 'json',
  provider: 'openai',
  model: 'gpt',
  capturedAt: '2026-08-08T00:00:00.000Z',
  importedAt: '2026-08-08T00:00:01.000Z',
  contentHash: 'a'.repeat(64),
  version: 1,
  createdAt: '2026-08-08T00:00:01.000Z',
  createdBy: 'actor-secret',
  updatedAt: '2026-08-08T00:00:01.000Z',
  updatedBy: 'actor-secret',
  providerUrl: 'https://private.invalid/object',
  items: [
    {
      id: 'relation-1',
      knowledgeItemId: 'item-1',
      relationType: 'primary',
      ordinal: 0,
      createdAt: '2026-08-08T00:00:01.000Z',
      createdBy: 'actor-secret',
    },
  ],
};
const synthesis = {
  id: 'synthesis-1',
  ownerUserId: 'owner-secret',
  scope: 'personal',
  organizationId: null,
  title: '検証結論',
  currentVersion: 1,
  createdAt: '2026-08-08T00:00:00.000Z',
  createdBy: 'actor-secret',
  updatedAt: '2026-08-08T00:00:00.000Z',
  updatedBy: 'actor-secret',
};
const synthesisVersion = {
  id: 'synthesis-version-1',
  synthesisId: 'synthesis-1',
  version: 1,
  content: '検証した結論',
  unresolvedQuestions: ['未解決事項'],
  confidenceBasisPoints: 8_500,
  createdAt: '2026-08-08T00:00:00.000Z',
  createdBy: 'actor-secret',
  sources: [
    {
      id: null,
      kind: 'item',
      sourceId: null,
      relationType: 'primary',
      ordinal: 0,
      accessible: false,
      createdAt: null,
      createdBy: null,
      leakedTitle: 'must-drop',
    },
  ],
};

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => vi.clearAllMocks());

describe('knowledgeProvenanceApi annotations', () => {
  it('normalizes list/history and drops actor, provider, and unknown fields', async () => {
    apiResponse
      .mockResolvedValueOnce(
        response({ items: [annotation], nextCursor: null }),
      )
      .mockResolvedValueOnce(response({ items: [revision], nextCursor: null }));

    expect(await listKnowledgeAnnotations('item/1')).toEqual({
      items: [
        {
          id: 'annotation-1',
          knowledgeItemId: 'item-1',
          scope: 'personal',
          kind: 'note',
          origin: 'user',
          currentRevision: 1,
          deletedAt: null,
          createdAt: '2026-08-08T00:00:00.000Z',
          updatedAt: '2026-08-08T00:00:00.000Z',
          revision: {
            id: 'revision-1',
            annotationId: 'annotation-1',
            revision: 1,
            kind: 'note',
            origin: 'user',
            content: '本人の見解',
            createdAt: '2026-08-08T00:00:00.000Z',
          },
        },
      ],
      nextCursor: null,
    });
    expect(
      (
        await listKnowledgeAnnotationRevisions({
          itemId: 'item/1',
          annotationId: 'annotation/1',
        })
      ).items,
    ).toHaveLength(1);
    expect(apiResponse.mock.calls[0][0]).toContain('item%2F1');
    expect(apiResponse.mock.calls[1][0]).toContain('annotation%2F1');
  });

  it('forwards opaque cursors and the explicit deleted-history option', async () => {
    apiResponse
      .mockResolvedValueOnce(response({ items: [], nextCursor: 'next-page' }))
      .mockResolvedValueOnce(response({ items: [], nextCursor: null }));

    const first = await listKnowledgeAnnotations('item-1', {
      includeDeleted: true,
    });
    await listKnowledgeAnnotations('item-1', {
      includeDeleted: true,
      cursor: first.nextCursor,
    });

    expect(apiResponse.mock.calls[0][0]).toContain('includeDeleted=true');
    expect(apiResponse.mock.calls[1][0]).toContain('cursor=next-page');
    expect(apiResponse.mock.calls[1][0]).toContain('includeDeleted=true');
  });

  it('normalizes the separate management capability and rejects invalid values', async () => {
    apiResponse
      .mockResolvedValueOnce(response({ canManageAnnotations: false }))
      .mockResolvedValueOnce(response({ canManageAnnotations: 'true' }));

    await expect(getKnowledgeAnnotationCapabilities('item/1')).resolves.toEqual(
      {
        canManageAnnotations: false,
      },
    );
    expect(apiResponse.mock.calls[0][0]).toContain('item%2F1');
    await expect(
      getKnowledgeAnnotationCapabilities('item-1'),
    ).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('sends exact create/revise/delete bodies and normalizes each response', async () => {
    apiResponse.mockImplementation(async () => response(annotation));
    await createKnowledgeAnnotation({
      itemId: 'item-1',
      kind: 'quote',
      origin: 'external',
      content: '引用',
    });
    await reviseKnowledgeAnnotation({
      itemId: 'item-1',
      annotationId: 'annotation-1',
      expectedRevision: 1,
      kind: 'hypothesis',
      origin: 'user',
      content: '仮説',
    });
    await deleteKnowledgeAnnotation({
      itemId: 'item-1',
      annotationId: 'annotation-1',
      expectedRevision: 2,
    });
    expect(JSON.parse(apiResponse.mock.calls[0][1].body)).toEqual({
      kind: 'quote',
      origin: 'external',
      content: '引用',
    });
    expect(JSON.parse(apiResponse.mock.calls[1][1].body)).toEqual({
      expectedRevision: 1,
      kind: 'hypothesis',
      origin: 'user',
      content: '仮説',
    });
    expect(JSON.parse(apiResponse.mock.calls[2][1].body)).toEqual({
      expectedRevision: 2,
    });
  });

  it('normalizes forbidden and not-found to the same non-disclosing code', async () => {
    apiResponse.mockResolvedValue(
      response(
        { error: { code: 'forbidden', message: 'raw sensitive detail' } },
        403,
      ),
    );
    await expect(listKnowledgeAnnotations('hidden')).rejects.toMatchObject({
      name: 'KnowledgeHubApiError',
      code: 'not_found',
      status: 403,
    });
  });
});

describe('knowledgeProvenanceApi conversations/import', () => {
  it('normalizes linked conversations and timeline without hashes or actor IDs', async () => {
    apiResponse
      .mockResolvedValueOnce(
        response({ items: [conversation], nextCursor: null }),
      )
      .mockResolvedValueOnce(
        response({
          items: [
            {
              id: 'turn-1',
              conversationId: 'conversation-1',
              sequence: 1,
              role: 'assistant',
              origin: 'ai',
              content: '<script>text only</script>',
              name: null,
              occurredAt: null,
              contentHash: 'b'.repeat(64),
              createdAt: '2026-08-08T00:00:01.000Z',
              createdBy: 'actor-secret',
              providerKey: 'must-drop',
            },
          ],
          nextCursor: null,
        }),
      );

    const conversations = await listKnowledgeConversations({
      knowledgeItemId: 'item/1',
    });
    const turns = await listKnowledgeConversationTurns('conversation-1');
    expect(conversations.items[0]).not.toHaveProperty('contentHash');
    expect(conversations.items[0]).not.toHaveProperty('ownerUserId');
    expect(conversations.items[0]).not.toHaveProperty('providerUrl');
    expect(turns.items[0]).toMatchObject({
      role: 'assistant',
      origin: 'ai',
      content: '<script>text only</script>',
    });
    expect(turns.items[0]).not.toHaveProperty('contentHash');
    expect(turns.items[0]).not.toHaveProperty('createdBy');
  });

  it('previews and commits the exact envelope while allowlisting responses', async () => {
    apiResponse
      .mockResolvedValueOnce(
        response({
          summary: {
            format: 'json',
            title: '会話',
            provider: null,
            model: null,
            roles: ['user', 'assistant'],
            origins: ['user', 'ai'],
            turnCount: 2,
            linkedItemCount: 1,
            providerUrl: 'must-drop',
          },
          warnings: [],
          rejectedFields: [],
          previewToken: 'opaque-token',
          expiresAt: '2026-08-08T00:10:00.000Z',
          rawParserError: 'must-drop',
        }),
      )
      .mockResolvedValueOnce(
        response({
          conversationId: 'conversation-1',
          created: true,
          reused: false,
          turnCount: 2,
          linkedItemCount: 1,
          result: 'created',
          requestKey: 'must-drop',
        }),
      );
    const envelope = {
      format: 'json' as const,
      inputBase64: 'eyJ0aXRsZSI6IngifQ',
      linkedItems: [{ itemId: 'item-1', relationType: 'primary' as const }],
    };
    const preview = await previewKnowledgeConversationImport(envelope);
    const committed = await commitKnowledgeConversationImport({
      ...envelope,
      previewToken: preview.previewToken,
      requestKey: 'random-operation-key',
    });
    expect(preview.summary).not.toHaveProperty('providerUrl');
    expect(preview).not.toHaveProperty('rawParserError');
    expect(committed).not.toHaveProperty('requestKey');
    expect(JSON.parse(apiResponse.mock.calls[1][1].body)).toEqual({
      ...envelope,
      previewToken: 'opaque-token',
      requestKey: 'random-operation-key',
    });
  });

  it('rejects response vocabulary outside the fixed allowlist', async () => {
    apiResponse.mockResolvedValue(
      response({
        items: [
          {
            ...conversation,
            provider: 'https://private.invalid/provider',
          },
        ],
        nextCursor: null,
      }),
    );
    await expect(
      listKnowledgeConversations({ knowledgeItemId: 'item-1' }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('preserves opaque page cursors and rejects an incomplete page envelope', async () => {
    apiResponse
      .mockResolvedValueOnce(
        response({ items: [conversation], nextCursor: 'opaque/cursor+=' }),
      )
      .mockResolvedValueOnce(response({ items: [conversation] }));

    const first = await listKnowledgeConversations({
      knowledgeItemId: 'item/1',
      cursor: 'previous/cursor+=',
    });
    expect(first.nextCursor).toBe('opaque/cursor+=');
    expect(apiResponse.mock.calls[0][0]).toContain('knowledgeItemId=item%2F1');
    expect(apiResponse.mock.calls[0][0]).toContain(
      'cursor=previous%2Fcursor%2B%3D',
    );
    await expect(
      listKnowledgeConversations({ knowledgeItemId: 'item-1' }),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
});

describe('knowledgeProvenanceApi syntheses', () => {
  it('normalizes list/detail/history and preserves inaccessible redaction', async () => {
    apiResponse
      .mockResolvedValueOnce(response({ items: [synthesis], nextCursor: null }))
      .mockResolvedValueOnce(
        response({ synthesis, currentVersion: synthesisVersion }),
      )
      .mockResolvedValueOnce(
        response({ items: [synthesisVersion], nextCursor: null }),
      );
    expect(await listKnowledgeSyntheses()).toEqual({
      items: [
        {
          id: 'synthesis-1',
          scope: 'personal',
          title: '検証結論',
          currentVersion: 1,
          createdAt: '2026-08-08T00:00:00.000Z',
          updatedAt: '2026-08-08T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    });
    const detail = await getKnowledgeSynthesis('synthesis-1');
    expect(detail.currentVersion.sources[0]).toEqual({
      id: null,
      kind: 'item',
      sourceId: null,
      relationType: 'primary',
      ordinal: 0,
      accessible: false,
      createdAt: null,
    });
    expect(
      (await listKnowledgeSynthesisVersions('synthesis-1')).items,
    ).toHaveLength(1);
  });

  it('rejects inaccessible provenance that still carries identifiers', async () => {
    const leakedVersion = {
      ...synthesisVersion,
      sources: [
        {
          ...synthesisVersion.sources[0],
          id: 'redacted-link-secret',
          sourceId: 'redacted-source-secret',
          createdAt: '2026-08-08T00:00:00.000Z',
        },
      ],
    };
    apiResponse.mockResolvedValue(
      response({ synthesis, currentVersion: leakedVersion }),
    );

    await expect(getKnowledgeSynthesis('synthesis-1')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('sends create and append version contracts without unknown fields', async () => {
    apiResponse.mockImplementation(async () =>
      response({ synthesis, currentVersion: synthesisVersion }),
    );
    const versionInput = {
      content: '結論',
      unresolvedQuestions: ['追加確認'],
      confidenceBasisPoints: 9_000,
      sources: [
        {
          kind: 'item' as const,
          sourceId: 'item-1',
          relationType: 'primary' as const,
        },
      ],
    };
    await createKnowledgeSynthesis({
      ...versionInput,
      scope: 'personal',
      title: '検証結論',
    });
    await appendKnowledgeSynthesisVersion({
      ...versionInput,
      synthesisId: 'synthesis-1',
      expectedVersion: 1,
    });
    expect(JSON.parse(apiResponse.mock.calls[0][1].body)).toEqual({
      ...versionInput,
      scope: 'personal',
      title: '検証結論',
    });
    expect(JSON.parse(apiResponse.mock.calls[1][1].body)).toEqual({
      ...versionInput,
      expectedVersion: 1,
    });
  });

  it('rejects inconsistent import result flags instead of copying them to UI state', async () => {
    apiResponse.mockResolvedValue(
      response({
        conversationId: 'conversation-1',
        created: true,
        reused: true,
        turnCount: 1,
        linkedItemCount: 1,
        result: 'created',
      }),
    );
    await expect(
      commitKnowledgeConversationImport({
        format: 'manual',
        inputBase64: 'e30',
        linkedItems: [],
        previewToken: 'token',
        requestKey: 'key',
      }),
    ).rejects.toBeInstanceOf(KnowledgeHubApiError);
  });
});

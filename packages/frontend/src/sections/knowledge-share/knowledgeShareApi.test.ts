import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiResponse } = vi.hoisted(() => ({ apiResponse: vi.fn() }));

vi.mock('../../api', () => ({ apiResponse }));

import {
  commitKnowledgeShare,
  commitKnowledgeThreadPromotion,
  createKnowledgeShareRequestKey,
  getKnowledgeShareCard,
  getKnowledgeShareStatus,
  KnowledgeShareSafeError,
  listKnowledgeShareLabelAssignments,
  listRoomKnowledgeShareSummaries,
  openKnowledgeShareSource,
  previewKnowledgeShare,
  previewKnowledgeThreadPromotion,
  reconcileKnowledgeShare,
  revokeKnowledgeShare,
} from './knowledgeShareApi';
import type {
  KnowledgeShareSelectionDraft,
  KnowledgeThreadPromotionDraft,
} from './knowledgeShareModel';

const timestamp = '2026-08-10T01:00:00.000Z';

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function selection(): KnowledgeShareSelectionDraft {
  return {
    includeTitle: true,
    includeSourceType: false,
    includeCanonicalUrl: false,
    snapshot: null,
    labelAssignmentIds: [],
    annotations: [],
    conversationTurnIds: [],
    syntheses: [],
    sharerNote: null,
  };
}

function titleOnlyCard(extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    title: 'Selected title',
    sourceType: null,
    canonicalUrl: null,
    snapshot: null,
    sharerNote: null,
    labels: [],
    annotations: [],
    turns: [],
    syntheses: [],
    selectedCategories: ['title'],
    omittedCategories: [
      'source_type',
      'canonical_url',
      'snapshot_provenance',
      'snapshot_excerpt',
      'label',
      'annotation',
      'conversation_turn',
      'synthesis',
      'sharer_note',
    ],
    ...extra,
  };
}

function sharePreviewPayload() {
  return {
    card: titleOnlyCard({ sourceKnowledgeItemId: 'private' }),
    destinationRoom: {
      name: 'Architecture room',
      type: 'private_group',
      roomId: 'private',
    },
    previewToken: 'opaque.preview.token',
    expiresAt: '2026-08-10T01:10:00.000Z',
    requiresConfirmation: true,
    providerKey: 'private',
  };
}

function postedStatus(extra: Record<string, unknown> = {}) {
  return {
    shareId: 'share-1',
    status: 'posted',
    version: 2,
    chatMessageId: 'message-1',
    failureCode: null,
    createdAt: timestamp,
    postedAt: '2026-08-10T01:01:00.000Z',
    failedAt: null,
    revokedAt: null,
    ...extra,
  };
}

function promotionRequest(): KnowledgeThreadPromotionDraft {
  return {
    selectedReplyMessageIds: ['reply-1'],
    includeSharedCard: false,
    destination: { scope: 'personal', organizationGroupAccountIds: [] },
    synthesis: {
      title: 'Promotion title',
      content: 'Selected reply content.',
      confidenceBasisPoints: 7500,
      unresolvedQuestions: ['Question'],
    },
  };
}

function promotionPreviewPayload() {
  return {
    sourceThread: {
      roomName: 'Architecture room',
      roomType: 'private_group',
      replyCount: 2,
      roomId: 'private',
    },
    selectedMessages: [
      {
        ordinal: 0,
        content: 'Selected reply content.',
        createdAt: timestamp,
        authorCategory: 'user',
        sourceMessageId: 'private',
      },
    ],
    selectedMessageCount: 1,
    omittedMessageCount: 1,
    sharedCard: null,
    destination: { scope: 'personal', organizationGroupCount: 0 },
    synthesis: promotionRequest().synthesis,
    previewToken: 'opaque.promotion.token',
    expiresAt: '2026-08-10T01:10:00.000Z',
    requiresConfirmation: true,
    requiresOrganizationAudienceConfirmation: false,
    providerKey: 'private',
  };
}

beforeEach(() => {
  apiResponse.mockReset();
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000001'),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('knowledge share API boundary', () => {
  it('posts an allowlisted selective-share preview and forwards AbortSignal', async () => {
    apiResponse.mockResolvedValueOnce(jsonResponse(sharePreviewPayload()));
    const controller = new AbortController();

    const result = await previewKnowledgeShare(
      {
        itemId: 'item/1',
        destinationRoomId: 'room/1',
        selection: {
          ...selection(),
          providerKey: 'must-not-send',
        } as KnowledgeShareSelectionDraft,
      },
      { signal: controller.signal },
    );

    expect(apiResponse).toHaveBeenCalledWith(
      '/knowledge/items/item%2F1/shares/preview',
      expect.objectContaining({ method: 'POST', signal: controller.signal }),
    );
    const body = JSON.parse(String(apiResponse.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({
      destinationRoomId: 'room/1',
      selection: selection(),
    });
    expect(JSON.stringify(body)).not.toContain('must-not-send');
    expect(result.previewToken).toBe('opaque.preview.token');
    expect(JSON.stringify(result)).not.toMatch(
      /providerKey|sourceKnowledgeItemId|roomId|must-not-pass-through/,
    );
  });

  it('keeps one in-memory request key across an explicit share commit and never returns it', async () => {
    apiResponse.mockResolvedValueOnce(
      jsonResponse(
        {
          ...postedStatus({ requestKey: 'must-not-pass-through' }),
          created: true,
          reused: false,
          resultUnknown: false,
        },
        201,
      ),
    );

    const result = await commitKnowledgeShare({
      itemId: 'item-1',
      destinationRoomId: 'room-1',
      selection: selection(),
      previewToken: 'opaque.preview.token',
      requestKey: createKnowledgeShareRequestKey(),
    });

    const body = JSON.parse(String(apiResponse.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      destinationRoomId: 'room-1',
      confirmed: true,
      previewToken: 'opaque.preview.token',
      requestKey: '00000000-0000-4000-8000-000000000001',
    });
    expect(result).toEqual({
      ...postedStatus(),
      created: true,
      reused: false,
      resultUnknown: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/requestKey|00000000-0000/);
  });

  it('uses exact status, reconcile, revoke, card, and source routes', async () => {
    const controller = new AbortController();
    apiResponse
      .mockResolvedValueOnce(jsonResponse(postedStatus()))
      .mockResolvedValueOnce(jsonResponse(postedStatus()))
      .mockResolvedValueOnce(
        jsonResponse({
          ...postedStatus({
            status: 'revoked',
            version: 3,
            revokedAt: '2026-08-10T01:02:00.000Z',
          }),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          shareId: 'share-1',
          status: 'posted',
          version: 2,
          schemaVersion: 1,
          card: titleOnlyCard(),
          canOpenSource: true,
          sourceKnowledgeItemId: 'must-not-pass-through',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          knowledgeItemId: 'item-1',
          sourceOwnerUserId: 'must-not-pass-through',
        }),
      );

    await getKnowledgeShareStatus('share/1', { signal: controller.signal });
    await reconcileKnowledgeShare('share/1', { signal: controller.signal });
    await revokeKnowledgeShare('share/1', { signal: controller.signal });
    const card = await getKnowledgeShareCard('message/1', {
      signal: controller.signal,
    });
    const source = await openKnowledgeShareSource('share/1', {
      signal: controller.signal,
    });

    expect(apiResponse.mock.calls.map((call) => call[0])).toEqual([
      '/knowledge/shares/share%2F1',
      '/knowledge/shares/share%2F1/reconcile',
      '/knowledge/shares/share%2F1/revoke',
      '/chat-messages/message%2F1/knowledge-share',
      '/knowledge/shares/share%2F1/source',
    ]);
    expect(apiResponse.mock.calls[0]?.[1]).toEqual({
      signal: controller.signal,
    });
    expect(apiResponse.mock.calls[1]?.[1]).toEqual({
      method: 'POST',
      signal: controller.signal,
    });
    expect(apiResponse.mock.calls[2]?.[1]).toEqual({
      method: 'POST',
      signal: controller.signal,
    });
    expect(card).not.toHaveProperty('sourceKnowledgeItemId');
    expect(source).toEqual({ knowledgeItemId: 'item-1' });
  });

  it('fetches compact summary batches and active label assignment options', async () => {
    const controller = new AbortController();
    apiResponse
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              messageId: 'message-1',
              shareId: 'share-1',
              status: 'posted',
              version: 2,
              schemaVersion: 1,
              sourceKnowledgeItemId: 'must-not-pass-through',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              assignmentId: 'assignment-1',
              displayName: 'Architecture',
              scope: 'organization',
              labelVersion: 4,
              labelId: 'must-not-pass-through',
              providerData: 'must-not-pass-through',
            },
          ],
        }),
      );

    const summaries = await listRoomKnowledgeShareSummaries({
      roomId: 'room/1',
      messageIds: ['message-1', 'message-2', 'message-1'],
      signal: controller.signal,
    });
    const assignments = await listKnowledgeShareLabelAssignments('item/1', {
      signal: controller.signal,
    });

    expect(apiResponse.mock.calls[0]?.[0]).toBe(
      '/chat-rooms/room%2F1/knowledge-share-messages?messageIds=message-1%2Cmessage-2',
    );
    expect(apiResponse.mock.calls[1]?.[0]).toBe(
      '/knowledge/items/item%2F1/label-assignments',
    );
    expect(summaries).toEqual([
      {
        messageId: 'message-1',
        shareId: 'share-1',
        status: 'posted',
        version: 2,
        schemaVersion: 1,
      },
    ]);
    expect(assignments).toEqual([
      {
        assignmentId: 'assignment-1',
        displayName: 'Architecture',
        scope: 'organization',
        labelVersion: 4,
      },
    ]);
    expect(JSON.stringify([summaries, assignments])).not.toContain(
      'must-not-pass-through',
    );
  });

  it('rejects a summary row outside the requested message set', async () => {
    apiResponse.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            messageId: 'message-other',
            shareId: 'share-1',
            status: 'posted',
            version: 2,
            schemaVersion: 1,
          },
        ],
      }),
    );

    await expect(
      listRoomKnowledgeShareSummaries({
        roomId: 'room-1',
        messageIds: ['message-1'],
      }),
    ).rejects.toMatchObject({
      code: 'invalid_response',
      status: 200,
      message: 'knowledge_share_request_failed',
    });
  });
});

describe('knowledge thread promotion API boundary', () => {
  it('previews and commits exact promotion requests with one caller-held request key', async () => {
    const controller = new AbortController();
    apiResponse
      .mockResolvedValueOnce(jsonResponse(promotionPreviewPayload()))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            promotionId: 'promotion-1',
            synthesisId: 'synthesis-1',
            synthesisVersionId: 'synthesis-version-1',
            synthesisVersion: 1,
            scope: 'personal',
            selectedMessageCount: 1,
            includesSharedCard: false,
            createdAt: timestamp,
            created: true,
            reused: false,
            requestKeyHash: 'must-not-pass-through',
          },
          201,
        ),
      );

    const preview = await previewKnowledgeThreadPromotion(
      {
        rootMessageId: 'root/1',
        request: {
          ...promotionRequest(),
          providerKey: 'must-not-send',
        } as KnowledgeThreadPromotionDraft,
      },
      { signal: controller.signal },
    );
    const commit = await commitKnowledgeThreadPromotion({
      rootMessageId: 'root/1',
      request: promotionRequest(),
      previewToken: preview.previewToken,
      requestKey: createKnowledgeShareRequestKey(),
      organizationAudienceConfirmed: false,
    });

    expect(apiResponse.mock.calls.map((call) => call[0])).toEqual([
      '/chat-messages/root%2F1/promote-to-knowledge/preview',
      '/chat-messages/root%2F1/promote-to-knowledge',
    ]);
    const previewBody = JSON.parse(
      String(apiResponse.mock.calls[0]?.[1]?.body),
    );
    const commitBody = JSON.parse(String(apiResponse.mock.calls[1]?.[1]?.body));
    expect(previewBody).toEqual(promotionRequest());
    expect(commitBody).toEqual({
      ...promotionRequest(),
      previewToken: 'opaque.promotion.token',
      requestKey: '00000000-0000-4000-8000-000000000001',
      confirmed: true,
      organizationAudienceConfirmed: false,
    });
    expect(JSON.stringify(preview)).not.toMatch(
      /providerKey|sourceRoomId|sourceMessageId|must-not-pass-through/,
    );
    expect(JSON.stringify(commit)).not.toMatch(
      /requestKey|must-not-pass-through|00000000-0000/,
    );
  });

  it('rejects a response that does not match the requested promotion topology', async () => {
    apiResponse.mockResolvedValueOnce(
      jsonResponse({
        ...promotionPreviewPayload(),
        selectedMessageCount: 2,
        sourceThread: {
          roomName: 'Architecture room',
          roomType: 'private_group',
          replyCount: 3,
        },
      }),
    );

    await expect(
      previewKnowledgeThreadPromotion({
        rootMessageId: 'root-1',
        request: promotionRequest(),
      }),
    ).rejects.toMatchObject({ code: 'invalid_response', status: 200 });
  });
});

describe('safe error handling', () => {
  it('preserves only allowlisted codes and drops raw backend messages', async () => {
    apiResponse
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'stale_preview',
              message: 'providerKey=secret https://internal.invalid',
            },
          },
          409,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'private_provider_error',
              message: 'providerKey=secret https://internal.invalid',
            },
          },
          502,
        ),
      );

    const known = await getKnowledgeShareStatus('share-1').catch(
      (error: unknown) => error,
    );
    const unknown = await getKnowledgeShareStatus('share-1').catch(
      (error: unknown) => error,
    );

    expect(known).toBeInstanceOf(KnowledgeShareSafeError);
    expect(known).toMatchObject({
      code: 'stale_preview',
      status: 409,
      message: 'knowledge_share_request_failed',
    });
    expect(unknown).toMatchObject({
      code: 'unknown_error',
      status: 502,
      message: 'knowledge_share_request_failed',
    });
    expect(String(known) + String(unknown)).not.toMatch(
      /providerKey|secret|internal\.invalid|private_provider_error/,
    );
  });

  it('sanitizes network and abort failures and rejects malformed success payloads', async () => {
    apiResponse
      .mockRejectedValueOnce(new Error('providerKey=secret /private/path'))
      .mockRejectedValueOnce(new DOMException('private reason', 'AbortError'))
      .mockResolvedValueOnce(
        jsonResponse({
          ...postedStatus(),
          version: 1.5,
          providerKey: 'secret',
        }),
      );

    await expect(getKnowledgeShareStatus('share-1')).rejects.toMatchObject({
      code: 'network_error',
      status: null,
    });
    await expect(getKnowledgeShareStatus('share-1')).rejects.toMatchObject({
      code: 'request_aborted',
      status: null,
    });
    const malformed = await getKnowledgeShareStatus('share-1').catch(
      (error: unknown) => error,
    );
    expect(malformed).toMatchObject({ code: 'invalid_response', status: 200 });
    expect(String(malformed)).not.toMatch(/providerKey|secret/);
  });

  it('fails closed before sending malformed IDs or selections', async () => {
    await expect(
      getKnowledgeShareStatus('share-\u202e-spoof'),
    ).rejects.toMatchObject({ code: 'invalid_request', status: null });
    await expect(
      previewKnowledgeShare({
        itemId: 'item-1',
        destinationRoomId: 'room-1',
        selection: {
          ...selection(),
          includeTitle: false,
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', status: null });
    expect(apiResponse).not.toHaveBeenCalled();
  });
});

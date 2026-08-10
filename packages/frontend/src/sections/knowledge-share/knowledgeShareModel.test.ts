import { describe, expect, it } from 'vitest';

import {
  buildKnowledgeShareSelectionRequest,
  buildKnowledgeThreadPromotionRequest,
  normalizeKnowledgeShareCard,
  normalizeKnowledgeShareCommit,
  normalizeKnowledgeShareLabelAssignmentOptions,
  normalizeKnowledgeShareRoomCard,
  normalizeKnowledgeShareStatus,
  normalizeKnowledgeThreadPromotionPreview,
  normalizeRoomKnowledgeShareSummaries,
  promotionPreviewMatchesRequest,
  sharePreviewMatchesSelection,
  type KnowledgeShareCard,
  type KnowledgeShareSelectionDraft,
  type KnowledgeThreadPromotionDraft,
} from './knowledgeShareModel';

const timestamp = '2026-08-10T01:00:00.000Z';

function selection(
  overrides: Partial<KnowledgeShareSelectionDraft> = {},
): KnowledgeShareSelectionDraft {
  return {
    includeTitle: true,
    includeSourceType: true,
    includeCanonicalUrl: true,
    snapshot: {
      snapshotId: 'snapshot-1',
      includeProvenance: true,
      includeExcerpt: true,
    },
    labelAssignmentIds: ['assignment-1'],
    annotations: [{ annotationId: 'annotation-1', revision: 2 }],
    conversationTurnIds: ['turn-1'],
    syntheses: [{ synthesisId: 'synthesis-1', version: 3 }],
    sharerNote: 'Shared note',
    ...overrides,
  };
}

function card(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    title: 'Selected title',
    sourceType: 'manual',
    canonicalUrl: 'https://example.com/article',
    snapshot: {
      version: 4,
      sha256: 'a'.repeat(64),
      excerpt: 'Selected excerpt',
      sourceSnapshotId: 'must-not-pass-through',
    },
    sharerNote: 'Shared note',
    labels: [
      {
        displayName: 'Architecture',
        sourceLabelId: 'must-not-pass-through',
      },
    ],
    annotations: [
      {
        revision: 2,
        kind: 'quote',
        origin: 'user',
        content: 'Selected annotation',
        sourceRevisionId: 'must-not-pass-through',
      },
    ],
    turns: [
      {
        role: 'assistant',
        origin: 'ai',
        content: 'Selected turn',
        name: null,
        occurredAt: timestamp,
        sourceTurnId: 'must-not-pass-through',
      },
    ],
    syntheses: [
      {
        version: 3,
        title: 'Selected synthesis',
        content: 'Selected conclusion',
        confidenceBasisPoints: 8000,
        unresolvedQuestions: ['Question'],
        sourceSynthesisId: 'must-not-pass-through',
      },
    ],
    selectedCategories: [
      'title',
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
    omittedCategories: [],
    providerKey: 'must-not-pass-through',
    ...overrides,
  };
}

function promotionDraft(
  overrides: Partial<KnowledgeThreadPromotionDraft> = {},
): KnowledgeThreadPromotionDraft {
  return {
    selectedReplyMessageIds: ['reply-2', 'reply-1'],
    includeSharedCard: true,
    destination: {
      scope: 'organization',
      organizationGroupAccountIds: ['group-b', 'group-a'],
    },
    synthesis: {
      title: 'Promotion title',
      content: 'Only selected content.',
      confidenceBasisPoints: 7500,
      unresolvedQuestions: ['Question'],
    },
    ...overrides,
  };
}

describe('knowledge share request models', () => {
  it('reconstructs the selective-share allowlist and drops unknown draft fields', () => {
    const request = buildKnowledgeShareSelectionRequest({
      ...selection(),
      providerKey: 'private',
      snapshot: {
        snapshotId: 'snapshot-1',
        includeProvenance: true,
        includeExcerpt: true,
        sourceObjectId: 'private',
      },
    });

    expect(request).toEqual(selection());
    expect(JSON.stringify(request)).not.toMatch(/providerKey|sourceObjectId/);
  });

  it('rejects empty selections, duplicate selectors, unsafe IDs, and invalid versions', () => {
    expect(
      buildKnowledgeShareSelectionRequest(
        selection({
          includeTitle: false,
          includeSourceType: false,
          includeCanonicalUrl: false,
          snapshot: null,
          labelAssignmentIds: [],
          annotations: [],
          conversationTurnIds: [],
          syntheses: [],
          sharerNote: null,
        }),
      ),
    ).toBeNull();
    expect(
      buildKnowledgeShareSelectionRequest(
        selection({ labelAssignmentIds: ['same', 'same'] }),
      ),
    ).toBeNull();
    expect(
      buildKnowledgeShareSelectionRequest(
        selection({ conversationTurnIds: ['turn-\u202e-spoof'] }),
      ),
    ).toBeNull();
    expect(
      buildKnowledgeShareSelectionRequest(
        selection({
          annotations: [{ annotationId: 'annotation-1', revision: 1.5 }],
        }),
      ),
    ).toBeNull();
    expect(
      buildKnowledgeShareSelectionRequest(
        selection({
          snapshot: {
            snapshotId: 'snapshot-1',
            includeProvenance: false,
            includeExcerpt: false,
          },
        }),
      ),
    ).toBeNull();
  });

  it('preserves reply order, canonicalizes grant order, and enforces scope topology', () => {
    const request = buildKnowledgeThreadPromotionRequest({
      ...promotionDraft(),
      sourceRoomId: 'private',
    });

    expect(request).toMatchObject({
      selectedReplyMessageIds: ['reply-2', 'reply-1'],
      destination: {
        scope: 'organization',
        organizationGroupAccountIds: ['group-a', 'group-b'],
      },
    });
    expect(request).not.toHaveProperty('sourceRoomId');
    expect(
      buildKnowledgeThreadPromotionRequest(
        promotionDraft({
          destination: {
            scope: 'personal',
            organizationGroupAccountIds: ['group-a'] as unknown as [],
          },
        }),
      ),
    ).toBeNull();
    expect(
      buildKnowledgeThreadPromotionRequest(
        promotionDraft({ selectedReplyMessageIds: [] }),
      ),
    ).toBeNull();
  });
});

describe('knowledge share response normalizers', () => {
  it('reconstructs a public card without provider/internal/source identifiers', () => {
    const normalized = normalizeKnowledgeShareCard(card());

    expect(normalized).toMatchObject({
      schemaVersion: 1,
      title: 'Selected title',
      labels: [{ displayName: 'Architecture' }],
      snapshot: { version: 4, sha256: 'a'.repeat(64) },
    });
    expect(JSON.stringify(normalized)).not.toMatch(
      /providerKey|sourceSnapshotId|sourceLabelId|sourceRevisionId|sourceTurnId|sourceSynthesisId|must-not-pass-through/,
    );
  });

  it('rejects malformed enums, dates, bounds, URLs, and category topology', () => {
    expect(
      normalizeKnowledgeShareCard(card({ sourceType: 'provider' })),
    ).toBeNull();
    expect(
      normalizeKnowledgeShareCard(
        card({ canonicalUrl: 'https://user:secret@example.com/private?q=1' }),
      ),
    ).toBeNull();
    expect(
      normalizeKnowledgeShareCard(
        card({
          turns: [
            {
              role: 'assistant',
              origin: 'ai',
              content: 'turn',
              name: null,
              occurredAt: '2026-02-31T00:00:00.000Z',
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      normalizeKnowledgeShareCard(
        card({
          syntheses: [
            {
              version: 1,
              title: 'title',
              content: 'content',
              confidenceBasisPoints: 10_001,
              unresolvedQuestions: [],
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      normalizeKnowledgeShareCard(
        card({ omittedCategories: ['canonical_url'] }),
      ),
    ).toBeNull();
  });

  it('accepts provenance-only and excerpt-only snapshots', () => {
    const base = card({
      title: null,
      sourceType: null,
      canonicalUrl: null,
      sharerNote: null,
      labels: [],
      annotations: [],
      turns: [],
      syntheses: [],
    });
    const provenance = normalizeKnowledgeShareCard({
      ...base,
      snapshot: { version: 2, sha256: 'b'.repeat(64) },
      selectedCategories: ['snapshot_provenance'],
      omittedCategories: [
        'title',
        'source_type',
        'canonical_url',
        'snapshot_excerpt',
        'label',
        'annotation',
        'conversation_turn',
        'synthesis',
        'sharer_note',
      ],
    });
    const excerpt = normalizeKnowledgeShareCard({
      ...base,
      snapshot: { excerpt: 'excerpt' },
      selectedCategories: ['snapshot_excerpt'],
      omittedCategories: [
        'title',
        'source_type',
        'canonical_url',
        'snapshot_provenance',
        'label',
        'annotation',
        'conversation_turn',
        'synthesis',
        'sharer_note',
      ],
    });

    expect(provenance?.snapshot).toEqual({
      version: 2,
      sha256: 'b'.repeat(64),
    });
    expect(excerpt?.snapshot).toEqual({ excerpt: 'excerpt' });
  });

  it('enforces lifecycle date and field topology for status and commit responses', () => {
    const posted = {
      shareId: 'share-1',
      status: 'posted',
      version: 2,
      chatMessageId: 'message-1',
      failureCode: null,
      createdAt: timestamp,
      postedAt: '2026-08-10T01:01:00.000Z',
      failedAt: null,
      revokedAt: null,
      sourceItemId: 'must-not-pass-through',
    };

    expect(normalizeKnowledgeShareStatus(posted)).not.toHaveProperty(
      'sourceItemId',
    );
    expect(
      normalizeKnowledgeShareStatus({
        ...posted,
        status: 'pending',
      }),
    ).toBeNull();
    expect(
      normalizeKnowledgeShareStatus({
        ...posted,
        postedAt: '2026-08-09T23:00:00.000Z',
      }),
    ).toBeNull();
    expect(
      normalizeKnowledgeShareCommit({
        ...posted,
        created: true,
        reused: true,
        resultUnknown: false,
      }),
    ).toBeNull();
  });

  it('binds compact summaries to requested messages and enforces card placeholders', () => {
    const summaries = normalizeRoomKnowledgeShareSummaries(
      {
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
      },
      new Set(['message-1', 'message-2']),
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
    expect(
      normalizeRoomKnowledgeShareSummaries(
        {
          items: [
            {
              messageId: 'message-other',
              shareId: 'share-1',
              status: 'posted',
              version: 2,
              schemaVersion: 1,
            },
          ],
        },
        new Set(['message-1']),
      ),
    ).toBeNull();
    expect(
      normalizeKnowledgeShareRoomCard({
        shareId: 'share-1',
        status: 'revoked',
        version: 3,
        schemaVersion: 1,
        card: null,
        canOpenSource: false,
      }),
    ).toEqual({
      shareId: 'share-1',
      status: 'revoked',
      version: 3,
      schemaVersion: 1,
      card: null,
      canOpenSource: false,
    });
    expect(
      normalizeKnowledgeShareRoomCard({
        shareId: 'share-1',
        status: 'posted',
        version: 2,
        schemaVersion: 1,
        card: null,
        canOpenSource: false,
      }),
    ).toBeNull();
  });

  it('normalizes only the active label-assignment option contract', () => {
    const result = normalizeKnowledgeShareLabelAssignmentOptions({
      items: [
        {
          assignmentId: 'assignment-1',
          displayName: 'Architecture',
          scope: 'personal',
          labelVersion: 3,
          ownerUserId: 'must-not-pass-through',
          labelId: 'must-not-pass-through',
        },
      ],
    });

    expect(result).toEqual([
      {
        assignmentId: 'assignment-1',
        displayName: 'Architecture',
        scope: 'personal',
        labelVersion: 3,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('must-not-pass-through');
    expect(
      normalizeKnowledgeShareLabelAssignmentOptions({
        items: [
          {
            assignmentId: 'assignment-1',
            displayName: 'Architecture',
            scope: 'external',
            labelVersion: 3,
          },
        ],
      }),
    ).toBeNull();
  });
});

describe('promotion response topology', () => {
  it('requires contiguous ordinals, exact counts, scope bounds, and request binding', () => {
    const request = buildKnowledgeThreadPromotionRequest(promotionDraft());
    expect(request).not.toBeNull();
    const response = {
      sourceThread: {
        roomName: 'Architecture room',
        roomType: 'private_group',
        replyCount: 3,
      },
      selectedMessages: [
        {
          ordinal: 0,
          content: 'First selected reply',
          createdAt: timestamp,
          authorCategory: 'user',
          sourceMessageId: 'must-not-pass-through',
        },
        {
          ordinal: 1,
          content: 'Second selected reply',
          createdAt: timestamp,
          authorCategory: 'user',
        },
      ],
      selectedMessageCount: 2,
      omittedMessageCount: 1,
      sharedCard: { ...card(), shareVersion: 2 },
      destination: { scope: 'organization', organizationGroupCount: 2 },
      synthesis: promotionDraft().synthesis,
      previewToken: 'opaque.preview.token',
      expiresAt: '2026-08-10T01:10:00.000Z',
      requiresConfirmation: true,
      requiresOrganizationAudienceConfirmation: true,
      sourceRoomId: 'must-not-pass-through',
    };

    const normalized = normalizeKnowledgeThreadPromotionPreview(response);
    expect(normalized).not.toBeNull();
    expect(JSON.stringify(normalized)).not.toMatch(
      /sourceMessageId|sourceRoomId|must-not-pass-through/,
    );
    const expectedReplies = [
      {
        messageId: 'reply-2',
        content: 'First selected reply',
        createdAt: timestamp,
      },
      {
        messageId: 'reply-1',
        content: 'Second selected reply',
        createdAt: timestamp,
      },
    ];
    expect(
      promotionPreviewMatchesRequest(normalized!, request!, expectedReplies),
    ).toBe(true);
    expect(
      promotionPreviewMatchesRequest(normalized!, request!, [
        expectedReplies[0]!,
        { ...expectedReplies[1]!, content: 'substituted reply' },
      ]),
    ).toBe(false);
    expect(
      normalizeKnowledgeThreadPromotionPreview({
        ...response,
        selectedMessages: [
          response.selectedMessages[0],
          { ...response.selectedMessages[1], ordinal: 3 },
        ],
      }),
    ).toBeNull();
    expect(
      normalizeKnowledgeThreadPromotionPreview({
        ...response,
        omittedMessageCount: 2,
      }),
    ).toBeNull();
    expect(
      normalizeKnowledgeThreadPromotionPreview({
        ...response,
        requiresOrganizationAudienceConfirmation: false,
      }),
    ).toBeNull();
  });

  it('binds share preview categories to the exact selection', () => {
    const request = buildKnowledgeShareSelectionRequest(selection());
    const preview = {
      card: normalizeKnowledgeShareCard(card()) as KnowledgeShareCard,
      destinationRoom: { name: 'Room', type: 'private_group' },
      previewToken: 'token',
      expiresAt: timestamp,
      requiresConfirmation: true as const,
    };

    expect(sharePreviewMatchesSelection(preview, request!)).toBe(true);
    expect(
      sharePreviewMatchesSelection(preview, {
        ...request!,
        includeCanonicalUrl: false,
      }),
    ).toBe(false);
  });
});

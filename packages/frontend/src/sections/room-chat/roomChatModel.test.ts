import { describe, expect, it } from 'vitest';

import {
  buildDisplayedRooms,
  formatRoomLabel,
  newestVisibleMessageBoundary,
  normalizeChatMessage,
  normalizeMentionCandidates,
  normalizeChatSearchItem,
  normalizeChatThread,
  toAttachmentRecord,
  transformLinkUri,
  type ChatRoom,
} from './roomChatModel';

function message(
  id: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    roomId: 'room-1',
    messageType: 'text',
    parentMessageId: null,
    threadRootId: null,
    userId: 'alice',
    body: `${id} body`,
    tags: ['daily'],
    reactions: { '👍': { count: 1, userIds: ['alice'] } },
    mentions: { userIds: ['bob'], groupIds: [] },
    mentionsAll: false,
    ackRequest: null,
    attachments: [],
    createdAt: '2026-08-09T00:00:00.000Z',
    deletedAt: null,
    deletedReason: null,
    providerUrl: 'https://internal.invalid',
    rawError: 'must not survive normalization',
    ...extra,
  };
}

function ackRequest(messageId: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'ack-1',
    messageId,
    roomId: 'room-1',
    requiredUserIds: ['bob'],
    dueAt: null,
    canceledAt: null,
    canceledBy: null,
    acks: [
      {
        id: 'ack-row-1',
        requestId: 'ack-1',
        userId: 'bob',
        ackedAt: '2026-08-09T00:01:00.000Z',
        providerUser: 'must not survive normalization',
      },
    ],
    providerRequest: 'must not survive normalization',
    ...extra,
  };
}

describe('roomChatModel', () => {
  it('formats direct-message labels for the current user', () => {
    const room: ChatRoom = {
      id: 'dm-1',
      type: 'dm',
      name: 'dm:alice:bob',
    };

    expect(formatRoomLabel(room, 'alice')).toBe('bob');
    expect(formatRoomLabel(room, 'charlie')).toBe('alice / bob');
  });

  it('filters displayed rooms by GA personal scope and query', () => {
    const rooms: ChatRoom[] = [
      {
        id: 'pga_1',
        type: 'private_group',
        name: '総務個別',
        isOfficial: true,
      },
      {
        id: 'private_1',
        type: 'private_group',
        name: '任意グループ',
        isOfficial: false,
      },
      {
        id: 'project-1',
        type: 'project',
        name: 'project room',
        projectCode: 'P-001',
        projectName: 'Alpha',
      },
    ];

    expect(buildDisplayedRooms(rooms, 'alice', 'ga_personal', '総務')).toEqual([
      expect.objectContaining({
        id: 'pga_1',
        label: 'private_group: 総務個別',
      }),
    ]);
    expect(buildDisplayedRooms(rooms, 'alice', 'all', 'alpha')).toEqual([
      expect.objectContaining({
        id: 'project-1',
        label: 'project: P-001 / Alpha',
      }),
    ]);
  });

  it('allows safe markdown links and rejects javascript URLs', () => {
    expect(transformLinkUri('/internal')).toBe('/internal');
    expect(transformLinkUri('https://example.com')).toBe('https://example.com');
    expect(transformLinkUri('mailto:hello@example.com')).toBe(
      'mailto:hello@example.com',
    );
    expect(transformLinkUri('javascript:alert(1)')).toBe('');
  });

  it('normalizes attachment records for the shared attachment field', () => {
    expect(
      toAttachmentRecord({
        id: 'att-1',
        originalName: 'evidence.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 123,
      }),
    ).toEqual(
      expect.objectContaining({
        id: 'att-1',
        name: 'evidence.pdf',
        size: 123,
        mimeType: 'application/pdf',
        status: 'uploaded',
      }),
    );
  });

  it('allowlists message fields and redacts content-bearing fields after logical delete', () => {
    const visible = normalizeChatMessage(message('root-1'));
    expect(visible).toEqual(
      expect.objectContaining({
        id: 'root-1',
        body: 'root-1 body',
        deleted: false,
      }),
    );
    expect(visible).not.toHaveProperty('providerUrl');
    expect(visible).not.toHaveProperty('rawError');

    const deleted = normalizeChatMessage(
      message('reply-1', {
        parentMessageId: 'root-1',
        threadRootId: 'root-1',
        deletedAt: '2026-08-09T00:01:00.000Z',
        deletedReason: 'user_retract',
      }),
    );
    expect(deleted).toEqual(
      expect.objectContaining({
        body: null,
        deleted: true,
        tags: [],
        reactions: undefined,
        mentions: null,
        attachments: [],
      }),
    );
  });

  it('fails closed when nested ACK identities do not match the containing message', () => {
    const normalized = normalizeChatMessage(
      message('root-1', { ackRequest: ackRequest('root-1') }),
    );
    expect(normalized?.ackRequest).toEqual({
      id: 'ack-1',
      messageId: 'root-1',
      roomId: 'room-1',
      requiredUserIds: ['bob'],
      dueAt: null,
      canceledAt: null,
      canceledBy: null,
      acks: [
        {
          id: 'ack-row-1',
          requestId: 'ack-1',
          userId: 'bob',
          ackedAt: '2026-08-09T00:01:00.000Z',
        },
      ],
    });
    expect(normalized?.ackRequest).not.toHaveProperty('providerRequest');
    expect(normalized?.ackRequest?.acks?.[0]).not.toHaveProperty(
      'providerUser',
    );
    expect(
      normalizeChatMessage(
        message('root-1', {
          ackRequest: ackRequest('root-1', { acks: null }),
        }),
      )?.ackRequest?.acks,
    ).toEqual([]);
    expect(
      normalizeChatMessage(
        message('root-1', {
          ackRequest: ackRequest('root-1', { acks: { userId: 'bob' } }),
        }),
      ),
    ).toBeNull();

    expect(
      normalizeChatMessage(
        message('root-1', {
          ackRequest: ackRequest('other-message'),
        }),
      ),
    ).toBeNull();
    expect(
      normalizeChatMessage(
        message('root-1', {
          ackRequest: ackRequest('root-1', {
            acks: [
              {
                requestId: 'ack-1',
                userId: 'mallory',
                ackedAt: '2026-08-09T00:01:00.000Z',
              },
            ],
          }),
        }),
      ),
    ).toBeNull();
    expect(
      normalizeChatMessage(
        message('root-1', {
          ackRequest: ackRequest('root-1', { roomId: 'other-room' }),
        }),
      ),
    ).toBeNull();
    expect(
      normalizeChatMessage(
        message('root-1', {
          ackRequest: ackRequest('root-1', {
            acks: [
              {
                id: 'ack-row-1',
                requestId: 'other-request',
                userId: 'mallory',
                ackedAt: '2026-08-09T00:01:00.000Z',
              },
            ],
          }),
        }),
      ),
    ).toBeNull();
    expect(
      normalizeChatMessage(
        message('root-1', { ackRequest: { id: 'legacy-ack' } }),
      ),
    ).toBeNull();
  });

  it('allowlists and bounds mention candidates', () => {
    const candidates = normalizeMentionCandidates({
      users: [
        {
          userId: ' alice ',
          displayName: ' Alice ',
          providerProfile: 'hidden',
        },
        { userId: '', displayName: 'Missing ID' },
        { userId: 'bad-display', displayName: { raw: 'hidden' } },
        { userId: 'x'.repeat(201), displayName: 'Oversized ID' },
        ...Array.from({ length: 60 }, (_, index) => ({
          userId: `user-${index}`,
        })),
      ],
      groups: [
        {
          groupId: ' group-1 ',
          displayName: null,
          providerGroup: 'hidden',
        },
        { groupId: 'bad-group', displayName: 'x'.repeat(201) },
        ...Array.from({ length: 25 }, (_, index) => ({
          groupId: `group-${index + 2}`,
        })),
      ],
      allowAll: true,
      providerCursor: 'hidden',
    });

    expect(candidates.users).toHaveLength(50);
    expect(candidates.groups).toHaveLength(20);
    expect(candidates.users?.[0]).toEqual({
      userId: 'alice',
      displayName: 'Alice',
    });
    expect(candidates.groups?.[0]).toEqual({
      groupId: 'group-1',
      displayName: null,
    });
    expect(candidates.allowAll).toBe(true);
    expect(candidates).not.toHaveProperty('providerCursor');
    expect(candidates.users?.[0]).not.toHaveProperty('providerProfile');
    expect(candidates.groups?.[0]).not.toHaveProperty('providerGroup');
    expect(JSON.stringify(candidates)).not.toMatch(/bad-display|bad-group/);
  });

  it('fails closed for unsupported message types and malformed thread topology', () => {
    expect(
      normalizeChatMessage(message('future-1', { messageType: 'provider' })),
    ).toBeNull();
    expect(
      normalizeChatMessage(message('missing-body', { body: null })),
    ).toBeNull();
    const missingMessageType = message('missing-type');
    delete missingMessageType.messageType;
    expect(normalizeChatMessage(missingMessageType)).toEqual(
      expect.objectContaining({ id: 'missing-type', messageType: 'text' }),
    );

    expect(
      normalizeChatThread({
        root: message('root-1'),
        replies: [
          message('reply-1', {
            parentMessageId: 'other-root',
            threadRootId: 'other-root',
          }),
        ],
        replyCount: 1,
        lastReplyAt: '2026-08-09T00:01:00.000Z',
        nextCursor: null,
      }),
    ).toBeNull();
  });

  it('normalizes valid thread/search payloads without retaining unknown fields', () => {
    const thread = normalizeChatThread({
      root: message('root-1'),
      replies: [
        message('reply-1', {
          parentMessageId: 'root-1',
          threadRootId: 'root-1',
          createdAt: '2026-08-09T00:01:00.000Z',
        }),
      ],
      replyCount: 1,
      lastReplyAt: '2026-08-09T00:01:00.000Z',
      nextCursor: 'opaque-cursor',
      providerKey: 'hidden',
    });
    expect(thread?.replies).toHaveLength(1);
    expect(thread).not.toHaveProperty('providerKey');

    const search = normalizeChatSearchItem({
      ...message('reply-1', {
        parentMessageId: 'root-1',
        threadRootId: 'root-1',
      }),
      room: {
        id: 'room-1',
        type: 'project',
        name: 'Project room',
        providerUrl: 'https://internal.invalid',
      },
    });
    expect(search).toEqual(
      expect.objectContaining({
        id: 'reply-1',
        parentMessageId: 'root-1',
      }),
    );
    expect(search?.room).not.toHaveProperty('providerUrl');

    expect(
      normalizeChatSearchItem({
        ...message('wrong-room'),
        roomId: 'room-2',
        room: { id: 'room-1', type: 'project', name: 'Project room' },
      }),
    ).toBeNull();
    const missingSearchType: Record<string, unknown> = {
      ...message('missing-search-type'),
      room: { id: 'room-1', type: 'project', name: 'Project room' },
    };
    delete missingSearchType.messageType;
    expect(normalizeChatSearchItem(missingSearchType)).toEqual(
      expect.objectContaining({
        id: 'missing-search-type',
        messageType: 'text',
      }),
    );
    expect(
      normalizeChatSearchItem({
        ...message('unsupported-type'),
        messageType: 'provider',
        room: { id: 'room-1', type: 'project', name: 'Project room' },
      }),
    ).toBeNull();
  });

  it('uses the newest unique timestamp as the deterministic read boundary', () => {
    const root = normalizeChatMessage(message('root-1'));
    const reply = normalizeChatMessage(
      message('z-reply', {
        parentMessageId: 'root-1',
        threadRootId: 'root-1',
        createdAt: '2026-08-09T00:00:01.000Z',
      }),
    );
    expect(
      root && reply ? newestVisibleMessageBoundary([root, reply]) : null,
    ).toEqual({
      through: '2026-08-09T00:00:01.000Z',
      throughMessageId: 'z-reply',
    });
  });

  it('does not order same-millisecond messages by random UUID', () => {
    const older = normalizeChatMessage(
      message('older', { createdAt: '2026-08-08T23:59:59.999Z' }),
    );
    const first = normalizeChatMessage(message('z-random-id'));
    const second = normalizeChatMessage(
      message('a-random-id', {
        parentMessageId: 'z-random-id',
        threadRootId: 'z-random-id',
      }),
    );
    expect(
      older && first && second
        ? newestVisibleMessageBoundary([older, first, second])
        : null,
    ).toEqual({
      through: '2026-08-08T23:59:59.999Z',
      throughMessageId: 'older',
    });
    expect(
      first && second ? newestVisibleMessageBoundary([first, second]) : null,
    ).toBeNull();
  });

  it('stays before the newest timestamp while a later thread page exists', () => {
    const older = normalizeChatMessage(
      message('older', { createdAt: '2026-08-09T00:00:00.000Z' }),
    );
    const pageBoundary = normalizeChatMessage(
      message('page-boundary', { createdAt: '2026-08-09T00:00:01.000Z' }),
    );
    expect(
      older && pageBoundary
        ? newestVisibleMessageBoundary([older, pageBoundary], {
            excludeNewestTimestamp: true,
          })
        : null,
    ).toEqual({
      through: '2026-08-09T00:00:00.000Z',
      throughMessageId: 'older',
    });
    expect(
      pageBoundary
        ? newestVisibleMessageBoundary([pageBoundary], {
            excludeNewestTimestamp: true,
          })
        : null,
    ).toBeNull();
  });
});

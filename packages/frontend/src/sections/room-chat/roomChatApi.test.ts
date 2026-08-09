import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ackRequest,
  cancelAckRequestById,
  createPrivateGroupRoom,
  deleteChatMessage,
  downloadMessageAttachment,
  fetchAckCandidates,
  fetchChatThread,
  fetchMentionCandidates,
  fetchRoomMessages,
  isDefiniteChatRequestFailure,
  isUnavailableChatRequestFailure,
  markRoomRead,
  patchRoomNotificationSetting,
  postMessageReaction,
  postRoomAckRequest,
  postRoomMessage,
  postThreadReply,
  previewRoomAckTargets,
  revokeAckRequest,
  searchChatMessages,
} from './roomChatApi';

const { api, apiResponse } = vi.hoisted(() => ({
  api: vi.fn(),
  apiResponse: vi.fn(),
}));

vi.mock('../../api', () => ({ api, apiResponse }));

function message(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    roomId: 'room-1',
    messageType: 'text',
    parentMessageId: null,
    threadRootId: null,
    userId: 'alice',
    body: `${id} body`,
    tags: [],
    mentions: null,
    mentionsAll: false,
    ackRequest: null,
    attachments: [],
    createdAt: '2026-03-28T00:00:00.000Z',
    deletedAt: null,
    deletedReason: null,
    ...extra,
  };
}

function ackRequestResponse(
  messageId = 'm2',
  extra: Record<string, unknown> = {},
) {
  return {
    id: 'ack-1',
    messageId,
    roomId: 'room-1',
    requiredUserIds: ['u1'],
    dueAt: null,
    canceledAt: null,
    canceledBy: null,
    acks: [
      {
        id: 'ack-row-1',
        requestId: 'ack-1',
        userId: 'u1',
        ackedAt: '2026-03-28T00:01:00.000Z',
      },
    ],
    ...extra,
  };
}

describe('roomChatApi command boundaries', () => {
  beforeEach(() => {
    api.mockReset();
    apiResponse.mockReset();
  });

  it('sanitizes shared API failures at the chat boundary', async () => {
    api.mockRejectedValueOnce(
      new Error(
        'Request failed: /chat-messages/private/thread (503) providerKey=secret',
      ),
    );

    const error = await fetchChatThread('private', { limit: 50 }).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Chat request failed');
    expect((error as Error).message).not.toMatch(/private|providerKey|secret/);
  });

  it('normalizes attachment 403/404 responses without reading raw bodies', async () => {
    apiResponse.mockResolvedValueOnce(
      new Response('providerKey=must-not-be-read', { status: 403 }),
    );

    const error = await downloadMessageAttachment('attachment-1').catch(
      (reason: unknown) => reason,
    );

    expect(isUnavailableChatRequestFailure(error)).toBe(true);
    expect(String(error)).toBe('ChatRequestError: Chat request failed');
    expect(String(error)).not.toContain('providerKey');
  });

  it('allowlists bounded ack preview fields and rejects malformed known values', async () => {
    api
      .mockResolvedValueOnce({
        resolvedUserIds: Array.from({ length: 50 }, (_, index) => `u${index}`),
        resolvedCount: 55,
        exceedsLimit: true,
        invalidUserIds: Array.from(
          { length: 20 },
          (_, index) => `invalid-${index}`,
        ),
        reason: 'internal_reason',
        providerUrl: 'https://internal.invalid',
      })
      .mockResolvedValueOnce({
        resolvedUserIds: Array.from({ length: 51 }, (_, index) => `u${index}`),
        resolvedCount: 51,
        exceedsLimit: true,
        invalidUserIds: [],
      })
      .mockResolvedValueOnce({
        resolvedUserIds: ['u1'],
        resolvedCount: '1',
        exceedsLimit: false,
        invalidUserIds: [],
      });

    await expect(
      previewRoomAckTargets('room-1', {
        requiredUserIds: ['u1'],
        requiredGroupIds: [],
        requiredRoles: [],
      }),
    ).resolves.toEqual({
      resolvedUserIds: Array.from({ length: 50 }, (_, index) => `u${index}`),
      resolvedCount: 55,
      exceedsLimit: true,
      invalidUserIds: Array.from(
        { length: 20 },
        (_, index) => `invalid-${index}`,
      ),
    });
    await expect(
      previewRoomAckTargets('room-1', {
        requiredUserIds: ['u1'],
        requiredGroupIds: [],
        requiredRoles: [],
      }),
    ).rejects.toThrow('Invalid ack preview response');
    await expect(
      previewRoomAckTargets('room-1', {
        requiredUserIds: ['u1'],
        requiredGroupIds: [],
        requiredRoles: [],
      }),
    ).rejects.toThrow('Invalid ack preview response');
  });

  it('classifies only definite 4xx chat request failures as retry-safe', async () => {
    api
      .mockRejectedValueOnce(
        new Error('Request failed: /chat-rooms/room-1/ack-requests (400) body'),
      )
      .mockRejectedValueOnce(
        new Error('Request failed: /chat-messages/root-1/replies (503) body'),
      )
      .mockRejectedValueOnce(
        new Error('Request failed: /chat-messages/root-1/thread (404) body'),
      );

    const definite = await postRoomAckRequest('room-1', {
      body: 'ack me',
      requiredUserIds: ['u1'],
    }).catch((reason: unknown) => reason);
    const uncertain = await postThreadReply(
      { rootMessageId: 'root-1', roomId: 'room-1' },
      { body: 'reply' },
    ).catch((reason: unknown) => reason);
    const unavailable = await fetchChatThread('root-1', { limit: 50 }).catch(
      (reason: unknown) => reason,
    );

    expect(definite).toBeInstanceOf(Error);
    expect((definite as Error).message).toBe('Chat request failed');
    expect(isDefiniteChatRequestFailure(definite)).toBe(true);
    expect(isUnavailableChatRequestFailure(definite)).toBe(false);
    expect(uncertain).toBeInstanceOf(Error);
    expect((uncertain as Error).message).toBe('Chat request failed');
    expect(isDefiniteChatRequestFailure(uncertain)).toBe(false);
    expect(isUnavailableChatRequestFailure(uncertain)).toBe(false);
    expect(unavailable).toBeInstanceOf(Error);
    expect((unavailable as Error).message).toBe('Chat request failed');
    expect(isDefiniteChatRequestFailure(unavailable)).toBe(true);
    expect(isUnavailableChatRequestFailure(unavailable)).toBe(true);
  });

  it('builds message query keys from room, pagination, filter, and search inputs', async () => {
    api.mockResolvedValueOnce({ items: [message('m1')] });

    await expect(
      fetchRoomMessages('room-1', {
        limit: 50,
        before: '2026-03-28T00:00:00.000Z',
        query: 'beta',
        tag: 'urgent',
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'm1',
        deleted: false,
        parentMessageId: null,
        threadRootId: null,
      }),
    ]);

    expect(api).toHaveBeenCalledWith(
      '/chat-rooms/room-1/messages?limit=50&before=2026-03-28T00%3A00%3A00.000Z&tag=urgent&q=beta',
    );
  });

  it('rejects a room timeline response with an explicitly malformed thread topology', async () => {
    api.mockResolvedValueOnce({
      items: [
        {
          ...message('malformed-root'),
          parentMessageId: 1,
          threadRootId: 1,
        },
      ],
    });

    await expect(fetchRoomMessages('room-1', { limit: 50 })).rejects.toThrow(
      'Invalid room message response',
    );
  });

  it('keeps message, ack, reaction, preview, room, and notification mutations behind commands', async () => {
    api
      .mockResolvedValueOnce(message('m1'))
      .mockResolvedValueOnce(
        message('m2', { ackRequest: ackRequestResponse('m2') }),
      )
      .mockResolvedValueOnce(message('m1', { reactions: { '👍': 1 } }))
      .mockResolvedValueOnce(ackRequestResponse())
      .mockResolvedValueOnce({
        resolvedUserIds: ['u1'],
        resolvedCount: 1,
        exceedsLimit: false,
        invalidUserIds: [],
        providerKey: 'must-be-discarded',
        diagnostics: { internal: true },
      })
      .mockResolvedValueOnce({ id: 'room-2' })
      .mockResolvedValueOnce({ notifyAllPosts: false, notifyMentions: true });

    await postRoomMessage('room-1', { body: 'hello', tags: ['daily'] });
    await postRoomAckRequest('room-1', {
      body: 'ack me',
      requiredUserIds: ['u1'],
    });
    await postMessageReaction(
      {
        id: 'm1',
        roomId: 'room-1',
        parentMessageId: null,
        threadRootId: null,
      },
      '👍',
    );
    await ackRequest({
      requestId: 'ack-1',
      messageId: 'm2',
      roomId: 'room-1',
    });
    const preview = await previewRoomAckTargets('room-1', {
      requiredUserIds: ['u1'],
      requiredGroupIds: [],
      requiredRoles: [],
    });
    expect(preview).toEqual({
      resolvedUserIds: ['u1'],
      resolvedCount: 1,
      exceedsLimit: false,
      invalidUserIds: [],
    });
    await createPrivateGroupRoom({ name: 'Team', memberUserIds: ['u1'] });
    await patchRoomNotificationSetting('room-1', {
      notifyAllPosts: false,
      notifyMentions: true,
      muteUntil: null,
    });

    expect(api.mock.calls.map((call) => call[0])).toEqual([
      '/chat-rooms/room-1/messages',
      '/chat-rooms/room-1/ack-requests',
      '/chat-messages/m1/reactions',
      '/chat-ack-requests/ack-1/ack',
      '/chat-rooms/room-1/ack-requests/preview',
      '/chat-rooms',
      '/chat-rooms/room-1/notification-setting',
    ]);
    expect(api.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(api.mock.calls[0]?.[1]?.body))).toEqual({
      body: 'hello',
      tags: ['daily'],
    });
    expect(JSON.parse(String(api.mock.calls[1]?.[1]?.body))).toEqual({
      body: 'ack me',
      requiredUserIds: ['u1'],
    });
    expect(JSON.parse(String(api.mock.calls[2]?.[1]?.body))).toEqual({
      emoji: '👍',
    });
    expect(JSON.parse(String(api.mock.calls[5]?.[1]?.body))).toEqual({
      type: 'private_group',
      name: 'Team',
      memberUserIds: ['u1'],
    });
    expect(JSON.parse(String(api.mock.calls[6]?.[1]?.body))).toEqual({
      notifyAllPosts: false,
      notifyMentions: true,
      muteUntil: null,
    });
  });

  it('rejects wrong-room and reply rows from the root timeline', async () => {
    api
      .mockResolvedValueOnce({
        items: [message('wrong-room', { roomId: 'room-2' })],
      })
      .mockResolvedValueOnce({
        items: [
          message('reply-1', {
            parentMessageId: 'root-1',
            threadRootId: 'root-1',
          }),
        ],
      });

    await expect(fetchRoomMessages('room-1', { limit: 50 })).rejects.toThrow(
      'Invalid room message response',
    );
    await expect(fetchRoomMessages('room-1', { limit: 50 })).rejects.toThrow(
      'Invalid room message response',
    );
  });

  it('binds post, reaction, and ack responses to their requested identity', async () => {
    api
      .mockResolvedValueOnce(message('wrong-room', { roomId: 'room-2' }))
      .mockResolvedValueOnce(
        message('wrong-reply', {
          parentMessageId: 'other-root',
          threadRootId: 'other-root',
        }),
      )
      .mockResolvedValueOnce(message('other-message'))
      .mockResolvedValueOnce(ackRequestResponse('other-message'));

    await expect(postRoomMessage('room-1', { body: 'root' })).rejects.toThrow(
      'Invalid posted chat message response',
    );
    await expect(
      postRoomAckRequest('room-1', {
        body: 'reply',
        parentMessageId: 'root-1',
      }),
    ).rejects.toThrow('Invalid posted chat message response');
    await expect(
      postMessageReaction(
        {
          id: 'expected-message',
          roomId: 'room-1',
          parentMessageId: null,
          threadRootId: null,
        },
        '👍',
      ),
    ).rejects.toThrow('Invalid chat reaction response');
    await expect(
      ackRequest({
        requestId: 'ack-1',
        messageId: 'm2',
        roomId: 'room-1',
      }),
    ).rejects.toThrow('Invalid chat ack response');
  });

  it('rejects standalone ACK mutations when any expected relation mismatches', async () => {
    const expected = {
      requestId: 'ack-1',
      messageId: 'm2',
      roomId: 'room-1',
    };
    api
      .mockResolvedValueOnce(ackRequestResponse('m2', { id: 'other-ack' }))
      .mockResolvedValueOnce(ackRequestResponse('other-message'))
      .mockResolvedValueOnce(ackRequestResponse('m2', { roomId: 'room-2' }));

    await expect(ackRequest(expected)).rejects.toThrow(
      'Invalid chat ack response',
    );
    await expect(revokeAckRequest(expected)).rejects.toThrow(
      'Invalid chat ack response',
    );
    await expect(
      cancelAckRequestById(expected, 'no longer needed'),
    ).rejects.toThrow('Invalid chat ack response');

    expect(api.mock.calls.map((call) => call[0])).toEqual([
      '/chat-ack-requests/ack-1/ack',
      '/chat-ack-requests/ack-1/revoke',
      '/chat-ack-requests/ack-1/cancel',
    ]);
  });

  it('maps only the known warning code to a frontend-owned fixed message', async () => {
    api
      .mockResolvedValueOnce({
        ...message('m1'),
        warning: {
          code: 'POST_WITHOUT_VIEW',
          message: 'providerKey=secret https://internal.invalid',
        },
      })
      .mockResolvedValueOnce({
        ...message('m2'),
        warning: {
          code: 'UNKNOWN_INTERNAL_WARNING',
          message: 'providerKey=secret https://internal.invalid',
        },
      });

    await expect(postRoomMessage('room-1', { body: 'known' })).resolves.toEqual(
      expect.objectContaining({
        warning: {
          code: 'POST_WITHOUT_VIEW',
          message:
            '投稿後、このルームを閲覧できません。閲覧権限を管理者に確認してください。',
        },
      }),
    );
    const unknown = await postRoomMessage('room-1', { body: 'unknown' });
    expect(unknown).not.toHaveProperty('warning');
    expect(JSON.stringify(unknown)).not.toMatch(
      /providerKey|internal\.invalid|secret/,
    );
  });

  it('allowlists thread warnings while binding the expected room and root', async () => {
    const reply = (id: string, extra: Record<string, unknown> = {}) =>
      message(id, {
        parentMessageId: 'root-1',
        threadRootId: 'root-1',
        ...extra,
      });
    api
      .mockResolvedValueOnce({
        ...reply('known-reply'),
        warning: {
          code: 'POST_WITHOUT_VIEW',
          message: 'providerKey=secret https://internal.invalid',
        },
      })
      .mockResolvedValueOnce({
        ...reply('unknown-reply'),
        warning: {
          code: 'UNKNOWN_INTERNAL_WARNING',
          message: 'providerKey=secret https://internal.invalid',
        },
      })
      .mockResolvedValueOnce(reply('wrong-room', { roomId: 'room-2' }))
      .mockResolvedValueOnce(
        reply('wrong-root', {
          parentMessageId: 'other-root',
          threadRootId: 'other-root',
        }),
      );

    await expect(
      postThreadReply(
        { rootMessageId: 'root-1', roomId: 'room-1' },
        { body: 'known' },
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        warning: {
          code: 'POST_WITHOUT_VIEW',
          message:
            '投稿後、このルームを閲覧できません。閲覧権限を管理者に確認してください。',
        },
      }),
    );
    const unknown = await postThreadReply(
      { rootMessageId: 'root-1', roomId: 'room-1' },
      { body: 'unknown' },
    );
    expect(unknown).not.toHaveProperty('warning');
    expect(JSON.stringify(unknown)).not.toMatch(
      /providerKey|internal\.invalid|secret/,
    );
    await expect(
      postThreadReply(
        { rootMessageId: 'root-1', roomId: 'room-1' },
        { body: 'wrong room' },
      ),
    ).rejects.toThrow('Invalid thread reply response');
    await expect(
      postThreadReply(
        { rootMessageId: 'root-1', roomId: 'room-1' },
        { body: 'wrong root' },
      ),
    ).rejects.toThrow('Invalid thread reply response');
  });

  it('allowlists mention and ACK candidate response fields and entries', async () => {
    const rawCandidates = {
      users: [
        { userId: ' alice ', displayName: ' Alice ', providerToken: 'hidden' },
        { userId: '', displayName: 'malformed' },
      ],
      groups: [
        { groupId: ' group-1 ', displayName: ' Group 1 ', rawAcl: 'hidden' },
        { groupId: 'bad-group', displayName: { raw: 'hidden' } },
      ],
      allowAll: true,
      providerCursor: 'hidden',
    };
    api.mockResolvedValueOnce(rawCandidates).mockResolvedValueOnce({
      ...rawCandidates,
      allowAll: 'yes',
    });

    await expect(fetchMentionCandidates('room-1')).resolves.toEqual({
      users: [{ userId: 'alice', displayName: 'Alice' }],
      groups: [{ groupId: 'group-1', displayName: 'Group 1' }],
      allowAll: true,
    });
    const ackCandidates = await fetchAckCandidates('room-1', 'al');
    expect(ackCandidates).toEqual({
      users: [{ userId: 'alice', displayName: 'Alice' }],
      groups: [{ groupId: 'group-1', displayName: 'Group 1' }],
    });
    expect(JSON.stringify(ackCandidates)).not.toMatch(
      /providerToken|providerCursor|rawAcl|bad-group/,
    );
  });

  it('uses bounded thread, reply, delete, read, and search contracts', async () => {
    const root = message('root-1', {
      replyCount: 1,
      lastReplyAt: '2026-08-09T00:01:00.000Z',
    });
    const reply = message('reply-1', {
      parentMessageId: 'root-1',
      threadRootId: 'root-1',
      createdAt: '2026-08-09T00:01:00.000Z',
    });
    const searchRoom = {
      id: 'room-1',
      type: 'project',
      name: 'Project room',
      providerUrl: 'https://internal.invalid',
    };
    api
      .mockResolvedValueOnce({
        root,
        replies: [reply],
        replyCount: 1,
        lastReplyAt: '2026-08-09T00:01:00.000Z',
        nextCursor: 'opaque',
        providerKey: 'hidden',
      })
      .mockResolvedValueOnce(reply)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        items: [{ ...reply, room: searchRoom, rawError: 'hidden' }],
        nextBefore: '2026-08-09T00:01:00.000Z',
        nextBeforeId: 'reply-1',
      });

    await expect(
      fetchChatThread('reply-1', { limit: 50, cursor: 'cursor-1' }),
    ).resolves.toEqual(
      expect.objectContaining({ replyCount: 1, nextCursor: 'opaque' }),
    );
    await expect(
      postThreadReply(
        { rootMessageId: 'root-1', roomId: 'room-1' },
        { body: 'reply body' },
      ),
    ).resolves.toEqual(expect.objectContaining({ id: 'reply-1' }));
    await deleteChatMessage('reply-1', 'user_retract');
    await markRoomRead('room-1', {
      through: '2026-08-09T00:01:00.000Z',
      throughMessageId: 'reply-1',
    });
    const search = await searchChatMessages({
      query: 'reply',
      before: '2026-08-09T00:01:00.000Z',
      beforeId: 'reply-1',
      limit: 50,
    });

    expect(search.items[0]).not.toHaveProperty('rawError');
    expect(search.items[0]?.room).not.toHaveProperty('providerUrl');
    expect(api.mock.calls.map((call) => call[0])).toEqual([
      '/chat-messages/reply-1/thread?limit=50&cursor=cursor-1',
      '/chat-messages/root-1/replies',
      '/chat-messages/reply-1',
      '/chat-rooms/room-1/read',
      '/chat-messages/search?q=reply&limit=50&before=2026-08-09T00%3A01%3A00.000Z&beforeId=reply-1',
    ]);
    expect(JSON.parse(String(api.mock.calls[1]?.[1]?.body))).toEqual({
      body: 'reply body',
    });
    expect(JSON.parse(String(api.mock.calls[2]?.[1]?.body))).toEqual({
      reason: 'user_retract',
    });
    expect(JSON.parse(String(api.mock.calls[3]?.[1]?.body))).toEqual({
      through: '2026-08-09T00:01:00.000Z',
      throughMessageId: 'reply-1',
    });
  });
});

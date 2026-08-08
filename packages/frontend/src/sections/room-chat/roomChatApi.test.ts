import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ackRequest,
  createPrivateGroupRoom,
  deleteChatMessage,
  fetchChatThread,
  fetchRoomMessages,
  markRoomRead,
  patchRoomNotificationSetting,
  postMessageReaction,
  postRoomAckRequest,
  postRoomMessage,
  postThreadReply,
  previewRoomAckTargets,
  searchChatMessages,
} from './roomChatApi';

const { api } = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock('../../api', () => ({ api, apiResponse: vi.fn() }));

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

describe('roomChatApi command boundaries', () => {
  beforeEach(() => {
    api.mockReset();
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

  it('keeps message, ack, reaction, preview, room, and notification mutations behind commands', async () => {
    api
      .mockResolvedValueOnce(message('m1'))
      .mockResolvedValueOnce(message('m2', { ackRequest: { id: 'ack-1' } }))
      .mockResolvedValueOnce(message('m1', { reactions: { '👍': 1 } }))
      .mockResolvedValueOnce({ id: 'ack-1' })
      .mockResolvedValueOnce({ resolvedUserIds: ['u1'], resolvedCount: 1 })
      .mockResolvedValueOnce({ id: 'room-2' })
      .mockResolvedValueOnce({ notifyAllPosts: false, notifyMentions: true });

    await postRoomMessage('room-1', { body: 'hello', tags: ['daily'] });
    await postRoomAckRequest('room-1', {
      body: 'ack me',
      requiredUserIds: ['u1'],
    });
    await postMessageReaction('m1', '👍');
    await ackRequest('ack-1');
    await previewRoomAckTargets('room-1', {
      requiredUserIds: ['u1'],
      requiredGroupIds: [],
      requiredRoles: [],
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
      postThreadReply('root-1', { body: 'reply body' }),
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

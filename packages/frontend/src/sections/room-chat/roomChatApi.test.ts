import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ackRequest,
  createPrivateGroupRoom,
  fetchRoomMessages,
  patchRoomNotificationSetting,
  postMessageReaction,
  postRoomAckRequest,
  postRoomMessage,
  previewRoomAckTargets,
} from './roomChatApi';

const { api } = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock('../../api', () => ({ api, apiResponse: vi.fn() }));

describe('roomChatApi command boundaries', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('builds message query keys from room, pagination, filter, and search inputs', async () => {
    api.mockResolvedValueOnce({ items: [{ id: 'm1' }] });

    await expect(
      fetchRoomMessages('room-1', {
        limit: 50,
        before: '2026-03-28T00:00:00.000Z',
        query: 'beta',
        tag: 'urgent',
      }),
    ).resolves.toEqual([{ id: 'm1' }]);

    expect(api).toHaveBeenCalledWith(
      '/chat-rooms/room-1/messages?limit=50&before=2026-03-28T00%3A00%3A00.000Z&tag=urgent&q=beta',
    );
  });

  it('keeps message, ack, reaction, preview, room, and notification mutations behind commands', async () => {
    api
      .mockResolvedValueOnce({ id: 'm1' })
      .mockResolvedValueOnce({ id: 'm2' })
      .mockResolvedValueOnce({ id: 'm1', reactions: { '👍': 1 } })
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
});

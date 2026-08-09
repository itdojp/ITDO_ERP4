import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useRoomChatAckCandidates,
  useRoomChatMentionCandidates,
} from './useRoomChatCandidates';
import { useRoomChatAckPreview } from './useRoomChatAckPreview';
import { useRoomChatNotificationSetting } from './useRoomChatNotificationSetting';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('../../api', () => ({ api }));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe('room-bound ancillary chat state', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('does not restore mention candidates after access purge', async () => {
    const pending = deferred<{
      users: Array<{ userId: string; displayName: string }>;
    }>();
    api.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useRoomChatMentionCandidates('room-1'));
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.clearMentionCandidates();
    });
    pending.resolve({
      users: [{ userId: 'private-user', displayName: 'Private User' }],
    });
    await act(async () => {
      await pending.promise;
    });

    expect(result.current.mentionCandidates).toEqual({});
  });

  it('revalidates room access when mention candidates become unavailable', async () => {
    api.mockRejectedValueOnce(
      new Error('Request failed (403) private-mention-detail'),
    );
    const onAccessUnavailable = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() =>
      useRoomChatMentionCandidates('room-1', onAccessUnavailable),
    );

    await waitFor(() =>
      expect(onAccessUnavailable).toHaveBeenCalledWith('room-1'),
    );
    expect(result.current.mentionCandidates).toEqual({});
  });

  it('does not reuse local group candidates after remote access loss', async () => {
    api
      .mockResolvedValueOnce({
        groups: [{ groupId: 'private-group', displayName: 'Private Group' }],
      })
      .mockRejectedValueOnce(
        new Error('Request failed (404) private-group-detail'),
      );
    const onAccessUnavailable = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() =>
      useRoomChatMentionCandidates('room-1', onAccessUnavailable),
    );
    await waitFor(() =>
      expect(result.current.mentionCandidates.groups).toHaveLength(1),
    );

    let candidates: Awaited<
      ReturnType<typeof result.current.fetchMentionComposerCandidates>
    > = [];
    await act(async () => {
      candidates = await result.current.fetchMentionComposerCandidates(
        'private',
        'group',
      );
    });

    expect(onAccessUnavailable).toHaveBeenCalledWith('room-1');
    expect(candidates).toEqual([]);
    expect(result.current.mentionCandidates).toEqual({});
  });

  it('does not restore ACK candidates after access purge', async () => {
    const pending = deferred<{
      groups: Array<{ groupId: string; displayName: string }>;
    }>();
    api.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useRoomChatAckCandidates('room-1'));
    act(() => {
      result.current.setAckCandidateQuery('private group');
    });
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1), {
      timeout: 1_000,
    });

    act(() => {
      result.current.clearAckCandidates();
    });
    pending.resolve({
      groups: [{ groupId: 'private-group', displayName: 'Private Group' }],
    });
    await act(async () => {
      await pending.promise;
    });

    expect(result.current.ackCandidates).toEqual({});
    expect(result.current.ackCandidateQuery).toBe('');
  });

  it('revalidates room access when ACK candidates become unavailable', async () => {
    api.mockRejectedValueOnce(
      new Error('Request failed (403) private-ack-candidate-detail'),
    );
    const onAccessUnavailable = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() =>
      useRoomChatAckCandidates('room-1', onAccessUnavailable),
    );
    act(() => {
      result.current.setAckCandidateQuery('private group');
    });

    await waitFor(
      () => expect(onAccessUnavailable).toHaveBeenCalledWith('room-1'),
      { timeout: 1_000 },
    );
    await waitFor(() => {
      expect(result.current.ackCandidates).toEqual({});
      expect(result.current.ackCandidateQuery).toBe('');
    });
  });

  it('does not restore notification settings after access purge', async () => {
    const pending = deferred<{
      notifyAllPosts: boolean;
      notifyMentions: boolean;
      muteUntil: string | null;
    }>();
    api.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() =>
      useRoomChatNotificationSetting({ roomId: 'room-1' }),
    );

    const request = result.current.loadNotificationSetting('room-1');
    await waitFor(() =>
      expect(result.current.isNotificationSettingLoading).toBe(true),
    );
    act(() => {
      result.current.clearNotificationSetting('room-1');
    });
    pending.resolve({
      notifyAllPosts: true,
      notifyMentions: true,
      muteUntil: '2026-08-09T12:00:00.000Z',
    });
    await act(async () => {
      await request;
    });

    expect(result.current.notificationSetting).toBeNull();
    expect(result.current.muteUntilInput).toBe('');
    expect(result.current.isNotificationSettingLoading).toBe(false);
  });

  it('revalidates and clears notification settings after access loss', async () => {
    api
      .mockResolvedValueOnce({
        notifyAllPosts: true,
        notifyMentions: true,
        muteUntil: null,
      })
      .mockRejectedValueOnce(
        new Error('Request failed (403) private-notification-detail'),
      );
    const onAccessUnavailable = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() =>
      useRoomChatNotificationSetting({
        roomId: 'room-1',
        onAccessUnavailable,
      }),
    );
    await act(async () => {
      await result.current.loadNotificationSetting('room-1');
    });
    expect(result.current.notificationSetting).not.toBeNull();

    await act(async () => {
      await result.current.saveNotificationSetting();
    });

    expect(onAccessUnavailable).toHaveBeenCalledWith('room-1');
    expect(result.current.notificationSetting).toBeNull();
    expect(result.current.muteUntilInput).toBe('');
    expect(result.current.notificationSettingMessage).toBe('');
  });

  it('does not restore an ACK preview after access purge', async () => {
    const pending = deferred<{
      resolvedUserIds: string[];
      resolvedCount: number;
      exceedsLimit: boolean;
      invalidUserIds: string[];
    }>();
    api.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() =>
      useRoomChatAckPreview({
        roomId: 'room-1',
        requiredUserIds: ['synthetic-user'],
        requiredGroupIds: [],
        requiredRoles: [],
        onAccessUnavailable: vi.fn().mockResolvedValue(false),
      }),
    );

    const request = result.current.previewAckTargets();
    await waitFor(() => expect(result.current.ackPreviewLoading).toBe(true));
    act(() => {
      result.current.clearAckPreview('room-1');
    });
    pending.resolve({
      resolvedUserIds: ['private-user'],
      resolvedCount: 1,
      exceedsLimit: false,
      invalidUserIds: [],
    });
    await act(async () => {
      await request;
    });

    expect(result.current.ackPreview).toBeNull();
    expect(result.current.ackPreviewMessage).toBe('');
    expect(result.current.ackPreviewLoading).toBe(false);
  });

  it('revalidates unavailable ACK preview access without exposing raw errors', async () => {
    api.mockRejectedValueOnce(
      new Error('Request failed (403) private-ack-preview-detail'),
    );
    const onAccessUnavailable = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() =>
      useRoomChatAckPreview({
        roomId: 'room-1',
        requiredUserIds: ['synthetic-user'],
        requiredGroupIds: [],
        requiredRoles: [],
        onAccessUnavailable,
      }),
    );

    await act(async () => {
      await result.current.previewAckTargets();
    });
    expect(onAccessUnavailable).toHaveBeenCalledWith('room-1');
    expect(result.current.ackPreview).toBeNull();
    expect(result.current.ackPreviewMessage).toBe('');
  });
});

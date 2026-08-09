import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomChatMessages } from './useRoomChatMessages';

const { api } = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock('../../api', () => ({ api }));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function message(
  id: string,
  roomId: string,
  createdAt = '2026-03-28T00:00:00.000Z',
) {
  return {
    id,
    roomId,
    messageType: 'text' as const,
    parentMessageId: null,
    threadRootId: null,
    userId: 'alice',
    body: `${id} body`,
    tags: [],
    mentions: null,
    mentionsAll: false,
    ackRequest: null,
    attachments: [],
    createdAt,
    deleted: false,
    deletedAt: null,
    deletedReason: null,
  };
}

describe('useRoomChatMessages', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | undefined;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    api.mockReset();
    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleWarnSpy?.mockRestore();
  });

  it('loads messages, unread state, and marks the selected room as read', async () => {
    api.mockImplementation(async (path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.pathname === '/chat-rooms/room-1/messages') {
        expect(url.searchParams.get('limit')).toBe('50');
        expect(url.searchParams.get('q')).toBe('alpha');
        expect(url.searchParams.get('tag')).toBe('urgent');
        return { items: [message('m1', 'room-1')] };
      }
      if (url.pathname === '/chat-rooms/room-1/unread') {
        return {
          unreadCount: 3,
          lastReadAt: '2026-03-27T00:00:00.000Z',
        };
      }
      if (url.pathname === '/chat-rooms/room-1/read' && method === 'POST') {
        return {};
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    const { result } = renderHook(() =>
      useRoomChatMessages({
        roomId: 'room-1',
        filterQuery: 'alpha',
        filterTag: 'urgent',
      }),
    );

    await act(async () => {
      await result.current.loadMessages();
    });

    expect(result.current.items).toEqual([message('m1', 'room-1')]);
    expect(result.current.unreadCount).toBe(3);
    expect(result.current.highlightSince?.toISOString()).toBe(
      '2026-03-27T00:00:00.000Z',
    );
    expect(result.current.message).toBe('');
    expect(api).toHaveBeenCalledWith('/chat-rooms/room-1/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        through: '2026-03-28T00:00:00.000Z',
        throughMessageId: 'm1',
      }),
    });
  });

  it('validates short filter queries before issuing a message request', async () => {
    const { result } = renderHook(() =>
      useRoomChatMessages({
        roomId: 'room-1',
        filterQuery: 'a',
        filterTag: '',
      }),
    );

    await act(async () => {
      await result.current.loadMessages();
    });

    expect(result.current.message).toBe('検索語は2文字以上で入力してください');
    expect(result.current.hasMore).toBe(false);
    expect(api).not.toHaveBeenCalled();
  });

  it('does not advance the read boundary when no message was displayed', async () => {
    api.mockImplementation(async (path: string) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname.endsWith('/messages')) return { items: [] };
      if (url.pathname.endsWith('/unread')) {
        return { unreadCount: 2, lastReadAt: null };
      }
      throw new Error(`Unhandled api path: ${path}`);
    });
    const { result } = renderHook(() =>
      useRoomChatMessages({ roomId: 'room-1', filterQuery: '', filterTag: '' }),
    );

    await act(async () => {
      await result.current.loadMessages();
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.unreadCount).toBe(2);
    expect(
      api.mock.calls.some(([path]) => String(path).endsWith('/read')),
    ).toBe(false);
  });

  it('does not guess a read boundary from same-millisecond random IDs', async () => {
    api.mockImplementation(async (path: string) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname.endsWith('/messages')) {
        return {
          items: [
            message('z-random-id', 'room-1'),
            message('a-random-id', 'room-1'),
          ],
        };
      }
      if (url.pathname.endsWith('/unread')) {
        return { unreadCount: 2, lastReadAt: null };
      }
      throw new Error(`Unhandled api path: ${path}`);
    });
    const { result } = renderHook(() =>
      useRoomChatMessages({ roomId: 'room-1', filterQuery: '', filterTag: '' }),
    );

    await act(async () => {
      await result.current.loadMessages();
    });

    expect(result.current.items).toHaveLength(2);
    expect(
      api.mock.calls.some(([path]) => String(path).endsWith('/read')),
    ).toBe(false);
  });

  it('does not let a stale room response overwrite the current room messages', async () => {
    const room1 = deferred<{ items: ReturnType<typeof message>[] }>();
    const room2 = deferred<{ items: ReturnType<typeof message>[] }>();
    api.mockImplementation((path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url.pathname === '/chat-rooms/room-1/messages') return room1.promise;
      if (url.pathname === '/chat-rooms/room-2/messages') return room2.promise;
      if (url.pathname.endsWith('/unread')) {
        return Promise.resolve({ unreadCount: 0, lastReadAt: null });
      }
      if (url.pathname.endsWith('/read') && method === 'POST') {
        return Promise.resolve({});
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    const { result, rerender } = renderHook(
      ({ roomId }) =>
        useRoomChatMessages({ roomId, filterQuery: '', filterTag: '' }),
      { initialProps: { roomId: 'room-1' } },
    );

    const firstLoad = result.current.loadMessages();
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1));

    rerender({ roomId: 'room-2' });
    const secondLoad = result.current.loadMessages();
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));

    room2.resolve({ items: [message('m2', 'room-2')] });
    await act(async () => {
      await secondLoad;
    });
    expect(result.current.items).toEqual([message('m2', 'room-2')]);

    room1.resolve({ items: [message('m1', 'room-1')] });
    await act(async () => {
      await firstLoad;
    });
    expect(result.current.items).toEqual([message('m2', 'room-2')]);
  });

  it('ignores a loadMessages reference captured before the room changed', async () => {
    const { result, rerender } = renderHook(
      ({ roomId }) =>
        useRoomChatMessages({ roomId, filterQuery: '', filterTag: '' }),
      { initialProps: { roomId: 'room-1' } },
    );
    const staleLoadMessages = result.current.loadMessages;

    rerender({ roomId: 'room-2' });
    act(() => {
      result.current.setItems([message('m2', 'room-2')]);
    });

    await act(async () => {
      await staleLoadMessages();
    });

    expect(api).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([message('m2', 'room-2')]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isLoadingMore).toBe(false);
  });

  it('keeps the newest unread response when same-room requests complete out of order', async () => {
    const older = deferred<{
      unreadCount: number;
      lastReadAt: string | null;
    }>();
    const newer = deferred<{
      unreadCount: number;
      lastReadAt: string | null;
    }>();
    let unreadCalls = 0;
    api.mockImplementation((path: string) => {
      const url = new URL(path, 'http://localhost');
      if (!url.pathname.endsWith('/unread')) {
        throw new Error(`Unhandled api path: ${path}`);
      }
      unreadCalls += 1;
      return unreadCalls === 1 ? older.promise : newer.promise;
    });
    const { result } = renderHook(() =>
      useRoomChatMessages({ roomId: 'room-1', filterQuery: '', filterTag: '' }),
    );

    const olderRequest = result.current.refreshUnreadState('room-1');
    const newerRequest = result.current.refreshUnreadState('room-1');
    newer.resolve({ unreadCount: 0, lastReadAt: '2026-03-28T00:00:00.000Z' });
    await act(async () => {
      await newerRequest;
    });
    expect(result.current.unreadCount).toBe(0);

    older.resolve({ unreadCount: 5, lastReadAt: null });
    await act(async () => {
      await olderRequest;
    });
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.highlightSince?.toISOString()).toBe(
      '2026-03-28T00:00:00.000Z',
    );
  });

  it('aborts and invalidates an in-flight message request on unmount', async () => {
    const pending = deferred<{ items: ReturnType<typeof message>[] }>();
    let signal: AbortSignal | undefined;
    api.mockImplementation((path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname.endsWith('/messages')) {
        signal = init?.signal ?? undefined;
        return pending.promise;
      }
      throw new Error(`Unexpected post-unmount request: ${path}`);
    });
    const { result, unmount } = renderHook(() =>
      useRoomChatMessages({ roomId: 'room-1', filterQuery: '', filterTag: '' }),
    );

    const load = result.current.loadMessages();
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);

    pending.resolve({ items: [message('stale', 'room-1')] });
    await act(async () => {
      await load;
    });
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('purges visible room state and prevents an in-flight response from restoring revoked content', async () => {
    const pending = deferred<{ items: ReturnType<typeof message>[] }>();
    let signal: AbortSignal | undefined;
    api.mockImplementation((path: string, init?: RequestInit) => {
      const url = new URL(path, 'http://localhost');
      if (url.pathname.endsWith('/messages')) {
        signal = init?.signal ?? undefined;
        return pending.promise;
      }
      throw new Error(`Unexpected post-purge request: ${path}`);
    });
    const { result } = renderHook(() =>
      useRoomChatMessages({ roomId: 'room-1', filterQuery: '', filterTag: '' }),
    );
    act(() => {
      result.current.setItems([message('visible-before-revoke', 'room-1')]);
    });
    const load = result.current.loadMessages();
    await waitFor(() => expect(signal).toBeDefined());

    act(() => {
      expect(
        result.current.purgeRoomState(
          'room-1',
          '閲覧権限を管理者に確認してください。',
        ),
      ).toBe(true);
    });
    expect(signal?.aborted).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.highlightSince).toBeNull();
    expect(result.current.message).toBe('閲覧権限を管理者に確認してください。');

    pending.resolve({ items: [message('stale-after-revoke', 'room-1')] });
    await act(async () => {
      await load;
    });
    expect(result.current.items).toEqual([]);
    expect(result.current.message).toBe('閲覧権限を管理者に確認してください。');
  });

  it('reports load failures without retaining pagination state', async () => {
    api.mockRejectedValueOnce(new Error('network failed'));
    const { result } = renderHook(() =>
      useRoomChatMessages({ roomId: 'room-1', filterQuery: '', filterTag: '' }),
    );

    await act(async () => {
      await result.current.loadMessages();
    });

    expect(result.current.message).toBe('メッセージの取得に失敗しました');
    expect(result.current.hasMore).toBe(false);
  });
});

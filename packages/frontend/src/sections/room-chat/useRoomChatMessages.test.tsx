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
    userId: 'alice',
    body: `${id} body`,
    createdAt,
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

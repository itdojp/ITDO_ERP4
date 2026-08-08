import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomChatGlobalSearch } from './useRoomChatGlobalSearch';

const { api } = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock('../../api', () => ({ api }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function item(id: string, createdAt = '2026-03-28T00:00:00.000Z') {
  return {
    id,
    roomId: 'room-1',
    messageType: 'text' as const,
    parentMessageId: null,
    threadRootId: null,
    userId: 'alice',
    body: `${id} result`,
    tags: [],
    createdAt,
    room: {
      id: 'room-1',
      type: 'project',
      name: 'room-1',
      isOfficial: null,
      projectId: null,
      projectCode: null,
      projectName: null,
      groupId: null,
      allowExternalUsers: null,
      allowExternalIntegrations: null,
      isMember: null,
    },
  };
}

describe('useRoomChatGlobalSearch', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    api.mockReset();
    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
  });

  it('blocks short queries before calling the API', async () => {
    const { result } = renderHook(() => useRoomChatGlobalSearch());

    act(() => result.current.setGlobalQuery('a'));
    await act(async () => {
      await result.current.loadGlobalSearch();
    });

    expect(result.current.globalMessage).toBe(
      '検索語は2文字以上で入力してください',
    );
    expect(api).not.toHaveBeenCalled();
  });

  it('appends the next page using the server timestamp and id boundary', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      item(
        `item-${index + 1}`,
        `2026-03-28T00:${String(49 - index).padStart(2, '0')}:00.000Z`,
      ),
    );
    const secondPage = [item('item-51', '2026-03-27T23:59:00.000Z')];
    api.mockImplementation(async (path: string) => {
      const url = new URL(path, 'http://localhost');
      expect(url.pathname).toBe('/chat-messages/search');
      expect(url.searchParams.get('q')).toBe('beta');
      if (!url.searchParams.get('before')) {
        return {
          items: firstPage,
          nextBefore: firstPage[firstPage.length - 1]?.createdAt,
          nextBeforeId: firstPage[firstPage.length - 1]?.id,
        };
      }
      expect(url.searchParams.get('before')).toBe(
        firstPage[firstPage.length - 1]?.createdAt,
      );
      expect(url.searchParams.get('beforeId')).toBe(
        firstPage[firstPage.length - 1]?.id,
      );
      return { items: secondPage, nextBefore: null, nextBeforeId: null };
    });

    const { result } = renderHook(() => useRoomChatGlobalSearch());
    act(() => result.current.setGlobalQuery('beta'));

    await act(async () => {
      await result.current.loadGlobalSearch();
    });
    expect(result.current.globalItems).toEqual(firstPage);
    expect(result.current.globalHasMore).toBe(true);

    await act(async () => {
      await result.current.loadGlobalSearch({ append: true });
    });
    expect(result.current.globalItems).toEqual([...firstPage, ...secondPage]);
    expect(result.current.globalHasMore).toBe(false);
  });

  it('clears global search results through the hook action', async () => {
    api.mockResolvedValueOnce({ items: [item('item-1')] });
    const { result } = renderHook(() => useRoomChatGlobalSearch());
    act(() => result.current.setGlobalQuery('beta'));

    await act(async () => {
      await result.current.loadGlobalSearch();
    });
    expect(result.current.globalItems).toEqual([item('item-1')]);

    act(() => result.current.clearGlobalSearch());

    expect(result.current.globalItems).toEqual([]);
    expect(result.current.globalHasMore).toBe(false);
    expect(result.current.globalMessage).toBe('');
  });

  it('invalidates result state and the server boundary when the query changes', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      item(`old-${index + 1}`),
    );
    api
      .mockResolvedValueOnce({
        items: firstPage,
        nextBefore: '2026-03-28T00:00:00.000Z',
        nextBeforeId: 'old-50',
      })
      .mockResolvedValueOnce({ items: [item('new-1')] });
    const { result } = renderHook(() => useRoomChatGlobalSearch());

    act(() => result.current.setGlobalQuery('old query'));
    await act(async () => result.current.loadGlobalSearch());
    expect(result.current.globalHasMore).toBe(true);

    act(() => result.current.setGlobalQuery('new query'));
    expect(result.current.globalItems).toEqual([]);
    expect(result.current.globalHasMore).toBe(false);
    await act(async () => result.current.loadGlobalSearch({ append: true }));
    expect(api).toHaveBeenCalledTimes(1);

    await act(async () => result.current.loadGlobalSearch());
    const secondPath = new URL(
      String(api.mock.calls[1]?.[0]),
      'http://localhost',
    );
    expect(secondPath.searchParams.get('q')).toBe('new query');
    expect(secondPath.searchParams.has('before')).toBe(false);
    expect(secondPath.searchParams.has('beforeId')).toBe(false);
    expect(result.current.globalItems).toEqual([item('new-1')]);
  });

  it('ignores a stale response after the search query changes', async () => {
    const oldResult = deferred<{ items: ReturnType<typeof item>[] }>();
    api.mockImplementation((path: string) => {
      const url = new URL(path, 'http://localhost');
      return url.searchParams.get('q') === 'old'
        ? oldResult.promise
        : Promise.resolve({ items: [item('new-result')] });
    });
    const { result } = renderHook(() => useRoomChatGlobalSearch());

    act(() => result.current.setGlobalQuery('old'));
    const oldSearch = result.current.loadGlobalSearch();
    act(() => result.current.setGlobalQuery('new'));
    await act(async () => {
      await result.current.loadGlobalSearch();
    });
    expect(result.current.globalItems).toEqual([item('new-result')]);

    oldResult.resolve({ items: [item('old-result')] });
    await act(async () => {
      await oldSearch;
    });
    expect(result.current.globalItems).toEqual([item('new-result')]);
  });

  it('aborts and invalidates an in-flight search on unmount', async () => {
    const pending = deferred<{ items: ReturnType<typeof item>[] }>();
    let signal: AbortSignal | undefined;
    api.mockImplementation((_path: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return pending.promise;
    });
    const { result, unmount } = renderHook(() => useRoomChatGlobalSearch());
    act(() => result.current.setGlobalQuery('pending'));

    const search = result.current.loadGlobalSearch();
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);

    pending.resolve({ items: [item('stale')] });
    await act(async () => {
      await search;
    });
    expect(api).toHaveBeenCalledTimes(1);
  });
});

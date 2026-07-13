import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomChatGlobalSearch } from './useRoomChatGlobalSearch';

const { api } = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock('../../api', () => ({ api }));

function item(id: string, createdAt = '2026-03-28T00:00:00.000Z') {
  return {
    id,
    roomId: 'room-1',
    userId: 'alice',
    body: `${id} result`,
    createdAt,
    room: { id: 'room-1', type: 'project', name: 'room-1' },
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

  it('appends the next page using the last createdAt as before', async () => {
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
      if (!url.searchParams.get('before')) return { items: firstPage };
      expect(url.searchParams.get('before')).toBe(
        firstPage[firstPage.length - 1]?.createdAt,
      );
      return { items: secondPage };
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
});

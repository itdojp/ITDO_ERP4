import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useRoomChatAccessRevalidation } from './useRoomChatAccessRevalidation';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

it('shares one room access revalidation across concurrent unavailable responses', async () => {
  const pending = deferred<boolean>();
  const clearGlobalSearch = vi.fn();
  const clearRoomBoundThreadState = vi.fn();
  const loadMessages = vi.fn().mockReturnValue(pending.promise);
  const setFilterQuery = vi.fn();
  const setFilterTag = vi.fn();
  const handlerRef: {
    current: ((roomId: string) => Promise<boolean>) | null;
  } = { current: null };

  const { result } = renderHook(() =>
    useRoomChatAccessRevalidation({
      currentRoomIdRef: { current: 'room-1' },
      handlerRef,
      clearGlobalSearch,
      clearRoomBoundThreadState,
      loadMessages,
      setFilterQuery,
      setFilterTag,
    }),
  );

  const first = result.current('room-1');
  const second = result.current('room-1');

  expect(first).toBe(second);
  expect(loadMessages).toHaveBeenCalledTimes(1);
  expect(clearGlobalSearch).toHaveBeenCalledTimes(1);
  expect(setFilterQuery).toHaveBeenCalledTimes(1);
  expect(setFilterTag).toHaveBeenCalledTimes(1);

  pending.resolve(true);
  await act(async () => {
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  expect(clearRoomBoundThreadState).not.toHaveBeenCalled();
  expect(handlerRef.current).toBe(result.current);
});

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRoomChatMutationLifecycle } from './useRoomChatMutationLifecycle';

describe('useRoomChatMutationLifecycle', () => {
  it('keeps navigation blocked until every local mutation owner is idle', () => {
    const { result } = renderHook(() => useRoomChatMutationLifecycle({}));

    act(() => result.current.updateKnowledgeCommitBusy(true));
    expect(result.current.knowledgeCommitBusy).toBe(true);
    expect(result.current.knowledgeCommitBusyRef.current).toBe(true);
    expect(result.current.roomNavigationBlocked).toBe(true);
    expect(result.current.roomNavigationBlockedRef.current).toBe(true);

    act(() => result.current.updateRootPostLifecycle('uncertain'));
    act(() => result.current.updateKnowledgeCommitBusy(false));
    expect(result.current.roomNavigationBlocked).toBe(true);
    expect(result.current.roomNavigationBlockedRef.current).toBe(true);

    act(() => result.current.updateRootPostLifecycle('idle'));
    expect(result.current.roomNavigationBlocked).toBe(false);
    expect(result.current.roomNavigationBlockedRef.current).toBe(false);
  });

  it('notifies a controlled owner while updating synchronous navigation refs', () => {
    const onKnowledgeCommitBusyChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ busy }) =>
        useRoomChatMutationLifecycle({
          knowledgeCommitBusy: busy,
          onKnowledgeCommitBusyChange,
        }),
      { initialProps: { busy: false } },
    );

    act(() => result.current.updateKnowledgeCommitBusy(true));
    expect(onKnowledgeCommitBusyChange).toHaveBeenCalledWith(true);
    expect(result.current.knowledgeCommitBusyRef.current).toBe(true);
    expect(result.current.roomNavigationBlockedRef.current).toBe(true);

    rerender({ busy: true });
    expect(result.current.knowledgeCommitBusy).toBe(true);
    expect(result.current.roomNavigationBlocked).toBe(true);
  });
});

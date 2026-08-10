import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getKnowledgeShareCard, listRoomKnowledgeShareSummaries } = vi.hoisted(
  () => ({
    getKnowledgeShareCard: vi.fn(),
    listRoomKnowledgeShareSummaries: vi.fn(),
  }),
);

vi.mock('../knowledge-share/knowledgeShareApi', () => ({
  getKnowledgeShareCard,
  listRoomKnowledgeShareSummaries,
}));

import type {
  KnowledgeShareRoomCard,
  RoomKnowledgeShareSummary,
} from '../knowledge-share/knowledgeShareModel';
import { useRoomKnowledgeShares } from './useRoomKnowledgeShares';

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

function summary(
  messageId: string,
  overrides: Partial<RoomKnowledgeShareSummary> = {},
): RoomKnowledgeShareSummary {
  return {
    messageId,
    shareId: `share-${messageId}`,
    status: 'posted',
    version: 2,
    schemaVersion: 1,
    ...overrides,
  };
}

function card(item: RoomKnowledgeShareSummary): KnowledgeShareRoomCard {
  return {
    shareId: item.shareId,
    status: item.status,
    version: item.version,
    schemaVersion: 1,
    card:
      item.status === 'revoked'
        ? null
        : {
            schemaVersion: 1,
            title: item.messageId,
            sourceType: null,
            canonicalUrl: null,
            snapshot: null,
            sharerNote: null,
            labels: [],
            annotations: [],
            turns: [],
            syntheses: [],
            selectedCategories: ['title'],
            omittedCategories: [
              'source_type',
              'canonical_url',
              'snapshot_provenance',
              'snapshot_excerpt',
              'label',
              'annotation',
              'conversation_turn',
              'synthesis',
              'sharer_note',
            ],
          },
    canOpenSource: item.status === 'posted',
  };
}

describe('useRoomKnowledgeShares', () => {
  beforeEach(() => {
    getKnowledgeShareCard.mockReset();
    listRoomKnowledgeShareSummaries.mockReset();
  });

  it('batch-fetches the exact roots and bounds matched full-card reads', async () => {
    const summaries = Array.from({ length: 9 }, (_, index) =>
      summary(`message-${index + 1}`),
    );
    let activeReads = 0;
    let maximumActiveReads = 0;
    listRoomKnowledgeShareSummaries.mockResolvedValueOnce(summaries);
    getKnowledgeShareCard.mockImplementation(async (messageId: string) => {
      activeReads += 1;
      maximumActiveReads = Math.max(maximumActiveReads, activeReads);
      await new Promise((resolve) => window.setTimeout(resolve, 1));
      activeReads -= 1;
      return card(
        summaries.find(
          (item) => item.messageId === messageId,
        ) as RoomKnowledgeShareSummary,
      );
    });

    const rootMessageIds = summaries.map((item) => item.messageId);
    const { result } = renderHook(() =>
      useRoomKnowledgeShares({
        roomId: 'room-1',
        visibleRootMessageIds: rootMessageIds,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listRoomKnowledgeShareSummaries).toHaveBeenCalledTimes(1);
    expect(listRoomKnowledgeShareSummaries).toHaveBeenCalledWith({
      roomId: 'room-1',
      messageIds: rootMessageIds,
      signal: expect.any(AbortSignal),
    });
    expect(getKnowledgeShareCard).toHaveBeenCalledTimes(9);
    expect(maximumActiveReads).toBeLessThanOrEqual(4);
    expect(result.current.knowledgeShares.size).toBe(9);
    expect(
      result.current.knowledgeShares.get('message-1')?.card.card?.title,
    ).toBe('message-1');
  });

  it('purges immediately on room switch and ignores the stale response', async () => {
    const oldRoom = deferred<RoomKnowledgeShareSummary[]>();
    let oldSignal: AbortSignal | undefined;
    listRoomKnowledgeShareSummaries.mockImplementation(
      ({ roomId, signal }: { roomId: string; signal?: AbortSignal }) => {
        if (roomId === 'room-1') {
          oldSignal = signal;
          return oldRoom.promise;
        }
        return Promise.resolve([]);
      },
    );

    const { result, rerender } = renderHook(
      ({ roomId, rootMessageIds }) =>
        useRoomKnowledgeShares({ roomId, rootMessageIds }),
      {
        initialProps: {
          roomId: 'room-1',
          rootMessageIds: ['message-old'],
        },
      },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(true));

    rerender({ roomId: 'room-2', rootMessageIds: ['message-new'] });
    expect(oldSignal?.aborted).toBe(true);
    expect(result.current.knowledgeShares.size).toBe(0);

    oldRoom.resolve([summary('message-old')]);
    await act(async () => {
      await oldRoom.promise;
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.knowledgeShares.size).toBe(0);
    expect(getKnowledgeShareCard).not.toHaveBeenCalled();
  });

  it('invalidates in-flight reads on explicit purge', async () => {
    const pending = deferred<RoomKnowledgeShareSummary[]>();
    listRoomKnowledgeShareSummaries.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() =>
      useRoomKnowledgeShares({
        roomId: 'room-1',
        rootMessageIds: ['message-1'],
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(true));

    act(() => {
      expect(result.current.purgeKnowledgeShares('room-1')).toBe(true);
    });
    pending.resolve([summary('message-1')]);
    await act(async () => {
      await pending.promise;
    });

    expect(result.current.knowledgeShares.size).toBe(0);
    expect(result.current.isLoading).toBe(false);
    expect(getKnowledgeShareCard).not.toHaveBeenCalled();
  });

  it('fails closed on a mismatched card and never exposes raw errors', async () => {
    const item = summary('message-1');
    listRoomKnowledgeShareSummaries.mockResolvedValueOnce([item]);
    getKnowledgeShareCard.mockResolvedValueOnce({
      ...card(item),
      shareId: 'share-from-another-snapshot',
      privateError: 'raw-secret',
    });

    const { result } = renderHook(() =>
      useRoomKnowledgeShares({
        roomId: 'room-1',
        rootMessageIds: ['message-1'],
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.knowledgeShares.size).toBe(0);
    expect(result.current).not.toHaveProperty('error');
    expect(JSON.stringify(result.current)).not.toContain('raw-secret');
    expect(result.current.errorsByMessageId.get('message-1')).toEqual({
      code: 'invalid_response',
      message: '知識共有の表示データを確認できませんでした。',
    });
  });

  it('does not issue a partial request for more than 100 roots', async () => {
    const { result } = renderHook(() =>
      useRoomKnowledgeShares({
        roomId: 'room-1',
        rootMessageIds: Array.from(
          { length: 101 },
          (_, index) => `message-${index}`,
        ),
      }),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.knowledgeShares.size).toBe(0);
    expect(listRoomKnowledgeShareSummaries).not.toHaveBeenCalled();
  });

  it('rejects a lower-version late card instead of replacing current summary state', async () => {
    const current = summary('message-1', { version: 5 });
    listRoomKnowledgeShareSummaries.mockResolvedValueOnce([current]);
    getKnowledgeShareCard.mockResolvedValueOnce(
      card({
        ...current,
        version: 4,
      }),
    );

    const { result } = renderHook(() =>
      useRoomKnowledgeShares({
        roomId: 'room-1',
        visibleRootMessageIds: ['message-1'],
      }),
    );

    await waitFor(() =>
      expect(result.current.loadingByMessageId.get('message-1')).toBe(false),
    );
    expect(result.current.cardsByMessageId.has('message-1')).toBe(false);
    expect(result.current.summariesByMessageId.get('message-1')?.version).toBe(
      5,
    );
    expect(result.current.errorsByMessageId.get('message-1')?.code).toBe(
      'invalid_response',
    );
  });

  it('accepts only valid optimistic status advancement from a compact summary', async () => {
    const posted = summary('message-1');
    listRoomKnowledgeShareSummaries.mockResolvedValueOnce([posted]);
    getKnowledgeShareCard.mockResolvedValueOnce(
      card({ ...posted, status: 'revoked', version: 3 }),
    );

    const first = renderHook(() =>
      useRoomKnowledgeShares({
        roomId: 'room-1',
        visibleRootMessageIds: ['message-1'],
      }),
    );
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    expect(
      first.result.current.cardsByMessageId.get('message-1'),
    ).toMatchObject({
      status: 'revoked',
      version: 3,
      card: null,
    });
    first.unmount();

    const revoked = summary('message-2', { status: 'revoked', version: 4 });
    listRoomKnowledgeShareSummaries.mockResolvedValueOnce([revoked]);
    getKnowledgeShareCard.mockResolvedValueOnce(
      card({ ...revoked, status: 'posted', version: 5 }),
    );
    const second = renderHook(() =>
      useRoomKnowledgeShares({
        roomId: 'room-1',
        visibleRootMessageIds: ['message-2'],
      }),
    );
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    expect(second.result.current.cardsByMessageId.has('message-2')).toBe(false);
    expect(second.result.current.errorsByMessageId.get('message-2')?.code).toBe(
      'invalid_response',
    );
  });

  it('purges cards when the visible set changes or access is lost', async () => {
    const first = summary('message-1');
    listRoomKnowledgeShareSummaries
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([]);
    getKnowledgeShareCard.mockResolvedValueOnce(card(first));

    const { result, rerender } = renderHook(
      ({ messageIds, hasAccess }) =>
        useRoomKnowledgeShares({
          roomId: 'room-1',
          visibleRootMessageIds: messageIds,
          hasAccess,
        }),
      {
        initialProps: { messageIds: ['message-1'], hasAccess: true },
      },
    );
    await waitFor(() =>
      expect(result.current.cardsByMessageId.has('message-1')).toBe(true),
    );

    rerender({ messageIds: ['message-2'], hasAccess: true });
    expect(result.current.cardsByMessageId.size).toBe(0);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    rerender({ messageIds: ['message-2'], hasAccess: false });
    expect(result.current.cardsByMessageId.size).toBe(0);
    expect(result.current.summariesByMessageId.size).toBe(0);
    expect(result.current.errorsByMessageId.size).toBe(0);
  });
});

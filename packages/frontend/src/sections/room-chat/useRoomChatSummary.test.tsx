import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoomChatSummary } from './useRoomChatSummary';

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

describe('useRoomChatSummary', () => {
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

  it('keeps only allowlisted summary fields and clears all provenance on demand', async () => {
    api.mockResolvedValueOnce({
      summary: 'external summary',
      provider: 'stub',
      model: 'stub-model',
      providerUrl: 'https://private.invalid',
      internalTrace: 'private-trace',
    });
    const setMessage = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { result } = renderHook(() =>
      useRoomChatSummary({
        roomId: 'room-1',
        allowExternalIntegrations: true,
        setMessage,
        onAccessUnavailable: vi.fn().mockResolvedValue(false),
      }),
    );

    try {
      await act(async () => {
        await result.current.summarizeExternal();
      });
      expect(result.current.summary).toBe('external summary');
      expect(result.current.summaryProvider).toBe('stub');
      expect(result.current.summaryModel).toBe('stub-model');
      expect(result.current).not.toHaveProperty('providerUrl');
      expect(result.current).not.toHaveProperty('internalTrace');

      act(() => {
        expect(result.current.clearSummary('room-1')).toBe(true);
      });
      expect(result.current.summary).toBe('');
      expect(result.current.summaryProvider).toBe('');
      expect(result.current.summaryModel).toBe('');
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('does not let an old-room response restore a summary after room switch', async () => {
    const pending = deferred<{ summary: string }>();
    api.mockReturnValueOnce(pending.promise);
    const setMessage = vi.fn();
    const { result, rerender } = renderHook(
      ({ roomId }) =>
        useRoomChatSummary({
          roomId,
          allowExternalIntegrations: false,
          setMessage,
          onAccessUnavailable: vi.fn().mockResolvedValue(false),
        }),
      { initialProps: { roomId: 'room-1' } },
    );

    const request = result.current.summarize();
    await waitFor(() => expect(result.current.isSummarizing).toBe(true));
    rerender({ roomId: 'room-2' });
    expect(result.current.summary).toBe('');

    pending.resolve({ summary: 'stale private summary' });
    await act(async () => {
      await request;
    });
    expect(result.current.summary).toBe('');
    expect(setMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('stale private summary'),
    );
  });

  it('invalidates an in-flight response when access purge clears the summary', async () => {
    const pending = deferred<{ summary: string }>();
    api.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() =>
      useRoomChatSummary({
        roomId: 'room-1',
        allowExternalIntegrations: false,
        setMessage: vi.fn(),
        onAccessUnavailable: vi.fn().mockResolvedValue(false),
      }),
    );

    const request = result.current.summarize();
    await waitFor(() => expect(result.current.isSummarizing).toBe(true));
    act(() => {
      result.current.clearSummary('room-1');
    });
    pending.resolve({ summary: 'stale after purge' });
    await act(async () => {
      await request;
    });
    expect(result.current.summary).toBe('');
    expect(result.current.isSummarizing).toBe(false);
  });

  it('revalidates unavailable access without exposing the raw error', async () => {
    api.mockRejectedValueOnce(
      new Error('Request failed (404) private-summary-detail'),
    );
    const setMessage = vi.fn();
    const onAccessUnavailable = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() =>
      useRoomChatSummary({
        roomId: 'room-1',
        allowExternalIntegrations: false,
        setMessage,
        onAccessUnavailable,
      }),
    );

    await act(async () => {
      await result.current.summarize();
    });
    expect(onAccessUnavailable).toHaveBeenCalledWith('room-1');
    expect(result.current.summary).toBe('');
    expect(setMessage).not.toHaveBeenCalledWith(
      expect.stringContaining('private-summary-detail'),
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to summarize room messages.',
    );
  });
});

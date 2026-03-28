import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  api: vi.fn(),
}));

import { api } from '../api';
import { useProjectTasks, type ProjectTaskOption } from './useProjectTasks';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.mocked(api).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useProjectTasks', () => {
  it('short-circuits when no project is selected', () => {
    const { result } = renderHook(() =>
      useProjectTasks({ projectId: undefined }),
    );

    expect(api).not.toHaveBeenCalled();
    expect(result.current.tasks).toEqual([]);
    expect(result.current.taskMessage).toBe('');
    expect(result.current.isLoading).toBe(false);
  });

  it('loads tasks and toggles loading state', async () => {
    const deferred = createDeferred<{ items: ProjectTaskOption[] }>();
    vi.mocked(api).mockImplementation(() => deferred.promise as never);

    const { result } = renderHook(() =>
      useProjectTasks({ projectId: 'proj-1' }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(true));
    expect(api).toHaveBeenCalledWith('/projects/proj-1/tasks');

    deferred.resolve({
      items: [{ id: 'task-1', name: 'Task One' }],
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.tasks).toEqual([{ id: 'task-1', name: 'Task One' }]);
    expect(result.current.taskMessage).toBe('');
  });

  it('reloads tasks only when the matching project id is broadcast', async () => {
    let callCount = 0;
    vi.mocked(api).mockImplementation(async () => {
      callCount += 1;
      return {
        items:
          callCount <= 2
            ? [{ id: 'task-1', name: 'Task One' }]
            : [{ id: 'task-2', name: 'Task Two' }],
      } as never;
    });

    const { result } = renderHook(() =>
      useProjectTasks({ projectId: 'proj-1' }),
    );

    await waitFor(() =>
      expect(result.current.tasks).toEqual([
        { id: 'task-1', name: 'Task One' },
      ]),
    );

    const initialCallCount = vi.mocked(api).mock.calls.length;

    act(() => {
      window.dispatchEvent(
        new CustomEvent('erp4:project-tasks-changed', {
          detail: { projectId: 'proj-2' },
        }),
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vi.mocked(api).mock.calls.length).toBe(initialCallCount);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('erp4:project-tasks-changed', {
          detail: { projectId: 'proj-1' },
        }),
      );
    });
    await waitFor(() =>
      expect(vi.mocked(api).mock.calls.length).toBeGreaterThan(
        initialCallCount,
      ),
    );
    await waitFor(() =>
      expect(result.current.tasks).toEqual([
        { id: 'task-2', name: 'Task Two' },
      ]),
    );
  });

  it('shows a failure message when loading tasks fails', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.mocked(api).mockRejectedValue(new Error('load tasks failed'));

    const { result } = renderHook(() =>
      useProjectTasks({ projectId: 'proj-1' }),
    );

    await waitFor(() =>
      expect(result.current.taskMessage).toBe('タスク一覧の取得に失敗しました'),
    );
    expect(result.current.tasks).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    consoleErrorSpy.mockRestore();
  });
});

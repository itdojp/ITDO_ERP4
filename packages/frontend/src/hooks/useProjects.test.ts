import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  api: vi.fn(),
}));

import { api } from '../api';
import { useProjects, type ProjectOption } from './useProjects';

const projects: ProjectOption[] = [
  { id: 'proj-1', code: 'P001', name: 'Project One' },
  { id: 'proj-2', code: 'P002', name: 'Project Two' },
];

beforeEach(() => {
  vi.mocked(api).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useProjects', () => {
  it('loads projects on mount and keeps the current selection when present', async () => {
    vi.mocked(api).mockResolvedValue({ items: projects });
    const onSelect = vi.fn();

    const { result } = renderHook(() =>
      useProjects({ selectedProjectId: 'proj-2', onSelect }),
    );

    await waitFor(() => expect(result.current.projects).toEqual(projects));
    expect(result.current.projectMessage).toBe('');
    expect(onSelect).not.toHaveBeenCalled();
    expect(api).toHaveBeenCalledWith('/projects');
  });

  it('falls back to the first project when the selected project is missing', async () => {
    vi.mocked(api).mockResolvedValue({ items: projects });
    const onSelect = vi.fn();

    const { result } = renderHook(() =>
      useProjects({ selectedProjectId: 'missing-project', onSelect }),
    );

    await waitFor(() => expect(result.current.projects).toEqual(projects));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('proj-1'));
    expect(onSelect.mock.calls.every(([value]) => value === 'proj-1')).toBe(
      true,
    );
  });

  it('reloads projects when auth-updated is dispatched', async () => {
    const nextProjects: ProjectOption[] = [
      { id: 'proj-3', code: 'P003', name: 'Project Three' },
    ];
    let callCount = 0;
    vi.mocked(api).mockImplementation(async () => {
      callCount += 1;
      return {
        items: callCount <= 2 ? projects : nextProjects,
      } as never;
    });
    const onSelect = vi.fn();

    const { result } = renderHook(() =>
      useProjects({ selectedProjectId: 'proj-1', onSelect }),
    );

    await waitFor(() => expect(result.current.projects).toEqual(projects));
    const initialCallCount = vi.mocked(api).mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event('erp4:auth-updated'));
    });
    await waitFor(() =>
      expect(vi.mocked(api).mock.calls.length).toBeGreaterThan(
        initialCallCount,
      ),
    );
    await waitFor(() => expect(result.current.projects).toEqual(nextProjects));
    expect(onSelect).toHaveBeenCalledWith('proj-3');
    expect(onSelect.mock.calls.every(([value]) => value === 'proj-3')).toBe(
      true,
    );
  });

  it('shows a failure message when loading projects fails', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.mocked(api).mockRejectedValue(new Error('load projects failed'));

    const { result } = renderHook(() =>
      useProjects({ selectedProjectId: 'proj-1', onSelect: vi.fn() }),
    );

    await waitFor(() =>
      expect(result.current.projectMessage).toBe(
        '案件一覧の取得に失敗しました',
      ),
    );
    expect(result.current.projects).toEqual([]);
    consoleErrorSpy.mockRestore();
  });
});

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatRooms, type ChatRoomOption } from './useChatRooms';

const { api } = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock('../api', () => ({ api }));

function makeRoom(overrides: Partial<ChatRoomOption> = {}): ChatRoomOption {
  return {
    id: overrides.id || 'room-1',
    type: overrides.type || 'project',
    name: overrides.name || '案件チャット',
    projectId: overrides.projectId ?? 'proj-1',
    projectCode: overrides.projectCode ?? 'PJ-1',
    projectName: overrides.projectName ?? '案件A',
  };
}

describe('useChatRooms', () => {
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

  it('keeps only project rooms and falls back to the first project', async () => {
    const onSelect = vi.fn();
    const projectRooms = [
      makeRoom({
        id: 'room-1',
        projectId: 'proj-1',
        name: '案件A',
      }),
      makeRoom({
        id: 'room-2',
        projectId: '   ',
        name: '無効',
      }),
      makeRoom({
        id: 'room-3',
        type: 'direct',
        projectId: 'proj-3',
        name: '個別',
      }),
      makeRoom({
        id: 'room-4',
        projectId: 'proj-2',
        name: '案件B',
      }),
    ];
    api.mockResolvedValueOnce({ items: projectRooms });

    const { result } = renderHook(() =>
      useChatRooms({ selectedProjectId: 'missing-project', onSelect }),
    );

    await waitFor(() =>
      expect(result.current.rooms).toEqual([projectRooms[0], projectRooms[3]]),
    );
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('proj-1'));
    expect(result.current.roomMessage).toBe('');
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('does not select when the current project already exists', async () => {
    const onSelect = vi.fn();
    const projectRooms = [
      makeRoom({ id: 'room-1', projectId: 'proj-1' }),
      makeRoom({ id: 'room-2', projectId: 'proj-2' }),
    ];
    api.mockResolvedValueOnce({ items: projectRooms });

    const { result } = renderHook(() =>
      useChatRooms({ selectedProjectId: 'proj-2', onSelect }),
    );

    await waitFor(() => expect(result.current.rooms).toEqual(projectRooms));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows an error message when loadRooms fails', async () => {
    const onSelect = vi.fn();
    api.mockRejectedValueOnce(new Error('network error'));

    const { result } = renderHook(() =>
      useChatRooms({ selectedProjectId: 'proj-1', onSelect }),
    );

    await waitFor(() =>
      expect(result.current.roomMessage).toBe('ルーム一覧の取得に失敗しました'),
    );
    expect(result.current.rooms).toEqual([]);
    expect(onSelect).not.toHaveBeenCalled();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('reloads rooms when loadRooms is called manually', async () => {
    const onSelect = vi.fn();
    const firstRooms = [makeRoom({ id: 'room-1', projectId: 'proj-1' })];
    const nextRooms = [makeRoom({ id: 'room-2', projectId: 'proj-2' })];
    api
      .mockResolvedValueOnce({ items: firstRooms })
      .mockResolvedValueOnce({ items: nextRooms });

    const { result } = renderHook(() =>
      useChatRooms({ selectedProjectId: 'proj-1', onSelect }),
    );

    await waitFor(() => expect(result.current.rooms).toEqual(firstRooms));
    expect(onSelect).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.loadRooms();
    });

    await waitFor(() => expect(result.current.rooms).toEqual(nextRooms));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('proj-2'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledTimes(2);
  });
});

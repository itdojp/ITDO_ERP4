/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api, getAuthState } = vi.hoisted(() => ({
  api: vi.fn(),
  getAuthState: vi.fn(),
}));

vi.mock('../api', () => ({ api, getAuthState }));

import { ChatRoomSettingsCard } from './ChatRoomSettingsCard';

type ChatRoom = {
  id: string;
  type: string;
  name: string;
  isOfficial?: boolean | null;
  projectCode?: string | null;
  projectName?: string | null;
  groupId?: string | null;
  viewerGroupIds?: string[] | null;
  posterGroupIds?: string[] | null;
  allowExternalUsers?: boolean | null;
  allowExternalIntegrations?: boolean | null;
};

function setupChatRoomApiMock(
  initialRooms: ChatRoom[] = [],
  options?: { patchFailureRoomId?: string },
) {
  let rooms = initialRooms.map((room) => ({
    ...room,
    viewerGroupIds: Array.isArray(room.viewerGroupIds)
      ? [...room.viewerGroupIds]
      : (room.viewerGroupIds ?? null),
    posterGroupIds: Array.isArray(room.posterGroupIds)
      ? [...room.posterGroupIds]
      : (room.posterGroupIds ?? null),
  }));

  vi.mocked(api).mockImplementation(
    async (path: string, init?: RequestInit) => {
      if (path === '/chat-rooms' && !init?.method) {
        return { items: rooms };
      }

      const patchMatch = path.match(/^\/chat-rooms\/([^/]+)$/);
      if (patchMatch && init?.method === 'PATCH') {
        const roomId = patchMatch[1];
        if (options?.patchFailureRoomId === roomId) {
          throw new Error('save failed');
        }
        const body = JSON.parse(String(init.body || '{}')) as Partial<ChatRoom>;
        rooms = rooms.map((room) =>
          room.id === roomId
            ? {
                ...room,
                allowExternalUsers: body.allowExternalUsers ?? false,
                allowExternalIntegrations:
                  body.allowExternalIntegrations ?? false,
                viewerGroupIds: body.viewerGroupIds ?? [],
                posterGroupIds: body.posterGroupIds ?? [],
              }
            : room,
        );
        return {};
      }

      const membersMatch = path.match(/^\/chat-rooms\/([^/]+)\/members$/);
      if (membersMatch && init?.method === 'POST') {
        return {};
      }

      throw new Error(`Unhandled api call: ${path} ${init?.method || 'GET'}`);
    },
  );

  return {
    getRooms: () => rooms,
  };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  api.mockReset();
  getAuthState.mockReset();
});

describe('ChatRoomSettingsCard', () => {
  it('権限がないユーザには閲覧メッセージのみを表示する', () => {
    getAuthState.mockReturnValue({ userId: 'user-1', roles: ['user'] });
    vi.mocked(api).mockResolvedValue({ items: [] });

    render(<ChatRoomSettingsCard />);

    expect(screen.getByText('admin/mgmt のみ操作できます')).not.toBeNull();
  });

  it('ルーム一覧の取得失敗後に再読込で復旧できる', async () => {
    getAuthState.mockReturnValue({ userId: 'user-1', roles: ['admin'] });

    let loadCount = 0;
    vi.mocked(api).mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (path === '/chat-rooms' && !init?.method) {
          loadCount += 1;
          if (loadCount === 1) {
            throw new Error('temporary network failure');
          }
          return {
            items: [
              {
                id: 'room-1',
                type: 'project',
                name: '開発チャット',
                isOfficial: true,
                projectCode: 'PRJ-001',
                projectName: 'Alpha Project',
                viewerGroupIds: ['viewer-initial'],
                posterGroupIds: ['poster-initial'],
              },
            ],
          };
        }

        throw new Error(`Unhandled api call: ${path} ${init?.method || 'GET'}`);
      },
    );

    render(<ChatRoomSettingsCard />);

    await screen.findByText('ルーム一覧の取得に失敗しました');
    expect(screen.queryByDisplayValue('room-1')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '再読込' }));

    await screen.findByText('room-1');
    expect(screen.queryByText('ルーム一覧の取得に失敗しました')).toBeNull();
  });

  it('公式ルームを読み込み、設定を保存できる', async () => {
    getAuthState.mockReturnValue({ userId: 'user-1', roles: ['admin'] });
    const state = setupChatRoomApiMock([
      {
        id: 'room-1',
        type: 'project',
        name: '開発チャット',
        isOfficial: true,
        projectCode: 'PRJ-001',
        projectName: 'Alpha Project',
        viewerGroupIds: ['viewer-a', 'viewer-b'],
        posterGroupIds: ['poster-a'],
        allowExternalUsers: true,
        allowExternalIntegrations: false,
      },
      {
        id: 'room-2',
        type: 'department',
        name: '非公式ルーム',
        isOfficial: false,
        groupId: 'group-2',
      },
    ]);

    render(<ChatRoomSettingsCard />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/chat-rooms');
    });
    await screen.findByDisplayValue('viewer-a, viewer-b');
    await screen.findByDisplayValue('poster-a');

    expect(
      screen.getByRole('option', { name: 'project: PRJ-001 / Alpha Project' }),
    ).not.toBeNull();
    expect(
      screen.queryByRole('option', {
        name: 'department: 非公式ルーム (group-2)',
      }),
    ).toBeNull();
    expect(
      (screen.getByLabelText('外部ユーザ参加を許可') as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(
      (screen.getByLabelText('外部連携を許可') as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByLabelText('閲覧グループ') as HTMLInputElement).value,
    ).toBe('viewer-a, viewer-b');
    expect(
      (screen.getByLabelText('投稿グループ') as HTMLInputElement).value,
    ).toBe('poster-a');

    fireEvent.change(screen.getByLabelText('外部ユーザ参加を許可'), {
      target: { checked: false },
    });
    fireEvent.change(screen.getByLabelText('外部連携を許可'), {
      target: { checked: true },
    });
    fireEvent.change(screen.getByLabelText('閲覧グループ'), {
      target: { value: 'viewer-x, viewer-y' },
    });
    fireEvent.change(screen.getByLabelText('投稿グループ'), {
      target: { value: 'poster-x, poster-y' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/chat-rooms/room-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            allowExternalUsers: true,
            allowExternalIntegrations: false,
            viewerGroupIds: ['viewer-x', 'viewer-y'],
            posterGroupIds: ['poster-x', 'poster-y'],
          }),
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText('保存しました')).not.toBeNull();
    });
    expect(state.getRooms()[0]).toMatchObject({
      allowExternalUsers: true,
      allowExternalIntegrations: false,
      viewerGroupIds: ['viewer-x', 'viewer-y'],
      posterGroupIds: ['poster-x', 'poster-y'],
    });
  });

  it('group input は余分な空白を除いて保存する', async () => {
    getAuthState.mockReturnValue({ userId: 'user-1', roles: ['admin'] });
    setupChatRoomApiMock([
      {
        id: 'room-1',
        type: 'project',
        name: '開発チャット',
        isOfficial: true,
        projectCode: 'PRJ-001',
        projectName: 'Alpha Project',
        viewerGroupIds: [],
        posterGroupIds: [],
      },
    ]);

    render(<ChatRoomSettingsCard />);

    await screen.findByText('room-1');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    });

    fireEvent.change(screen.getByLabelText('閲覧グループ'), {
      target: { value: '  viewer-x , viewer-y , , viewer-z  ' },
    });
    fireEvent.change(screen.getByLabelText('投稿グループ'), {
      target: { value: ' poster-x,  poster-y ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/chat-rooms/room-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            allowExternalUsers: false,
            allowExternalIntegrations: false,
            viewerGroupIds: ['viewer-x', 'viewer-y', 'viewer-z'],
            posterGroupIds: ['poster-x', 'poster-y'],
          }),
        }),
      );
    });
  });

  it('保存失敗時も入力内容を保持する', async () => {
    getAuthState.mockReturnValue({ userId: 'user-1', roles: ['admin'] });
    setupChatRoomApiMock(
      [
        {
          id: 'room-1',
          type: 'project',
          name: '開発チャット',
          isOfficial: true,
          projectCode: 'PRJ-001',
          projectName: 'Alpha Project',
          viewerGroupIds: ['viewer-initial'],
          posterGroupIds: ['poster-initial'],
        },
      ],
      { patchFailureRoomId: 'room-1' },
    );

    render(<ChatRoomSettingsCard />);

    await screen.findByDisplayValue('viewer-initial');
    await screen.findByDisplayValue('poster-initial');
    const posterInput = screen.getByLabelText(
      '投稿グループ',
    ) as HTMLInputElement;

    fireEvent.change(posterInput, {
      target: { value: 'poster-a, poster-b' },
    });
    expect(posterInput.value).toBe('poster-a, poster-b');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await screen.findByText('保存に失敗しました');
    expect(posterInput.value).toBe('poster-a, poster-b');
  });

  it('メンバー追加時に userId を分割して送信する', async () => {
    getAuthState.mockReturnValue({ userId: 'user-1', roles: ['mgmt'] });
    setupChatRoomApiMock([
      {
        id: 'room-1',
        type: 'project',
        name: '開発チャット',
        isOfficial: true,
        projectCode: 'PRJ-001',
        projectName: 'Alpha Project',
      },
    ]);

    render(<ChatRoomSettingsCard />);

    await screen.findByText('room-1');

    fireEvent.change(screen.getByLabelText('userId（comma separated）'), {
      target: { value: ' external-1@example.com , external-2@example.com ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'メンバー追加' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/chat-rooms/room-1/members',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            userIds: ['external-1@example.com', 'external-2@example.com'],
          }),
        }),
      );
    });

    expect(screen.getByText('メンバーを追加しました')).not.toBeNull();
    expect(
      (screen.getByLabelText('userId（comma separated）') as HTMLInputElement)
        .value,
    ).toBe('');
  });

  it('メンバー追加後の再読込失敗では失敗メッセージを表示する', async () => {
    getAuthState.mockReturnValue({ userId: 'user-1', roles: ['mgmt'] });

    let loadCount = 0;
    vi.mocked(api).mockImplementation(
      async (path: string, init?: RequestInit) => {
        if (path === '/chat-rooms' && !init?.method) {
          loadCount += 1;
          if (loadCount > 1) {
            throw new Error('reload failed after member add');
          }
          return {
            items: [
              {
                id: 'room-1',
                type: 'project',
                name: '開発チャット',
                isOfficial: true,
                projectCode: 'PRJ-001',
                projectName: 'Alpha Project',
              },
            ],
          };
        }

        if (path === '/chat-rooms/room-1/members' && init?.method === 'POST') {
          return {};
        }

        throw new Error(`Unhandled api call: ${path} ${init?.method || 'GET'}`);
      },
    );

    render(<ChatRoomSettingsCard />);

    await screen.findByText('room-1');

    fireEvent.change(screen.getByLabelText('userId（comma separated）'), {
      target: { value: ' external-1@example.com , external-2@example.com ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'メンバー追加' }));

    await screen.findByText('ルーム一覧の取得に失敗しました');
    expect(
      (screen.getByLabelText('userId（comma separated）') as HTMLInputElement)
        .value,
    ).toBe('');
  });

  it('空のグループは空欄で表示され、空のメンバー追加は入力を促す', async () => {
    getAuthState.mockReturnValue({ userId: 'user-1', roles: ['mgmt'] });
    setupChatRoomApiMock([
      {
        id: 'room-1',
        type: 'project',
        name: '開発チャット',
        isOfficial: true,
        projectCode: 'PRJ-001',
        projectName: 'Alpha Project',
        viewerGroupIds: [],
        posterGroupIds: null,
      },
    ]);

    render(<ChatRoomSettingsCard />);

    await screen.findByText('room-1');

    expect(
      (screen.getByLabelText('閲覧グループ') as HTMLInputElement).value,
    ).toBe('');
    expect(
      (screen.getByLabelText('投稿グループ') as HTMLInputElement).value,
    ).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'メンバー追加' }));

    expect(
      screen.getByText('追加するユーザIDを入力してください'),
    ).not.toBeNull();
  });
});

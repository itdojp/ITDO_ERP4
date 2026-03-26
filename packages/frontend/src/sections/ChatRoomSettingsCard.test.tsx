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

const ROOMS_RESPONSE = {
  items: [
    {
      id: 'room-project',
      type: 'project',
      name: 'ignored',
      isOfficial: true,
      projectCode: 'P001',
      projectName: 'Alpha Project',
      viewerGroupIds: [' view-a ', 'view-b'],
      posterGroupIds: ['post-a'],
      allowExternalUsers: true,
      allowExternalIntegrations: false,
    },
    {
      id: 'room-unofficial',
      type: 'private_group',
      name: 'Hidden',
      isOfficial: false,
    },
    {
      id: 'room-dept',
      type: 'department',
      name: 'Finance',
      isOfficial: true,
      groupId: 'group-fin',
      viewerGroupIds: ['dept-view'],
      posterGroupIds: ['dept-post'],
      allowExternalUsers: false,
      allowExternalIntegrations: true,
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  api.mockReset();
  getAuthState.mockReset();
  getAuthState.mockReturnValue({ userId: 'admin-1', roles: ['admin'] });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('ChatRoomSettingsCard', () => {
  it('shows a read-only message for non-admin users', async () => {
    getAuthState.mockReturnValue({ userId: 'user-1', roles: ['user'] });
    api.mockResolvedValue({ items: [] });

    render(<ChatRoomSettingsCard />);

    expect(screen.getByText('admin/mgmt のみ操作できます')).toBeInTheDocument();
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/chat-rooms');
    });
  });

  it('loads official rooms, formats labels, and reflects selected room settings', async () => {
    api.mockResolvedValue(ROOMS_RESPONSE);

    render(<ChatRoomSettingsCard />);

    await waitFor(() => {
      expect(screen.getByLabelText('ルーム')).toHaveValue('room-dept');
      expect(
        screen.getByRole('checkbox', { name: '外部連携を許可' }),
      ).toBeChecked();
    });

    const roomSelect = screen.getByLabelText('ルーム');
    const optionLabels = screen
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(optionLabels).toEqual([
      '(未選択)',
      'department: Finance (group-fin)',
      'project: P001 / Alpha Project',
    ]);
    expect(screen.getByText('roomId:')).toBeInTheDocument();
    expect(screen.getByText('room-dept')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: '外部ユーザ参加を許可' }),
    ).not.toBeChecked();
    expect(screen.getByLabelText('閲覧グループ')).toHaveValue('dept-view');
    expect(screen.getByLabelText('投稿グループ')).toHaveValue('dept-post');

    fireEvent.change(roomSelect, { target: { value: 'room-project' } });

    await waitFor(() => {
      expect(screen.getByText('room-project')).toBeInTheDocument();
      expect(
        screen.getByRole('checkbox', { name: '外部ユーザ参加を許可' }),
      ).toBeChecked();
    });

    expect(
      screen.getByRole('checkbox', { name: '外部連携を許可' }),
    ).not.toBeChecked();
    expect(screen.getByLabelText('閲覧グループ')).toHaveValue('view-a, view-b');
    expect(screen.getByLabelText('投稿グループ')).toHaveValue('post-a');
  });

  it('saves room settings with normalized group ids and reloads', async () => {
    let loadCount = 0;
    api.mockImplementation((path: string) => {
      if (path === '/chat-rooms') {
        loadCount += 1;
        return Promise.resolve({ items: [ROOMS_RESPONSE.items[0]] });
      }
      if (path === '/chat-rooms/room-project') {
        return Promise.resolve({});
      }
      throw new Error(`unexpected path: ${path}`);
    });

    render(<ChatRoomSettingsCard />);

    await waitFor(() => {
      expect(screen.getByLabelText('ルーム')).toHaveValue('room-project');
      expect(
        screen.getByRole('checkbox', { name: '外部ユーザ参加を許可' }),
      ).toBeChecked();
      expect(
        screen.getByRole('checkbox', { name: '外部連携を許可' }),
      ).not.toBeChecked();
    });

    fireEvent.click(
      screen.getByRole('checkbox', { name: '外部ユーザ参加を許可' }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: '外部連携を許可' }));
    fireEvent.change(screen.getByLabelText('閲覧グループ'), {
      target: { value: ' group-1, group-2 ,, ' },
    });
    fireEvent.change(screen.getByLabelText('投稿グループ'), {
      target: { value: ' group-3 ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/chat-rooms/room-project', {
        method: 'PATCH',
        body: JSON.stringify({
          allowExternalUsers: false,
          allowExternalIntegrations: true,
          viewerGroupIds: ['group-1', 'group-2'],
          posterGroupIds: ['group-3'],
        }),
      });
    });

    expect(loadCount).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('保存しました')).toBeInTheDocument();
  });

  it('validates member input and adds members when user ids are provided', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/chat-rooms') {
        return Promise.resolve({ items: [ROOMS_RESPONSE.items[0]] });
      }
      if (path === '/chat-rooms/room-project/members') {
        return Promise.resolve({});
      }
      throw new Error(`unexpected path: ${path}`);
    });

    render(<ChatRoomSettingsCard />);

    await waitFor(() => {
      expect(screen.getByLabelText('ルーム')).toHaveValue('room-project');
    });

    fireEvent.click(screen.getByRole('button', { name: 'メンバー追加' }));
    expect(
      screen.getByText('追加するユーザIDを入力してください'),
    ).toBeInTheDocument();

    const memberInput = screen.getByLabelText('userId（comma separated）');
    fireEvent.change(memberInput, {
      target: { value: ' user-a , user-b ,, ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'メンバー追加' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/chat-rooms/room-project/members', {
        method: 'POST',
        body: JSON.stringify({ userIds: ['user-a', 'user-b'] }),
      });
    });

    expect(memberInput).toHaveValue('');
    expect(screen.getByText('メンバーを追加しました')).toBeInTheDocument();
  });

  it('shows load and save errors', async () => {
    let loadCount = 0;
    api.mockImplementation((path: string) => {
      if (path === '/chat-rooms') {
        loadCount += 1;
        if (loadCount === 1) {
          return Promise.reject(new Error('load failed'));
        }
        return Promise.resolve({ items: [ROOMS_RESPONSE.items[0]] });
      }
      if (path === '/chat-rooms/room-project') {
        return Promise.reject(new Error('save failed'));
      }
      throw new Error(`unexpected path: ${path}`);
    });

    render(<ChatRoomSettingsCard />);

    await waitFor(() => {
      expect(
        screen.getByText('ルーム一覧の取得に失敗しました'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '再読込' }));

    await waitFor(() => {
      expect(screen.getByLabelText('ルーム')).toHaveValue('room-project');
    });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(screen.getByText('保存に失敗しました')).toBeInTheDocument();
    });
  });
});

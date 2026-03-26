import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('../api', () => ({ api }));

import { ChatSettingsCard } from './ChatSettingsCard';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  api.mockReset();
});

describe('ChatSettingsCard', () => {
  it('loads settings, clamps numeric inputs, and saves', async () => {
    api
      .mockResolvedValueOnce({
        id: 'chat-setting-1',
        allowUserPrivateGroupCreation: false,
        allowDmCreation: true,
        ackMaxRequiredUsers: 80,
        ackMaxRequiredGroups: 25,
        ackMaxRequiredRoles: 5,
      })
      .mockResolvedValueOnce({ id: 'chat-setting-1' });

    render(<ChatSettingsCard />);

    await waitFor(() => {
      expect(
        screen.getByRole('checkbox', {
          name: 'user/hr の private_group 作成を許可',
        }),
      ).not.toBeChecked();
    });

    const allowPrivateGroups = screen.getByRole('checkbox', {
      name: 'user/hr の private_group 作成を許可',
    });
    const allowDmCreation = screen.getByRole('checkbox', {
      name: 'DM 作成を許可',
    });
    const ackUsers = screen.getByRole('spinbutton', {
      name: 'ack required 最大対象者数',
    });
    const ackGroups = screen.getByRole('spinbutton', {
      name: '最大グループ数',
    });
    const ackRoles = screen.getByRole('spinbutton', { name: '最大ロール数' });

    fireEvent.click(allowPrivateGroups);
    fireEvent.click(allowDmCreation);
    fireEvent.change(ackUsers, { target: { value: '999' } });
    fireEvent.change(ackGroups, { target: { value: '0' } });
    fireEvent.change(ackRoles, { target: { value: '7.8' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(api).toHaveBeenNthCalledWith(2, '/chat-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowUserPrivateGroupCreation: true,
          allowDmCreation: false,
          ackMaxRequiredUsers: 200,
          ackMaxRequiredGroups: 1,
          ackMaxRequiredRoles: 7,
        }),
      });
    });

    expect(screen.getByText('保存しました')).toBeInTheDocument();
  });

  it('shows an error when loading fails and can reload defaults', async () => {
    api
      .mockRejectedValueOnce(new Error('load failed'))
      .mockResolvedValueOnce({ id: 'chat-setting-1' });

    render(<ChatSettingsCard />);

    await waitFor(() => {
      expect(
        screen.getByText('チャット設定の取得に失敗しました'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '再読込' }));

    await waitFor(() => {
      expect(api).toHaveBeenNthCalledWith(2, '/chat-settings');
    });

    expect(
      screen.getByRole('checkbox', {
        name: 'user/hr の private_group 作成を許可',
      }),
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', { name: 'DM 作成を許可' }),
    ).toBeChecked();
    expect(
      screen.getByRole('spinbutton', { name: 'ack required 最大対象者数' }),
    ).toHaveValue(50);
    expect(
      screen.getByRole('spinbutton', { name: '最大グループ数' }),
    ).toHaveValue(20);
    expect(
      screen.getByRole('spinbutton', { name: '最大ロール数' }),
    ).toHaveValue(20);
  });

  it('shows an error when save fails', async () => {
    api
      .mockResolvedValueOnce({ id: 'chat-setting-1' })
      .mockRejectedValueOnce(new Error('save failed'));

    render(<ChatSettingsCard />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/chat-settings');
    });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(screen.getByText('保存に失敗しました')).toBeInTheDocument();
    });
  });
});

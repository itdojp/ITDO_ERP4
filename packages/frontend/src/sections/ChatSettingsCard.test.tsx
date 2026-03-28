import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock('../api', () => ({ api }));

import { ChatSettingsCard } from './ChatSettingsCard';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  api.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('ChatSettingsCard', () => {
  it('loads defaults on mount and applies fetched values on reload', async () => {
    api.mockResolvedValueOnce({ id: 'chat-settings-1' }).mockResolvedValueOnce({
      id: 'chat-settings-1',
      allowUserPrivateGroupCreation: false,
      allowDmCreation: false,
      ackMaxRequiredUsers: 12,
      ackMaxRequiredGroups: 34,
      ackMaxRequiredRoles: 56,
    });

    render(<ChatSettingsCard />);

    await waitFor(() => {
      expect(
        screen.getByRole('checkbox', {
          name: 'user/hr の private_group 作成を許可',
        }),
      ).toBeChecked();
    });
    expect(
      screen.getByRole('checkbox', { name: 'DM 作成を許可' }),
    ).toBeChecked();
    expect(
      screen.getByRole('spinbutton', {
        name: 'ack required 最大対象者数',
      }),
    ).toHaveValue(50);
    expect(
      screen.getByRole('spinbutton', { name: '最大グループ数' }),
    ).toHaveValue(20);
    expect(
      screen.getByRole('spinbutton', { name: '最大ロール数' }),
    ).toHaveValue(20);

    fireEvent.click(screen.getByRole('button', { name: '再読込' }));

    await waitFor(() => {
      expect(
        screen.getByRole('checkbox', {
          name: 'user/hr の private_group 作成を許可',
        }),
      ).not.toBeChecked();
    });
    expect(
      screen.getByRole('checkbox', { name: 'DM 作成を許可' }),
    ).not.toBeChecked();
    expect(
      screen.getByRole('spinbutton', {
        name: 'ack required 最大対象者数',
      }),
    ).toHaveValue(12);
    expect(
      screen.getByRole('spinbutton', { name: '最大グループ数' }),
    ).toHaveValue(34);
    expect(
      screen.getByRole('spinbutton', { name: '最大ロール数' }),
    ).toHaveValue(56);
  });

  it('clamps numeric inputs to the 1..200 range', async () => {
    api.mockResolvedValueOnce({ id: 'chat-settings-1' });

    render(<ChatSettingsCard />);

    await waitFor(() => {
      expect(
        screen.getByRole('spinbutton', {
          name: 'ack required 最大対象者数',
        }),
      ).toHaveValue(50);
    });

    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'ack required 最大対象者数',
      }),
      { target: { value: '0' } },
    );
    fireEvent.change(
      screen.getByRole('spinbutton', { name: '最大グループ数' }),
      {
        target: { value: '201' },
      },
    );
    fireEvent.change(screen.getByRole('spinbutton', { name: '最大ロール数' }), {
      target: { value: '199.8' },
    });

    expect(
      screen.getByRole('spinbutton', {
        name: 'ack required 最大対象者数',
      }),
    ).toHaveValue(1);
    expect(
      screen.getByRole('spinbutton', { name: '最大グループ数' }),
    ).toHaveValue(200);
    expect(
      screen.getByRole('spinbutton', { name: '最大ロール数' }),
    ).toHaveValue(199);
  });

  it('sends the expected PATCH payload on save', async () => {
    api
      .mockResolvedValueOnce({ id: 'chat-settings-1' })
      .mockResolvedValueOnce({ id: 'chat-settings-1' });

    render(<ChatSettingsCard />);

    await waitFor(() => {
      expect(
        screen.getByRole('spinbutton', {
          name: 'ack required 最大対象者数',
        }),
      ).toHaveValue(50);
    });

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'user/hr の private_group 作成を許可',
      }),
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'DM 作成を許可' }));
    fireEvent.change(
      screen.getByRole('spinbutton', {
        name: 'ack required 最大対象者数',
      }),
      { target: { value: '7' } },
    );
    fireEvent.change(
      screen.getByRole('spinbutton', { name: '最大グループ数' }),
      {
        target: { value: '8' },
      },
    );
    fireEvent.change(screen.getByRole('spinbutton', { name: '最大ロール数' }), {
      target: { value: '9' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(api).toHaveBeenNthCalledWith(2, '/chat-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allowUserPrivateGroupCreation: false,
          allowDmCreation: false,
          ackMaxRequiredUsers: 7,
          ackMaxRequiredGroups: 8,
          ackMaxRequiredRoles: 9,
        }),
      });
    });

    expect(screen.getByText('保存しました')).toBeInTheDocument();
  });

  it('shows an error when initial load fails', async () => {
    api.mockRejectedValueOnce(new Error('load failed'));

    render(<ChatSettingsCard />);

    await waitFor(() => {
      expect(
        screen.getByText('チャット設定の取得に失敗しました'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole('spinbutton', { name: 'ack required 最大対象者数' }),
    ).toHaveValue(50);
  });

  it('shows an error when save fails', async () => {
    api
      .mockResolvedValueOnce({ id: 'chat-settings-1' })
      .mockRejectedValueOnce(new Error('save failed'));

    render(<ChatSettingsCard />);

    await waitFor(() => {
      expect(
        screen.getByRole('spinbutton', {
          name: 'ack required 最大対象者数',
        }),
      ).toHaveValue(50);
    });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(screen.getByText('保存に失敗しました')).toBeInTheDocument();
    });
  });
});

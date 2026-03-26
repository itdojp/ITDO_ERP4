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

import { WorklogSettingsCard } from './WorklogSettingsCard';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  api.mockReset();
});

describe('WorklogSettingsCard', () => {
  it('loads settings, normalizes input on blur, and saves', async () => {
    api
      .mockResolvedValueOnce({ id: 'worklog-setting-1', editableDays: 30 })
      .mockResolvedValueOnce({ id: 'worklog-setting-1' });

    render(<WorklogSettingsCard />);

    const input = await screen.findByRole('spinbutton', { name: '期間（日）' });
    expect(input).toHaveValue(30);

    fireEvent.change(input, { target: { value: '999.8' } });
    fireEvent.blur(input);
    expect(input).toHaveValue(365);

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(api).toHaveBeenNthCalledWith(2, '/worklog-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editableDays: 365 }),
      });
    });

    expect(screen.getByText('保存しました')).toBeInTheDocument();
  });

  it('validates invalid input without calling save', async () => {
    api.mockResolvedValueOnce({ id: 'worklog-setting-1' });

    render(<WorklogSettingsCard />);

    const input = await screen.findByRole('spinbutton', { name: '期間（日）' });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(
      screen.getByText('1〜365 の数値を入力してください'),
    ).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('shows load and save errors', async () => {
    api
      .mockRejectedValueOnce(new Error('load failed'))
      .mockResolvedValueOnce({ id: 'worklog-setting-1', editableDays: 14 })
      .mockRejectedValueOnce(new Error('save failed'));

    render(<WorklogSettingsCard />);

    await waitFor(() => {
      expect(
        screen.getByText('日報/工数設定の取得に失敗しました'),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '再読込' }));

    await waitFor(() => {
      expect(
        screen.getByRole('spinbutton', { name: '期間（日）' }),
      ).toHaveValue(14);
    });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(screen.getByText('保存に失敗しました')).toBeInTheDocument();
    });
  });
});

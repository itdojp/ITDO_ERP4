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

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

afterEach(() => {
  cleanup();
  consoleErrorSpy.mockRestore();
});

beforeEach(() => {
  api.mockReset();
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('WorklogSettingsCard', () => {
  it('loads the initial editable days value', async () => {
    api.mockResolvedValueOnce({ id: 'worklog-setting-1', editableDays: 30 });

    render(<WorklogSettingsCard />);

    const input = screen.getByRole('spinbutton', { name: '期間（日）' });

    await waitFor(() => {
      expect(input).toHaveValue(30);
    });
    expect(api).toHaveBeenCalledWith('/worklog-settings');
  });

  it('normalizes editable days to the 1..365 range on blur', async () => {
    api.mockResolvedValueOnce({ id: 'worklog-setting-1', editableDays: 14 });

    render(<WorklogSettingsCard />);

    const input = screen.getByRole('spinbutton', { name: '期間（日）' });
    await waitFor(() => {
      expect(input).toHaveValue(14);
    });

    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(input).toHaveValue(1);
    });

    fireEvent.change(input, { target: { value: '999.8' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(input).toHaveValue(365);
    });
  });

  it('sends the normalized PATCH payload when saving', async () => {
    api
      .mockResolvedValueOnce({ id: 'worklog-setting-1', editableDays: 30 })
      .mockResolvedValueOnce({ id: 'worklog-setting-1' });

    render(<WorklogSettingsCard />);

    const input = screen.getByRole('spinbutton', { name: '期間（日）' });
    await waitFor(() => {
      expect(input).toHaveValue(30);
    });

    fireEvent.change(input, { target: { value: '999.8' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(input).toHaveValue(365);
    });

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

  it('shows an error when loading fails', async () => {
    api.mockRejectedValueOnce(new Error('load failed'));

    render(<WorklogSettingsCard />);

    await waitFor(() => {
      expect(
        screen.getByText('日報/工数設定の取得に失敗しました'),
      ).toBeInTheDocument();
    });

    expect(api).toHaveBeenCalledTimes(1);
  });

  it('shows an error when saving fails', async () => {
    api
      .mockResolvedValueOnce({ id: 'worklog-setting-1', editableDays: 14 })
      .mockRejectedValueOnce(new Error('save failed'));

    render(<WorklogSettingsCard />);

    const input = screen.getByRole('spinbutton', { name: '期間（日）' });

    await waitFor(() => {
      expect(input).toHaveValue(14);
    });

    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(screen.getByText('保存に失敗しました')).toBeInTheDocument();
    });

    expect(api).toHaveBeenCalledTimes(2);
  });
});

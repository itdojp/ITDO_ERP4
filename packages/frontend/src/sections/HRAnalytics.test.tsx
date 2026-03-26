import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({
  api: vi.fn(),
}));

vi.mock('../api', () => ({ api }));
vi.mock('../ui', () => ({
  DateRangePicker: ({
    fromLabel,
    toLabel,
    value,
    onChange,
  }: {
    fromLabel: string;
    toLabel: string;
    value: { from?: string; to?: string };
    onChange: (next: { from?: string; to?: string }) => void;
  }) => (
    <div>
      <label>
        {fromLabel}
        <input
          aria-label={fromLabel}
          value={value.from ?? ''}
          onChange={(event) => onChange({ ...value, from: event.target.value })}
        />
      </label>
      <label>
        {toLabel}
        <input
          aria-label={toLabel}
          value={value.to ?? ''}
          onChange={(event) => onChange({ ...value, to: event.target.value })}
        />
      </label>
    </div>
  ),
}));

import { HRAnalytics } from './HRAnalytics';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockAnalyticsApi() {
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path === '/wellbeing-analytics?minUsers=5&groupBy=group') {
      return {
        items: [
          {
            bucket: 'sales',
            users: 8,
            entries: 20,
            notGoodCount: 3,
            notGoodRate: 0.15,
            helpRequestedCount: 1,
          },
        ],
      } as never;
    }
    if (
      path ===
      '/wellbeing-analytics?minUsers=5&groupBy=month&visibilityGroupId=sales'
    ) {
      return {
        items: [
          {
            bucket: '2026-03',
            users: 8,
            entries: 20,
            notGoodCount: 2,
            notGoodRate: 0.1,
            helpRequestedCount: 1,
          },
        ],
      } as never;
    }
    throw new Error(`Unhandled api path: ${path}`);
  });
}

function findGroupRow(label: string) {
  return screen.queryAllByRole('listitem').find((item) => {
    const text = item.textContent ?? '';
    return (
      text.includes(label) && text.includes('人)') && text.includes('Not Good:')
    );
  });
}

function findMonthlyRow(label: string) {
  return screen.queryAllByRole('listitem').find((item) => {
    const text = item.textContent ?? '';
    return (
      text.includes(label) &&
      text.includes('Not Good:') &&
      !text.includes('人)')
    );
  });
}

function getGroupUpdateButton() {
  const groupControls = screen
    .getByLabelText('閾値')
    .closest('label')?.parentElement;
  if (!groupControls) {
    throw new Error('group controls not found');
  }
  return within(groupControls).getByRole('button', { name: '更新' });
}

function getMonthlyUpdateButton() {
  const monthlyControls = screen.getByText('時系列').parentElement;
  if (!monthlyControls) {
    throw new Error('monthly controls not found');
  }
  return within(monthlyControls).getByRole('button', { name: '更新' });
}

describe('HRAnalytics', () => {
  it('loads group and monthly analytics on initial render', async () => {
    mockAnalyticsApi();

    render(<HRAnalytics />);

    await waitFor(() => {
      expect(findGroupRow('sales')).toHaveTextContent('15.0%');
    });
    expect(screen.getByRole('option', { name: 'sales' })).toBeInTheDocument();
    await waitFor(() => {
      expect(findMonthlyRow('2026-03')).toHaveTextContent('10.0%');
    });
    expect(api).toHaveBeenCalledWith(
      '/wellbeing-analytics?minUsers=5&groupBy=group',
    );
    expect(api).toHaveBeenCalledWith(
      '/wellbeing-analytics?minUsers=5&groupBy=month&visibilityGroupId=sales',
    );
  });

  it('shows a validation error and skips reload when the range is invalid', async () => {
    mockAnalyticsApi();

    render(<HRAnalytics />);

    await waitFor(() => {
      expect(findGroupRow('sales')).toBeInTheDocument();
    });
    vi.mocked(api).mockClear();

    fireEvent.change(screen.getByLabelText('開始日'), {
      target: { value: '2026-04-01' },
    });
    fireEvent.change(screen.getByLabelText('終了日'), {
      target: { value: '2026-03-01' },
    });
    fireEvent.click(getGroupUpdateButton());

    expect(
      await screen.findByText('開始日は終了日以前にしてください'),
    ).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it('normalizes the minimum user threshold to 1 before reloading', async () => {
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/wellbeing-analytics?minUsers=5&groupBy=group') {
        return { items: [] } as never;
      }
      if (path === '/wellbeing-analytics?minUsers=1&groupBy=group') {
        return { items: [] } as never;
      }
      throw new Error(`Unhandled api path: ${path}`);
    });

    render(<HRAnalytics />);

    await screen.findByText('表示可能なデータなし');
    vi.mocked(api).mockClear();

    fireEvent.change(screen.getByLabelText('閾値'), {
      target: { value: '0' },
    });
    fireEvent.click(getGroupUpdateButton());

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/wellbeing-analytics?minUsers=1&groupBy=group',
      );
    });
    expect(screen.getByText('1人未満は非表示')).toBeInTheDocument();
  });

  it('shows retryable errors for group and monthly loads', async () => {
    vi.mocked(api)
      .mockRejectedValueOnce(new Error('group failure'))
      .mockResolvedValueOnce({
        items: [
          {
            bucket: 'sales',
            users: 8,
            entries: 20,
            notGoodCount: 3,
            notGoodRate: 0.15,
            helpRequestedCount: 1,
          },
        ],
      })
      .mockRejectedValueOnce(new Error('monthly failure'))
      .mockResolvedValueOnce({ items: [] });

    render(<HRAnalytics />);

    expect(
      await screen.findByText('匿名集計の取得に失敗しました'),
    ).toBeInTheDocument();

    fireEvent.click(getGroupUpdateButton());
    await waitFor(() => {
      expect(findGroupRow('sales')).toHaveTextContent('15.0%');
    });
    expect(
      await screen.findByText('時系列集計の取得に失敗しました'),
    ).toBeInTheDocument();

    fireEvent.click(getMonthlyUpdateButton());
    expect(await screen.findByText('表示可能なデータなし')).toBeInTheDocument();
  });
});

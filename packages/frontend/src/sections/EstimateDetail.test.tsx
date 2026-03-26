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

import { EstimateDetail } from './EstimateDetail';

beforeEach(() => {
  api.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('EstimateDetail', () => {
  it('loads and renders send logs', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      items: [
        {
          id: 'log-1',
          channel: 'email',
          status: 'sent',
          createdAt: '2026-03-27T00:00:00.000Z',
          error: null,
        },
      ],
    });

    render(
      <EstimateDetail
        id="estimate-1"
        estimateNo="EST-001"
        projectId="project-1"
        status="approved"
        totalAmount={120000}
        currency="JPY"
        validUntil="2026-04-01T00:00:00.000Z"
        notes="顧客向けメモ"
        lines={[
          { description: '基本料', quantity: 2, unitPrice: 10000 },
          { description: '追加費用', quantity: 1, unitPrice: 5000 },
        ]}
        approval={{ step: 2, total: 3, status: 'pending' }}
      />,
    );

    expect(
      await screen.findByText(
        (_, element) =>
          element?.tagName === 'LI' && element.textContent?.includes('email /'),
      ),
    ).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/estimates/estimate-1/send-logs');
    expect(
      screen.getByText((_, element) => element?.textContent === 'No: EST-001'),
    ).toBeInTheDocument();
    expect(screen.getByText('基本料')).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'TD' &&
          element.textContent?.replace(/[^\d]/g, '') === '20000',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Valid until: 2026-04-01')).toBeInTheDocument();
    expect(screen.getByText('Notes: 顧客向けメモ')).toBeInTheDocument();
    expect(screen.getByText('承認 2/3 : pending')).toBeInTheDocument();
    expect(screen.getByText(/sent/)).toBeInTheDocument();
  });

  it('shows send log error and retries reload', async () => {
    vi.mocked(api)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        items: [
          {
            id: 'log-2',
            channel: 'slack',
            status: 'queued',
            createdAt: '2026-03-27T02:00:00.000Z',
            error: 'delivery failed',
          },
        ],
      });

    render(
      <EstimateDetail
        id="estimate-2"
        projectId="project-2"
        status="sent"
        totalAmount={3000}
        currency="JPY"
      />,
    );

    expect(
      await screen.findByText('送信履歴の取得に失敗しました'),
    ).toBeInTheDocument();
    expect(screen.queryByText('履歴なし')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '更新' }));

    await waitFor(() => {
      expect(api).toHaveBeenLastCalledWith('/estimates/estimate-2/send-logs');
    });

    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'LI' && element.textContent?.includes('slack /'),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) => element?.textContent === 'Error: delivery failed',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/queued/)).toBeInTheDocument();
  });

  it('renders empty state and send action according to props', async () => {
    const onSend = vi.fn();
    vi.mocked(api).mockResolvedValueOnce({ items: [] });

    render(
      <EstimateDetail
        id="estimate-3"
        estimateNo={undefined}
        projectId="project-3"
        status="approved"
        totalAmount={0}
        currency="JPY"
        onSend={onSend}
      />,
    );

    expect(await screen.findByText('履歴なし')).toBeInTheDocument();
    expect(screen.getByText('No: (draft)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '送信 (Stub)' }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('disables send action when not sendable', async () => {
    vi.mocked(api).mockResolvedValueOnce({ items: [] });

    const { rerender } = render(
      <EstimateDetail
        id="estimate-4"
        projectId="project-4"
        status="draft"
        totalAmount={5000}
        currency="JPY"
        onSend={vi.fn()}
      />,
    );

    expect(await screen.findByText('履歴なし')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '送信 (Stub)' })).toBeDisabled();

    rerender(
      <EstimateDetail
        id="estimate-4"
        projectId="project-4"
        status="approved"
        totalAmount={5000}
        currency="JPY"
      />,
    );

    expect(screen.getByRole('button', { name: '送信 (Stub)' })).toBeDisabled();
  });
});

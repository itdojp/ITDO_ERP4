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

import { InvoiceDetail } from './InvoiceDetail';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('InvoiceDetail', () => {
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
      <InvoiceDetail
        id="invoice-1"
        invoiceNo="INV-001"
        projectId="project-1"
        status="approved"
        paidAt={null}
        paidBy={null}
        totalAmount={120000}
        lines={[
          { description: '基本料', quantity: 2, unitPrice: 10000 },
          { description: '追加費用', quantity: 1, unitPrice: 5000 },
        ]}
        approval={{ step: 2, total: 3, status: 'pending' }}
      />,
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/invoices/invoice-1/send-logs');
    });

    expect(
      screen.getByText((_, element) => element?.textContent === 'No: INV-001'),
    ).toBeInTheDocument();
    expect(screen.getByText('基本料')).toBeInTheDocument();
    expect(screen.getByText('¥20,000')).toBeInTheDocument();
    expect(screen.getByText('承認 2/3 : pending')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
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
      <InvoiceDetail
        id="invoice-2"
        projectId="project-2"
        status="sent"
        paidAt="2026-03-28T00:00:00.000Z"
        paidBy="finance-user"
        totalAmount={3000}
      />,
    );

    expect(
      await screen.findByText('送信履歴の取得に失敗しました'),
    ).toBeInTheDocument();
    expect(screen.queryByText('履歴なし')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '更新' }));

    await waitFor(() => {
      expect(api).toHaveBeenLastCalledWith('/invoices/invoice-2/send-logs');
    });

    expect(screen.getByText('slack')).toBeInTheDocument();
    expect(screen.getByText('Error: delivery failed')).toBeInTheDocument();
    expect(screen.getAllByText(/2026/).length).toBeGreaterThanOrEqual(2);
  });

  it('renders empty state and action buttons according to props', async () => {
    const onSend = vi.fn();
    const onMarkPaid = vi.fn();
    vi.mocked(api).mockResolvedValueOnce({ items: [] });

    render(
      <InvoiceDetail
        id="invoice-3"
        invoiceNo={undefined}
        projectId="project-3"
        status="approved"
        paidAt={null}
        paidBy={null}
        totalAmount={0}
        onSend={onSend}
        onMarkPaid={onMarkPaid}
        canMarkPaid
      />,
    );

    expect(await screen.findByText('履歴なし')).toBeInTheDocument();
    expect(screen.getByText('No: (draft)')).toBeInTheDocument();
    expect(screen.getByText('Paid: -')).toBeInTheDocument();
    expect(screen.getByText('Paid By: -')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '送信 (Stub)' }));
    fireEvent.click(screen.getByRole('button', { name: '入金確認' }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onMarkPaid).toHaveBeenCalledTimes(1);
  });

  it('does not show mark-paid action when already paid or disabled', async () => {
    vi.mocked(api).mockResolvedValue({ items: [] });

    const { rerender } = render(
      <InvoiceDetail
        id="invoice-4"
        projectId="project-4"
        status="paid"
        paidAt="2026-03-29T00:00:00.000Z"
        paidBy="finance-user"
        totalAmount={5000}
        canMarkPaid
      />,
    );

    expect(await screen.findByText('履歴なし')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '入金確認' }),
    ).not.toBeInTheDocument();

    rerender(
      <InvoiceDetail
        id="invoice-4"
        projectId="project-4"
        status="approved"
        paidAt={null}
        paidBy={null}
        totalAmount={5000}
        canMarkPaid={false}
      />,
    );

    expect(
      screen.queryByRole('button', { name: '入金確認' }),
    ).not.toBeInTheDocument();
  });
});

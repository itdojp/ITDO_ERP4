import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api, getAuthState, navigateToOpen } = vi.hoisted(() => ({
  api: vi.fn(),
  getAuthState: vi.fn(),
  navigateToOpen: vi.fn(),
}));

vi.mock('../api', () => ({ api, getAuthState }));
vi.mock('../utils/deepLink', () => ({ navigateToOpen }));

import { GlobalSearch } from './GlobalSearch';

const successfulErpResult = {
  query: 'AB',
  projects: [{ id: 'pj-1', code: 'PJ-001', name: 'Alpha', status: 'active' }],
  invoices: [
    {
      id: 'inv-1',
      invoiceNo: 'INV-001',
      status: 'draft',
      totalAmount: 120000,
      currency: 'JPY',
      projectId: 'pj-1',
      project: { code: 'PJ-001', name: 'Alpha' },
    },
  ],
  estimates: [
    {
      id: 'est-1',
      estimateNo: null,
      status: 'sent',
      totalAmount: 50000,
      currency: 'JPY',
      projectId: 'pj-2',
      notes: 'note '.repeat(50),
      project: null,
    },
  ],
  expenses: [],
  timeEntries: [],
  purchaseOrders: [],
  vendorQuotes: [],
  vendorInvoices: [],
};

const successfulChatResult = {
  items: [
    {
      id: 'msg-1',
      roomId: 'room-1',
      userId: 'user-b',
      body: 'message body '.repeat(20),
      createdAt: '2026-03-26T10:00:00.000Z',
      room: {
        id: 'room-1',
        type: 'dm',
        name: 'dm:user-a:user-b',
      },
    },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuthState).mockReturnValue({
    token: 'token',
    userId: 'user-a',
    roles: ['member'],
  });
});

afterEach(() => {
  cleanup();
});

describe('GlobalSearch', () => {
  it('shows validation and does not call api when query is shorter than two chars', async () => {
    render(<GlobalSearch />);

    fireEvent.change(screen.getByLabelText('検索語'), {
      target: { value: 'a' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    expect(
      await screen.findByText('検索語は2文字以上で入力してください'),
    ).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it('loads ERP and chat results and opens the selected chat room', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(successfulErpResult)
      .mockResolvedValueOnce(successfulChatResult);

    render(<GlobalSearch />);

    fireEvent.change(screen.getByLabelText('検索語'), {
      target: { value: '  AB  ' },
    });
    fireEvent.change(screen.getByLabelText('取得件数/種別'), {
      target: { value: '12' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    await screen.findByText('PJ-001 / Alpha');
    expect(screen.getByText('INV-001')).toBeInTheDocument();
    expect(screen.getByText('Projects 1')).toBeInTheDocument();
    expect(screen.getByText('Chat 1')).toBeInTheDocument();
    expect(screen.getByText('user-b')).toBeInTheDocument();
    expect(screen.queryByText('dm:user-a:user-b')).not.toBeInTheDocument();
    expect(screen.getByText('pj-2')).toBeInTheDocument();

    expect(vi.mocked(api)).toHaveBeenNthCalledWith(1, '/search?q=AB&limit=12');
    expect(vi.mocked(api)).toHaveBeenNthCalledWith(
      2,
      '/chat-messages/search?q=AB&limit=12',
    );

    fireEvent.click(screen.getByRole('button', { name: '開く' }));
    expect(navigateToOpen).toHaveBeenCalledWith({
      kind: 'room_chat',
      id: 'room-1',
    });
  });

  it('clears the query, message, and existing results', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(successfulErpResult)
      .mockResolvedValueOnce(successfulChatResult);

    render(<GlobalSearch />);

    fireEvent.change(screen.getByLabelText('検索語'), {
      target: { value: 'AB' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    await screen.findByText('PJ-001 / Alpha');
    expect(screen.getByText('Projects 1')).toBeInTheDocument();
    expect(screen.getByText('Chat 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'クリア' }));

    expect(screen.getByLabelText('検索語')).toHaveValue('');
    expect(screen.queryByText('PJ-001 / Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Projects 0')).toBeInTheDocument();
    expect(screen.getByText('Chat 0')).toBeInTheDocument();
    expect(screen.queryByText('検索に失敗しました')).not.toBeInTheDocument();
  });

  it('clears existing results when ERP search fails after a successful search', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(successfulErpResult)
      .mockResolvedValueOnce(successfulChatResult)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ items: [] });

    render(<GlobalSearch />);

    fireEvent.change(screen.getByLabelText('検索語'), {
      target: { value: 'AB' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    await screen.findByText('PJ-001 / Alpha');
    expect(screen.getByText('Projects 1')).toBeInTheDocument();
    expect(screen.getByText('Chat 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    expect(await screen.findByText('検索に失敗しました')).toBeInTheDocument();
    expect(screen.queryByText('PJ-001 / Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Projects 0')).toBeInTheDocument();
    expect(screen.getByText('Chat 0')).toBeInTheDocument();
  });

  it('clears existing results when chat search fails after a successful search', async () => {
    vi.mocked(api)
      .mockResolvedValueOnce(successfulErpResult)
      .mockResolvedValueOnce(successfulChatResult)
      .mockResolvedValueOnce(successfulErpResult)
      .mockRejectedValueOnce(new Error('boom'));

    render(<GlobalSearch />);

    fireEvent.change(screen.getByLabelText('検索語'), {
      target: { value: 'AB' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    await screen.findByText('PJ-001 / Alpha');
    expect(screen.getByText('Projects 1')).toBeInTheDocument();
    expect(screen.getByText('Chat 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    expect(await screen.findByText('検索に失敗しました')).toBeInTheDocument();
    expect(screen.queryByText('PJ-001 / Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Projects 0')).toBeInTheDocument();
    expect(screen.getByText('Chat 0')).toBeInTheDocument();
  });

  it('focuses the input when the global focus event is fired', async () => {
    render(<GlobalSearch />);

    const input = screen.getByLabelText('検索語');
    expect(input).not.toHaveFocus();

    window.dispatchEvent(new Event('erp4_global_search_focus'));

    await waitFor(() => {
      expect(input).toHaveFocus();
    });
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api, apiResponse, downloadResponseAsFile, formatDateForFilename } =
  vi.hoisted(() => ({
    api: vi.fn(),
    apiResponse: vi.fn(),
    downloadResponseAsFile: vi.fn(),
    formatDateForFilename: vi.fn(() => '20260326-120000'),
  }));

vi.mock('../api', () => ({ api, apiResponse }));
vi.mock('../utils/download', () => ({
  downloadResponseAsFile,
  formatDateForFilename,
}));

vi.mock('../ui', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AsyncStatePanel: ({
    state,
    loadingText,
    error,
    empty,
  }: {
    state: string;
    loadingText?: string;
    error?: {
      title: string;
      detail?: string;
      onRetry?: () => void;
      retryLabel?: string;
    };
    empty?: { title: string; description?: string };
  }) => (
    <div>
      <div>{state}</div>
      {loadingText ? <div>{loadingText}</div> : null}
      {error ? (
        <>
          <div>{error.title}</div>
          {error.detail ? <div>{error.detail}</div> : null}
          {error.onRetry ? (
            <button type="button" onClick={error.onRetry}>
              {error.retryLabel ?? '再試行'}
            </button>
          ) : null}
        </>
      ) : null}
      {empty ? (
        <>
          <div>{empty.title}</div>
          {empty.description ? <div>{empty.description}</div> : null}
        </>
      ) : null}
    </div>
  ),
  Button: ({
    children,
    loading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => (
    <button type="button" {...props}>
      {loading ? 'loading' : children}
    </button>
  ),
  Card: ({ children }: { children: React.ReactNode }) => (
    <section>{children}</section>
  ),
  CrudList: ({
    title,
    description,
    filters,
    table,
  }: {
    title: string;
    description: string;
    filters: React.ReactNode;
    table: React.ReactNode;
  }) => (
    <section>
      <h3>{title}</h3>
      <p>{description}</p>
      <div>{filters}</div>
      <div>{table}</div>
    </section>
  ),
  DataTable: ({
    columns,
    rows,
  }: {
    columns: Array<{
      key: string;
      header: string;
      cell?: (row: Record<string, unknown>) => React.ReactNode;
    }>;
    rows: Array<Record<string, unknown> & { id: string }>;
  }) => (
    <div>
      <div>{columns.map((column) => column.header).join(',')}</div>
      {rows.map((row) => (
        <div key={row.id} data-testid={`row-${row.id}`}>
          {columns.map((column) => (
            <div key={`${row.id}-${column.key}`}>
              {column.cell ? column.cell(row) : String(row[column.key] ?? '')}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
  FilterBar: ({
    children,
    actions,
  }: {
    children: React.ReactNode;
    actions?: React.ReactNode;
  }) => (
    <div>
      <div>{children}</div>
      <div>{actions}</div>
    </div>
  ),
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

import { AccessReviews } from './AccessReviews';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(formatDateForFilename).mockReturnValue('20260326-123456');
});

describe('AccessReviews', () => {
  it('shows the initial empty state before loading', () => {
    render(<AccessReviews />);

    expect(screen.getByText('スナップショット未取得')).toBeInTheDocument();
    expect(
      screen.getByText('「スナップショット取得」を実行してください'),
    ).toBeInTheDocument();
    expect(screen.getByText('users: -')).toBeInTheDocument();
  });

  it('loads a snapshot, limits rows to 20, and clears state', async () => {
    vi.mocked(api).mockResolvedValue({
      users: Array.from({ length: 21 }, (_, index) => ({
        id: `user-${index + 1}`,
        userName: `user${index + 1}@example.com`,
        displayName: index === 0 ? null : `User ${index + 1}`,
        department: index === 0 ? null : '営業',
        active: index === 1 ? false : true,
      })),
      groups: [{ id: 'group-1', displayName: 'Admins', active: true }],
      memberships: [
        { userId: 'user-1', groupId: 'group-1' },
        { userId: 'user-1', groupId: 'group-2' },
      ],
    });

    render(<AccessReviews />);

    fireEvent.click(
      screen.getByRole('button', { name: 'スナップショット取得' }),
    );

    expect(await screen.findByText(/取得:/)).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/access-reviews/snapshot?format=json');
    expect(screen.getByText('users: 21')).toBeInTheDocument();
    expect(screen.getByText('groups: 1')).toBeInTheDocument();
    expect(screen.getByText('memberships: 2')).toBeInTheDocument();
    expect(screen.getByText('上位20件を表示')).toBeInTheDocument();
    expect(screen.getByText('user1@example.com')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.getByText('部門未設定')).toBeInTheDocument();
    expect(screen.getByText('inactive')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('user21@example.com')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'クリア' }));

    expect(screen.getByText('スナップショット未取得')).toBeInTheDocument();
    expect(screen.getByText('users: -')).toBeInTheDocument();
  });

  it('shows retry UI after a snapshot load failure and reloads successfully', async () => {
    vi.mocked(api)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        users: [{ id: 'user-1', userName: 'user1@example.com' }],
        groups: [],
        memberships: [],
      });

    render(<AccessReviews />);

    fireEvent.click(
      screen.getByRole('button', { name: 'スナップショット取得' }),
    );

    expect(
      await screen.findAllByText('アクセス棚卸しの取得に失敗しました'),
    ).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    expect(await screen.findByText('user1@example.com')).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('downloads csv and shows a success message', async () => {
    const response = { ok: true } as Response;
    vi.mocked(apiResponse).mockResolvedValue(response);
    vi.mocked(downloadResponseAsFile).mockResolvedValue(undefined);

    render(<AccessReviews />);

    fireEvent.click(screen.getByRole('button', { name: 'CSV出力' }));

    await waitFor(() => {
      expect(apiResponse).toHaveBeenCalledWith(
        '/access-reviews/snapshot?format=csv',
      );
    });
    expect(downloadResponseAsFile).toHaveBeenCalledWith(
      response,
      'access-review-20260326-123456.csv',
    );
    expect(await screen.findByText('CSVを出力しました')).toBeInTheDocument();
  });

  it('shows an error message when csv download fails', async () => {
    vi.mocked(apiResponse).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    render(<AccessReviews />);

    fireEvent.click(screen.getByRole('button', { name: 'CSV出力' }));

    expect(
      await screen.findByText('CSV出力に失敗しました'),
    ).toBeInTheDocument();
    expect(downloadResponseAsFile).not.toHaveBeenCalled();
  });
});

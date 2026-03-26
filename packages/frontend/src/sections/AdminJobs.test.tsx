import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api, useSavedViews, createLocalStorageSavedViewsAdapter } = vi.hoisted(
  () => ({
    api: vi.fn(),
    useSavedViews: vi.fn(),
    createLocalStorageSavedViewsAdapter: vi.fn(() => ({
      list: vi.fn(),
      save: vi.fn(),
      remove: vi.fn(),
    })),
  }),
);

vi.mock('../api', () => ({ api }));
vi.mock('../ui', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AsyncStatePanel: ({
    state,
    loadingText,
    empty,
    error,
  }: {
    state: string;
    loadingText?: string;
    empty?: { title: string; description?: string };
    error?: { title: string; detail?: string };
  }) => (
    <div>
      <div>{state}</div>
      {loadingText ? <div>{loadingText}</div> : null}
      {empty ? (
        <>
          <div>{empty.title}</div>
          {empty.description ? <div>{empty.description}</div> : null}
        </>
      ) : null}
      {error ? (
        <>
          <div>{error.title}</div>
          {error.detail ? <div>{error.detail}</div> : null}
        </>
      ) : null}
    </div>
  ),
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
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
    filters?: React.ReactNode;
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
    rowActions,
  }: {
    columns: Array<{
      key: string;
      header: string;
      cell?: (row: Record<string, unknown>) => React.ReactNode;
    }>;
    rows: Array<Record<string, unknown> & { id: string }>;
    rowActions?: Array<{
      key: string;
      label: string;
      onSelect: (row: Record<string, unknown> & { id: string }) => void;
    }>;
  }) => (
    <div>
      <div>{columns.map((column) => column.header).join(',')}</div>
      {rows.map((row) => (
        <div key={row.id}>
          {columns.map((column) => (
            <div key={`${row.id}-${column.key}`}>
              {column.cell ? column.cell(row) : String(row[column.key] ?? '')}
            </div>
          ))}
          {rowActions?.map((action) => (
            <button
              key={`${row.id}-${action.key}`}
              type="button"
              onClick={() => action.onSelect(row)}
            >
              {`${action.label}:${row.id}`}
            </button>
          ))}
        </div>
      ))}
    </div>
  ),
  Dialog: ({
    open,
    title,
    children,
    footer,
  }: {
    open: boolean;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    open ? (
      <div>
        <div>{title}</div>
        <div>{children}</div>
        <div>{footer}</div>
      </div>
    ) : null,
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
  Input: ({
    label,
    error,
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & {
    label?: string;
    error?: string;
  }) => (
    <label>
      <span>{label}</span>
      <input {...props} />
      {error ? <span>{error}</span> : null}
    </label>
  ),
  Select: ({
    children,
    ...props
  }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props}>{children}</select>
  ),
  SavedViewBar: ({ title }: { title?: string }) => (
    <div>{title ?? '保存ビュー'}</div>
  ),
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
  createLocalStorageSavedViewsAdapter,
  erpStatusDictionary: {},
  useSavedViews,
}));

import { AdminJobs } from './AdminJobs';

const defaultSavedViews = {
  views: [
    {
      id: 'default',
      name: '既定',
      payload: { search: '', groupFilter: 'all' as const },
      createdAt: '2026-03-26T00:00:00.000Z',
      updatedAt: '2026-03-26T00:00:00.000Z',
    },
  ],
  activeViewId: 'default',
  selectView: vi.fn(),
  createView: vi.fn(),
  updateView: vi.fn(),
  duplicateView: vi.fn(),
  toggleShared: vi.fn(),
  deleteView: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSavedViews).mockReturnValue(defaultSavedViews);
});

afterEach(() => {
  cleanup();
});

describe('AdminJobs', () => {
  it('filters rows and clears conditions', () => {
    render(<AdminJobs />);

    fireEvent.change(screen.getByLabelText('ジョブ検索'), {
      target: { value: '配信' },
    });
    fireEvent.change(screen.getByLabelText('ジョブ分類フィルタ'), {
      target: { value: 'レポート' },
    });

    expect(screen.getByText('配信リトライ')).toBeInTheDocument();
    expect(screen.queryByText('通知配信')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '条件クリア' }));

    expect(screen.getByLabelText('ジョブ検索')).toHaveValue('');
    expect(screen.getByLabelText('ジョブ分類フィルタ')).toHaveValue('all');
    expect(screen.getByText('通知配信')).toBeInTheDocument();
  });

  it('shows empty state when filters exclude all jobs', () => {
    render(<AdminJobs />);

    fireEvent.change(screen.getByLabelText('ジョブ検索'), {
      target: { value: '存在しないジョブ' },
    });

    expect(screen.getByText('ジョブがありません')).toBeInTheDocument();
    expect(screen.getByText('検索条件を変更してください')).toBeInTheDocument();
  });

  it('runs report subscription job and shows detail result', async () => {
    vi.mocked(api).mockResolvedValueOnce({ delivered: 3, skipped: 1 });

    render(<AdminJobs />);

    fireEvent.click(
      screen.getByRole('checkbox', { name: '予約レポート dryRun' }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: '実行:reportSubscriptions' }),
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/jobs/report-subscriptions/run', {
        method: 'POST',
        body: JSON.stringify({ dryRun: true }),
      });
    });

    expect(screen.getByText('{"delivered":3,"skipped":1}')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: '詳細:reportSubscriptions' }),
    );
    expect(
      screen.getByText('ジョブ結果: 予約レポート実行'),
    ).toBeInTheDocument();
    expect(screen.getByText(/"delivered": 3/)).toBeInTheDocument();
  });

  it('blocks notification delivery when limit is invalid', () => {
    render(<AdminJobs />);

    fireEvent.change(screen.getByLabelText('通知 limit'), {
      target: { value: '0' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: '実行:notificationDeliveries' }),
    );

    expect(
      screen.getAllByText('limit は 1-200 で入力してください').length,
    ).toBeGreaterThan(0);
    expect(api).not.toHaveBeenCalled();
  });

  it('shows empty detail state for never-run jobs', () => {
    render(<AdminJobs />);

    fireEvent.click(screen.getByRole('button', { name: '詳細:alerts' }));

    expect(screen.getByText('ジョブ結果: アラート計算')).toBeInTheDocument();
    expect(screen.getByText('結果がありません')).toBeInTheDocument();
    expect(screen.getByText('ジョブ未実行です')).toBeInTheDocument();
  });
});

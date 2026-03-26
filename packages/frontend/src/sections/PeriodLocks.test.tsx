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
    empty?: { title: string; description: string };
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
          <div>{empty.description}</div>
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
  ConfirmActionDialog: ({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
  }: {
    open: boolean;
    title: string;
    description?: string;
    confirmLabel: string;
    cancelLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    open ? (
      <div>
        <div>{title}</div>
        {description ? <div>{description}</div> : null}
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    ) : null,
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
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) => {
    const id = String(label ?? 'input');
    return (
      <label>
        <span>{label}</span>
        <input aria-label={label} id={id} {...props} />
      </label>
    );
  },
  Select: ({
    label,
    children,
    placeholder,
    ...props
  }: React.SelectHTMLAttributes<HTMLSelectElement> & {
    label?: string;
    placeholder?: string;
  }) => {
    const ariaLabel = label ?? placeholder;
    return (
      <label>
        <span>{label}</span>
        <select aria-label={ariaLabel} {...props}>
          {children}
        </select>
      </label>
    );
  },
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
  erpStatusDictionary: {},
}));

import { PeriodLocks } from './PeriodLocks';

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PeriodLocks', () => {
  it('validates project scope and creates a lock', async () => {
    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path === '/projects') {
        return {
          items: [{ id: 'project-1', code: 'P001', name: 'Project One' }],
        };
      }
      if (path === '/period-locks' && options?.method === 'POST') {
        return { id: 'lock-1' };
      }
      if (path === '/period-locks') {
        return {
          items: [
            {
              id: 'lock-1',
              period: '2026-03',
              scope: 'project',
              projectId: 'project-1',
              closedAt: '2026-03-26T00:00:00.000Z',
              closedBy: 'admin@example.com',
              reason: '月次締め',
            },
          ],
        };
      }
      throw new Error(`unexpected api call: ${String(path)}`);
    });

    render(<PeriodLocks />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects');
    });

    fireEvent.click(screen.getByRole('button', { name: '締め登録' }));
    expect(screen.getByText('project を選択してください')).toBeInTheDocument();

    fireEvent.change(screen.getAllByLabelText('project')[0], {
      target: { value: 'project-1' },
    });
    fireEvent.change(screen.getByLabelText('reason'), {
      target: { value: ' 月次締め ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '締め登録' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/period-locks', {
        method: 'POST',
        body: JSON.stringify({
          period: '2026-03',
          scope: 'project',
          projectId: 'project-1',
          reason: '月次締め',
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText('P001 / Project One').length).toBeGreaterThan(
        0,
      );
    });
    expect(screen.getByText('月次締め')).toBeInTheDocument();
  });

  it('loads filtered locks, clears filters, and removes a lock', async () => {
    let filteredLoadCount = 0;

    vi.mocked(api).mockImplementation(async (path, options) => {
      if (path === '/projects') {
        return {
          items: [{ id: 'project-1', code: 'P001', name: 'Project One' }],
        };
      }
      if (
        path ===
        '/period-locks?period=2026-03&scope=project&projectId=project-1'
      ) {
        filteredLoadCount += 1;
        return filteredLoadCount === 1
          ? {
              items: [
                {
                  id: 'lock-1',
                  period: '2026-03',
                  scope: 'project',
                  projectId: 'project-1',
                  closedAt: '2026-03-26T00:00:00.000Z',
                  closedBy: 'admin@example.com',
                  reason: '月次締め',
                },
              ],
            }
          : { items: [] };
      }
      if (path === '/period-locks/lock-1' && options?.method === 'DELETE') {
        return { ok: true };
      }
      if (path === '/period-locks') {
        return { items: [] };
      }
      throw new Error(`unexpected api call: ${String(path)}`);
    });

    render(<PeriodLocks />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects');
    });

    fireEvent.change(screen.getByLabelText('period'), {
      target: { value: '2026-03' },
    });
    fireEvent.change(screen.getAllByLabelText('scope')[1], {
      target: { value: 'project' },
    });
    fireEvent.change(screen.getAllByLabelText('project')[1], {
      target: { value: 'project-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/period-locks?period=2026-03&scope=project&projectId=project-1',
      );
    });
    await waitFor(() => {
      expect(screen.getByText('解除:lock-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '解除:lock-1' }));
    expect(screen.getByText('期間締めを解除しますか？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '解除' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/period-locks/lock-1', {
        method: 'DELETE',
      });
    });
    await waitFor(() => {
      expect(screen.getByText('締めがありません')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '条件クリア' }));
    expect(screen.getByLabelText('period')).toHaveValue('');
    expect(screen.getAllByLabelText('scope')[1]).toHaveValue('');
    expect(screen.getAllByLabelText('project')[1]).toHaveValue('');
  });

  it('shows an error when lock list loading fails', async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/projects') {
        return { items: [] };
      }
      if (String(path).startsWith('/period-locks')) {
        throw new Error('load failed');
      }
      throw new Error(`unexpected api call: ${String(path)}`);
    });

    render(<PeriodLocks />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects');
    });

    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    await waitFor(() => {
      expect(
        screen.getAllByText('締め一覧の取得に失敗しました').length,
      ).toBeGreaterThan(0);
    });
    expect(screen.getByText('再試行')).toBeInTheDocument();
  });
});

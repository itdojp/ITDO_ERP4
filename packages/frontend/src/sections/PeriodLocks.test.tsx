import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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

type TestPeriodLock = {
  id: string;
  period: string;
  scope: 'global' | 'project';
  projectId?: string;
  reason?: string;
};

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PeriodLocks', () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  };

  const getCreateSection = () =>
    screen.getByRole('button', { name: '締め登録' }).closest('section')!;

  const getListSection = () =>
    screen.getByRole('heading', { name: '締め一覧' }).closest('section')!;

  it('renders workflow summary and period lock panels', async () => {
    vi.mocked(api).mockResolvedValue({ items: [] });

    render(<PeriodLocks />);

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/projects');
    });

    expect(
      screen.getByRole('heading', { name: '期間締め' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '会計・勤怠などの対象期間を締め、対象scopeと理由を確認しながら登録・検索・解除するための管理画面です。',
      ),
    ).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: '期間締めサマリー' });
    expect(within(summary).getByText('締め一覧状態')).toBeInTheDocument();
    expect(within(summary).getByText('未取得')).toBeInTheDocument();
    expect(within(summary).getByText('検索条件')).toBeInTheDocument();
    expect(within(summary).getByText('未指定')).toBeInTheDocument();
    expect(within(summary).getByText('登録対象')).toBeInTheDocument();
    expect(within(summary).getByText(/案件未選択/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '締め登録' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '締め検索と解除' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '締め一覧' }),
    ).toBeInTheDocument();
  });

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

    const createSection = within(getCreateSection());
    const listSection = within(getListSection());

    fireEvent.click(createSection.getByRole('button', { name: '締め登録' }));
    expect(screen.getByText('project を選択してください')).toBeInTheDocument();

    fireEvent.change(createSection.getByLabelText('period (YYYY-MM)'), {
      target: { value: '2026-03' },
    });
    fireEvent.change(createSection.getByLabelText('project'), {
      target: { value: 'project-1' },
    });
    fireEvent.change(createSection.getByLabelText('reason'), {
      target: { value: ' 月次締め ' },
    });
    fireEvent.click(createSection.getByRole('button', { name: '締め登録' }));

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
      expect(listSection.getByText('月次締め')).toBeInTheDocument();
    });

    expect(api).toHaveBeenCalledWith('/period-locks', {
      signal: expect.any(AbortSignal),
    });

    const summary = screen.getByRole('region', { name: '期間締めサマリー' });
    expect(within(summary).getByText('取得済み')).toBeInTheDocument();
    expect(within(summary).getByText('1件を取得')).toBeInTheDocument();
    expect(within(summary).getByText('1件')).toBeInTheDocument();
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

    const listSection = within(getListSection());

    fireEvent.change(listSection.getByLabelText('period'), {
      target: { value: '2026-03' },
    });
    fireEvent.change(listSection.getByLabelText('scope'), {
      target: { value: 'project' },
    });
    fireEvent.change(listSection.getByLabelText('project'), {
      target: { value: 'project-1' },
    });
    fireEvent.click(listSection.getByRole('button', { name: '検索' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/period-locks?period=2026-03&scope=project&projectId=project-1',
        { signal: expect.any(AbortSignal) },
      );
    });
    await waitFor(() => {
      expect(listSection.getByText('解除:lock-1')).toBeInTheDocument();
    });

    fireEvent.click(listSection.getByRole('button', { name: '解除:lock-1' }));
    expect(screen.getByText('期間締めを解除しますか？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '解除' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/period-locks/lock-1', {
        method: 'DELETE',
      });
    });
    await waitFor(() => {
      expect(listSection.queryByText('解除:lock-1')).not.toBeInTheDocument();
    });

    fireEvent.click(listSection.getByRole('button', { name: '条件クリア' }));
    expect(listSection.getByLabelText('period')).toHaveValue('');
    expect(listSection.getByLabelText('scope')).toHaveValue('');
    expect(listSection.getByLabelText('project')).toHaveValue('');
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

    const listSection = within(getListSection());

    fireEvent.click(listSection.getByRole('button', { name: '検索' }));

    await waitFor(() => {
      expect(
        listSection.getAllByText('締め一覧の取得に失敗しました').length,
      ).toBeGreaterThan(0);
    });
    expect(
      listSection.getByRole('button', { name: '再試行' }),
    ).toBeInTheDocument();
  });

  it('keeps the latest filtered response when an older create reload resolves later', async () => {
    const staleReload = deferred<{ items: TestPeriodLock[] }>();
    const filteredReload = deferred<{ items: TestPeriodLock[] }>();

    vi.mocked(api).mockImplementation((path, options) => {
      if (path === '/projects') {
        return Promise.resolve({
          items: [{ id: 'project-1', code: 'P001', name: 'Project One' }],
        });
      }
      if (path === '/period-locks' && options?.method === 'POST') {
        return Promise.resolve({ id: 'lock-filtered' });
      }
      if (path === '/period-locks') return staleReload.promise;
      if (path === '/period-locks?period=2026-03') {
        return filteredReload.promise;
      }
      return Promise.reject(new Error(`unexpected api call: ${String(path)}`));
    });

    render(<PeriodLocks />);
    await waitFor(() => expect(api).toHaveBeenCalledWith('/projects'));

    const createSection = within(getCreateSection());
    const listSection = within(getListSection());
    const searchButton = listSection.getByRole('button', { name: '検索' });

    fireEvent.change(createSection.getByLabelText('period (YYYY-MM)'), {
      target: { value: '2026-03' },
    });
    fireEvent.change(createSection.getByLabelText('project'), {
      target: { value: 'project-1' },
    });
    fireEvent.click(createSection.getByRole('button', { name: '締め登録' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/period-locks', {
        signal: expect.any(AbortSignal),
      });
    });

    fireEvent.change(listSection.getByLabelText('period'), {
      target: { value: '2026-03' },
    });
    fireEvent.click(searchButton);

    await act(async () => {
      filteredReload.resolve({
        items: [
          {
            id: 'lock-filtered',
            period: '2026-03',
            scope: 'project',
            projectId: 'project-1',
            reason: 'filtered result',
          },
        ],
      });
      await filteredReload.promise;
    });

    await waitFor(() => {
      expect(listSection.getByText('filtered result')).toBeInTheDocument();
    });
    const summary = screen.getByRole('region', { name: '期間締めサマリー' });
    expect(within(summary).getByText('取得済み')).toBeInTheDocument();
    expect(within(summary).getByText('1件を取得')).toBeInTheDocument();

    await act(async () => {
      staleReload.resolve({
        items: [
          {
            id: 'lock-filtered',
            period: '2026-03',
            scope: 'project',
            projectId: 'project-1',
            reason: 'stale result',
          },
          {
            id: 'lock-unrelated',
            period: '2026-04',
            scope: 'global',
            reason: 'unrelated result',
          },
        ],
      });
      await staleReload.promise;
    });

    await waitFor(() => {
      expect(
        createSection.getByRole('button', { name: '締め登録' }),
      ).toBeInTheDocument();
    });
    expect(listSection.getByText('filtered result')).toBeInTheDocument();
    expect(listSection.queryByText('stale result')).not.toBeInTheDocument();
    expect(listSection.queryByText('unrelated result')).not.toBeInTheDocument();
    expect(within(summary).getByText('取得済み')).toBeInTheDocument();
    expect(within(summary).getByText('1件を取得')).toBeInTheDocument();
  });

  it('does not surface a stale create reload error after a filtered request succeeds', async () => {
    const staleReload = deferred<{ items: TestPeriodLock[] }>();

    vi.mocked(api).mockImplementation((path, options) => {
      if (path === '/projects') {
        return Promise.resolve({
          items: [{ id: 'project-1', code: 'P001', name: 'Project One' }],
        });
      }
      if (path === '/period-locks' && options?.method === 'POST') {
        return Promise.resolve({ id: 'lock-filtered' });
      }
      if (path === '/period-locks') return staleReload.promise;
      if (path === '/period-locks?period=2026-03') {
        return Promise.resolve({
          items: [
            {
              id: 'lock-filtered',
              period: '2026-03',
              scope: 'project',
              projectId: 'project-1',
              reason: 'filtered result',
            },
          ],
        });
      }
      return Promise.reject(new Error(`unexpected api call: ${String(path)}`));
    });

    render(<PeriodLocks />);
    await waitFor(() => expect(api).toHaveBeenCalledWith('/projects'));

    const createSection = within(getCreateSection());
    const listSection = within(getListSection());
    const searchButton = listSection.getByRole('button', { name: '検索' });

    fireEvent.change(createSection.getByLabelText('period (YYYY-MM)'), {
      target: { value: '2026-03' },
    });
    fireEvent.change(createSection.getByLabelText('project'), {
      target: { value: 'project-1' },
    });
    fireEvent.click(createSection.getByRole('button', { name: '締め登録' }));
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/period-locks', {
        signal: expect.any(AbortSignal),
      });
    });

    fireEvent.change(listSection.getByLabelText('period'), {
      target: { value: '2026-03' },
    });
    fireEvent.click(searchButton);
    await waitFor(() => {
      expect(listSection.getByText('filtered result')).toBeInTheDocument();
    });

    await act(async () => {
      staleReload.reject(new Error('stale load failed'));
      await staleReload.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(
        createSection.getByRole('button', { name: '締め登録' }),
      ).toBeInTheDocument();
    });
    const summary = screen.getByRole('region', { name: '期間締めサマリー' });
    expect(within(summary).getByText('取得済み')).toBeInTheDocument();
    expect(within(summary).getByText('1件を取得')).toBeInTheDocument();
    expect(listSection.getByText('filtered result')).toBeInTheDocument();
    expect(
      listSection.queryByText('締め一覧の取得に失敗しました'),
    ).not.toBeInTheDocument();
  });
});

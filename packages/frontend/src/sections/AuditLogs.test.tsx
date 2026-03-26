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

const {
  api,
  apiResponse,
  downloadResponseAsFile,
  formatDateForFilename,
  useSavedViews,
  createLocalStorageSavedViewsAdapter,
} = vi.hoisted(() => ({
  api: vi.fn(),
  apiResponse: vi.fn(),
  downloadResponseAsFile: vi.fn(),
  formatDateForFilename: vi.fn(() => '20260326-120000'),
  useSavedViews: vi.fn(),
  createLocalStorageSavedViewsAdapter: vi.fn(() => ({
    list: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
  })),
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
        <span>{fromLabel}</span>
        <input
          aria-label={fromLabel}
          value={value.from ?? ''}
          onChange={(event) => onChange({ ...value, from: event.target.value })}
        />
      </label>
      <label>
        <span>{toLabel}</span>
        <input
          aria-label={toLabel}
          value={value.to ?? ''}
          onChange={(event) => onChange({ ...value, to: event.target.value })}
        />
      </label>
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
  }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) => (
    <label>
      <span>{label}</span>
      <input aria-label={label} {...props} />
    </label>
  ),
  SavedViewBar: ({ title }: { title?: string }) => (
    <div>{title ?? '保存ビュー'}</div>
  ),
  Select: ({
    label,
    children,
    ...props
  }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) => (
    <label>
      <span>{label}</span>
      <select aria-label={label} {...props}>
        {children}
      </select>
    </label>
  ),
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
  createLocalStorageSavedViewsAdapter,
  erpStatusDictionary: {},
  useSavedViews,
}));

import { AuditLogs } from './AuditLogs';

const defaultSavedViews = {
  views: [
    {
      id: 'default',
      name: '既定',
      payload: {
        from: '',
        to: '',
        userId: '',
        action: '',
        sendLogId: '',
        targetTable: '',
        targetId: '',
        reasonCode: '',
        reasonText: '',
        source: '',
        actorRole: '',
        actorGroupId: '',
        requestId: '',
        limit: '200',
      },
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
  vi.mocked(formatDateForFilename).mockReturnValue('20260326-120000');
});

afterEach(() => {
  cleanup();
});

describe('AuditLogs', () => {
  it('loads filtered logs and downloads csv', async () => {
    vi.mocked(api).mockResolvedValue({
      items: [
        {
          id: 'log-1',
          action: 'document_send',
          userId: 'user-1',
          createdAt: '2026-03-26T10:00:00.000Z',
          targetTable: 'document_send_log',
          targetId: 'send-1',
          actorRole: 'admin',
          actorGroupId: 'group-1',
          source: 'ui',
          requestId: 'req-1',
          metadata: { ok: true },
        },
      ],
    });
    const response = { ok: true } as Response;
    vi.mocked(apiResponse).mockResolvedValue(response);
    vi.mocked(downloadResponseAsFile).mockResolvedValue(undefined);

    render(<AuditLogs />);

    fireEvent.change(screen.getByLabelText('userId'), {
      target: { value: 'user-1' },
    });
    fireEvent.change(screen.getByLabelText('action'), {
      target: { value: 'document_send' },
    });
    fireEvent.change(screen.getByLabelText('limit'), {
      target: { value: '500' },
    });
    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/audit-logs?userId=user-1&action=document_send&limit=500&format=json',
      );
    });
    expect(screen.getByText('document_send')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'CSV出力' }));

    await waitFor(() => {
      expect(apiResponse).toHaveBeenCalledWith(
        '/audit-logs?userId=user-1&action=document_send&limit=500&format=csv',
      );
    });
    expect(downloadResponseAsFile).toHaveBeenCalledWith(
      response,
      'audit-logs-20260326-120000.csv',
    );
  });

  it('reloads logs from the custom send log event', async () => {
    vi.mocked(api).mockResolvedValue({ items: [] });

    render(<AuditLogs />);

    window.dispatchEvent(
      new CustomEvent('erp4_open_audit_logs', {
        detail: { sendLogId: ' send-log-1 ' },
      }),
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        '/audit-logs?sendLogId=send-log-1&limit=200&format=json',
      );
    });
    expect(screen.getByLabelText('sendLogId')).toHaveValue('send-log-1');
  });

  it('shows retry UI after a list load failure and reloads successfully', async () => {
    vi.mocked(api)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ items: [] });

    render(<AuditLogs />);

    fireEvent.click(screen.getByRole('button', { name: '検索' }));

    expect(
      (await screen.findAllByText('監査ログの取得に失敗しました')).length,
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '再試行' }));

    expect(await screen.findByText('監査ログなし')).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('loads and sanitizes agent run detail', async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/audit-logs?limit=200&format=json') {
        return {
          items: [
            {
              id: 'log-1',
              action: 'agent_run',
              userId: 'user-1',
              createdAt: '2026-03-26T10:00:00.000Z',
              metadata: { status: 'ok' },
              agentRunId: 'run-abcdef123456',
            },
          ],
        };
      }
      if (path === '/agent-runs/run-abcdef123456') {
        return {
          id: 'run-abcdef123456',
          path: '/agent-runs/run-abcdef123456',
          metadata: {
            token: 'secret-token',
            requestId: 'request-123456789',
            nested: {
              password: 'pw',
              actorUserId: 'actor-987654321',
            },
          },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    render(<AuditLogs />);

    fireEvent.click(screen.getByRole('button', { name: '検索' }));
    const row = await screen.findByTestId('row-log-1');

    fireEvent.click(
      within(row).getByRole('button', {
        name: '詳細',
      }),
    );

    expect(
      await screen.findByText('AgentRun run-abcdef123456'),
    ).toBeInTheDocument();
    const detailBlock = screen.getByText((_, node) => node?.tagName === 'PRE');
    expect(detailBlock.textContent).toContain('"token": "[REDACTED]"');
    expect(detailBlock.textContent).toContain('"password": "[REDACTED]"');
    expect(detailBlock.textContent).toMatch(/"requestId": "requ\*+/);
    expect(detailBlock.textContent).toMatch(/"actorUserId": "acto\*+/);
    expect(detailBlock.textContent).not.toContain('secret-token');

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
    expect(
      screen.queryByText('AgentRun run-abcdef123456'),
    ).not.toBeInTheDocument();
  });

  it('shows an error message when csv download fails', async () => {
    vi.mocked(apiResponse).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    render(<AuditLogs />);

    fireEvent.click(screen.getByRole('button', { name: 'CSV出力' }));

    expect(
      await screen.findByText('CSV出力に失敗しました'),
    ).toBeInTheDocument();
    expect(downloadResponseAsFile).not.toHaveBeenCalled();
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  api,
  apiResponse,
  navigateToOpen,
  openResponseInNewTab,
  useSavedViews,
  createLocalStorageSavedViewsAdapter,
} = vi.hoisted(() => ({
  api: vi.fn(),
  apiResponse: vi.fn(),
  navigateToOpen: vi.fn(),
  openResponseInNewTab: vi.fn(),
  useSavedViews: vi.fn(),
  createLocalStorageSavedViewsAdapter: vi.fn(() => ({
    list: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
  })),
}));

vi.mock('../api', () => ({ api, apiResponse }));
vi.mock('../utils/deepLink', () => ({ navigateToOpen }));
vi.mock('../utils/download', async () => {
  const actual =
    await vi.importActual<typeof import('../utils/download')>(
      '../utils/download',
    );
  return {
    ...actual,
    openResponseInNewTab,
  };
});

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
    table,
  }: {
    title: string;
    description: string;
    table: React.ReactNode;
  }) => (
    <section>
      <h3>{title}</h3>
      <p>{description}</p>
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
  }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) => (
    <label>
      <span>{label}</span>
      <input aria-label={label} {...props} />
    </label>
  ),
  SavedViewBar: ({ title }: { title?: string }) => (
    <div>{title ?? '保存ビュー'}</div>
  ),
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
  createLocalStorageSavedViewsAdapter,
  erpStatusDictionary: {},
  useSavedViews,
}));

import { DocumentSendLogs } from './DocumentSendLogs';

const defaultSavedViews = {
  views: [
    {
      id: 'default',
      name: '既定',
      payload: { logId: '' },
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

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSavedViews).mockReturnValue(defaultSavedViews);
});

describe('DocumentSendLogs', () => {
  it('shows validation message when load is requested without log id', async () => {
    render(<DocumentSendLogs />);

    fireEvent.click(screen.getByRole('button', { name: '送信ログ取得' }));

    expect(
      await screen.findByText('送信ログIDを入力してください'),
    ).toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it('loads log and events and opens audit logs', async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/document-send-logs/log-1') {
        return {
          id: 'log-1',
          kind: 'invoice',
          targetTable: 'vendor_invoice',
          targetId: 'invoice-1',
          channel: 'email',
          status: 'failed',
          recipients: ['a@example.com', 'b@example.com'],
          templateId: 'tpl-1',
          providerMessageId: 'msg-1',
          error: 'delivery failed',
          metadata: { attempt: 1 },
          createdAt: '2026-03-26T00:00:00.000Z',
          updatedAt: '2026-03-26T01:00:00.000Z',
        };
      }
      if (path === '/document-send-logs/log-1/events') {
        return {
          items: [
            {
              id: 'evt-1',
              provider: 'sendgrid',
              eventType: 'bounce',
              createdAt: '2026-03-26T01:00:00.000Z',
              payload: { reason: 'mailbox not found' },
            },
          ],
        };
      }
      throw new Error(`unexpected api call: ${String(path)}`);
    });

    render(<DocumentSendLogs />);

    fireEvent.change(screen.getByLabelText('sendLogId'), {
      target: { value: '  log-1  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'まとめて取得' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/document-send-logs/log-1');
      expect(api).toHaveBeenCalledWith('/document-send-logs/log-1/events');
    });

    expect(screen.getByText('vendor_invoice / invoice-1')).toBeInTheDocument();
    expect(
      screen.getByText('a@example.com, b@example.com'),
    ).toBeInTheDocument();
    expect(screen.getByText('bounce')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: '監査ログで開く:log-1' }),
    );
    expect(navigateToOpen).toHaveBeenCalledWith({
      kind: 'audit_logs',
      id: 'log-1',
    });
  });

  it('blocks retry when the status is not retryable', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      id: 'log-2',
      kind: 'invoice',
      targetTable: 'vendor_invoice',
      targetId: 'invoice-2',
      channel: 'email',
      status: 'success',
      recipients: ['done@example.com'],
      templateId: null,
      providerMessageId: null,
      error: null,
      metadata: null,
      createdAt: '2026-03-26T00:00:00.000Z',
      updatedAt: '2026-03-26T01:00:00.000Z',
    });

    render(<DocumentSendLogs />);

    fireEvent.change(screen.getByLabelText('sendLogId'), {
      target: { value: 'log-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: '送信ログ取得' }));

    await screen.findByText('vendor_invoice / invoice-2');

    fireEvent.click(screen.getByRole('button', { name: '再送:log-2' }));

    expect(
      await screen.findByText('このステータスのログは再送できません'),
    ).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('opens a PDF for non-stub logs and reports failures', async () => {
    vi.mocked(api).mockResolvedValueOnce({
      id: 'log-3',
      kind: 'invoice',
      targetTable: 'vendor_invoice',
      targetId: 'invoice-3',
      channel: 'email',
      status: 'failed',
      recipients: ['pdf@example.com'],
      templateId: null,
      providerMessageId: null,
      pdfUrl: '/pdf-files/file-1',
      error: null,
      metadata: null,
      createdAt: '2026-03-26T00:00:00.000Z',
      updatedAt: '2026-03-26T01:00:00.000Z',
    });
    vi.mocked(apiResponse).mockResolvedValue({ ok: true } as Response);

    render(<DocumentSendLogs />);

    fireEvent.change(screen.getByLabelText('sendLogId'), {
      target: { value: 'log-3' },
    });
    fireEvent.click(screen.getByRole('button', { name: '送信ログ取得' }));

    await screen.findByText('vendor_invoice / invoice-3');

    fireEvent.click(screen.getByRole('button', { name: 'PDFを開く:log-3' }));

    await waitFor(() => {
      expect(apiResponse).toHaveBeenCalledWith('/pdf-files/file-1');
      expect(openResponseInNewTab).toHaveBeenCalled();
    });

    const [, filename] = vi.mocked(openResponseInNewTab).mock.calls[0] ?? [];
    expect(String(filename)).toMatch(/^document-\d{4}-\d{2}-\d{2}\.pdf$/);

    vi.mocked(apiResponse).mockRejectedValueOnce(new Error('boom'));
    fireEvent.click(screen.getByRole('button', { name: 'PDFを開く:log-3' }));

    expect(
      await screen.findByText('PDFの取得に失敗しました'),
    ).toBeInTheDocument();
  });

  it('loads a log when erp4_open_document_send_log is dispatched', async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/document-send-logs/log-4') {
        return {
          id: 'log-4',
          kind: 'estimate',
          targetTable: 'estimate',
          targetId: 'estimate-4',
          channel: 'slack',
          status: 'queued',
          recipients: ['ops@example.com'],
          templateId: null,
          providerMessageId: null,
          error: null,
          metadata: null,
          createdAt: '2026-03-26T00:00:00.000Z',
          updatedAt: '2026-03-26T01:00:00.000Z',
        };
      }
      if (path === '/document-send-logs/log-4/events') {
        return { items: [] };
      }
      throw new Error(`unexpected api call: ${String(path)}`);
    });

    render(<DocumentSendLogs />);

    window.dispatchEvent(
      new CustomEvent('erp4_open_document_send_log', {
        detail: { sendLogId: ' log-4 ' },
      }),
    );

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/document-send-logs/log-4');
      expect(api).toHaveBeenCalledWith('/document-send-logs/log-4/events');
    });

    expect(screen.getByText('estimate / estimate-4')).toBeInTheDocument();
    expect(screen.getByDisplayValue('log-4')).toBeInTheDocument();
  });
});

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

const { api, getAuthState, useProjects } = vi.hoisted(() => ({
  api: vi.fn(),
  getAuthState: vi.fn(),
  useProjects: vi.fn(),
}));

vi.mock('../api', () => ({ api, getAuthState }));
vi.mock('../hooks/useProjects', () => ({ useProjects }));
vi.mock('../components/AnnotationsCard', () => ({
  AnnotationsCard: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock('./InvoiceDetail', () => ({
  InvoiceDetail: ({
    invoiceNo,
    onSend,
    onMarkPaid,
    canMarkPaid,
  }: {
    invoiceNo?: string;
    onSend: () => void;
    onMarkPaid: () => void;
    canMarkPaid: boolean;
  }) => (
    <div>
      <div>InvoiceDetail:{invoiceNo || '(draft)'}</div>
      <button type="button" onClick={onSend}>
        詳細送信
      </button>
      {canMarkPaid ? (
        <button type="button" onClick={onMarkPaid}>
          詳細入金確認
        </button>
      ) : null}
    </div>
  ),
}));
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
    error?: {
      title: string;
      detail?: string;
      retryLabel?: string;
      onRetry?: () => void;
    };
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
          {error.onRetry ? (
            <button type="button" onClick={error.onRetry}>
              {error.retryLabel || 'retry'}
            </button>
          ) : null}
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
  ConfirmActionDialog: ({
    open,
    title,
    description,
    onConfirm,
    onCancel,
    confirmLabel,
    cancelLabel,
  }: {
    open: boolean;
    title: string;
    description?: string;
    onConfirm: () => void;
    onCancel: () => void;
    confirmLabel: string;
    cancelLabel: string;
  }) =>
    open ? (
      <div>
        <div>{title}</div>
        <div>{description}</div>
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
    filters?: React.ReactNode;
    table: React.ReactNode;
  }) => (
    <section>
      <h3>{title}</h3>
      <div>{description}</div>
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
        <div key={row.id} data-testid={`row-${row.id}`}>
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
  Drawer: ({
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
    ...props
  }: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) => (
    <label>
      <span>{label}</span>
      <input {...props} />
    </label>
  ),
  Select: ({
    label,
    children,
    ...props
  }: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) => (
    <label>
      <span>{label}</span>
      <select {...props}>{children}</select>
    </label>
  ),
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
  Toast: ({
    description,
    onClose,
  }: {
    description: string;
    onClose?: () => void;
  }) => (
    <div>
      <span>{description}</span>
      {onClose ? (
        <button type="button" onClick={onClose}>
          dismiss
        </button>
      ) : null}
    </div>
  ),
  erpStatusDictionary: {},
}));

import { Invoices } from './Invoices';

beforeEach(() => {
  api.mockReset();
  getAuthState.mockReset();
  useProjects.mockReset();
  getAuthState.mockReturnValue({
    userId: 'user-1',
    roles: ['mgmt'],
    projectIds: ['project-1'],
  });
  useProjects.mockReturnValue({
    projects: [
      { id: 'project-1', code: 'PJ-001', name: '案件A' },
      { id: 'project-2', code: 'PJ-002', name: '案件B' },
    ],
    projectMessage: '',
  });
});

afterEach(() => {
  cleanup();
});

describe('Invoices', () => {
  it('shows validation message and retries list loading after error', async () => {
    api
      .mockRejectedValueOnce(new Error('load failed'))
      .mockResolvedValueOnce({ items: [] });

    render(<Invoices />);

    expect(
      await screen.findAllByText('請求一覧の取得に失敗しました'),
    ).not.toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(
      await screen.findByText('請求データがありません'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('金額'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: '作成' }));
    expect(
      await screen.findByText('金額は1円以上で入力してください'),
    ).toBeInTheDocument();
  });

  it('creates invoice from form and time entries', async () => {
    api
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({
        id: 'inv-1',
        invoiceNo: 'INV-001',
        projectId: 'project-1',
        totalAmount: 120000,
        status: 'draft',
      })
      .mockResolvedValueOnce({
        invoice: {
          id: 'inv-2',
          invoiceNo: 'INV-002',
          projectId: 'project-1',
          totalAmount: 30000,
          status: 'draft',
        },
        meta: { timeEntryCount: 3 },
      });

    render(<Invoices />);
    expect(
      await screen.findByText('請求データがありません'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('金額'), {
      target: { value: '120000' },
    });
    fireEvent.click(screen.getByRole('button', { name: '作成' }));
    expect(await screen.findByText('作成しました')).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/projects/project-1/invoices', {
      method: 'POST',
      body: JSON.stringify({
        totalAmount: 120000,
        currency: 'JPY',
        lines: [{ description: '作業費', quantity: 1, unitPrice: 120000 }],
      }),
    });
    expect(screen.getByText('INV-001')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '工数から作成' }));
    expect(
      await screen.findByText('工数3件からドラフトを作成しました'),
    ).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith(
      '/projects/project-1/invoices/from-time-entries',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.getByText('INV-002')).toBeInTheDocument();
  });

  it('handles row actions and mark-paid confirmation', async () => {
    api
      .mockResolvedValueOnce({
        items: [
          {
            id: 'inv-1',
            invoiceNo: 'INV-001',
            projectId: 'project-1',
            totalAmount: 100000,
            status: 'draft',
          },
          {
            id: 'inv-2',
            invoiceNo: 'INV-002',
            projectId: 'project-1',
            totalAmount: 50000,
            status: 'approved',
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        id: 'inv-2',
        invoiceNo: 'INV-002',
        projectId: 'project-1',
        totalAmount: 50000,
        status: 'paid',
        paidAt: '2026-03-27',
      });

    render(<Invoices />);
    expect(await screen.findByText('INV-001')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '送信:inv-1' }));
    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/invoices/inv-1/send', {
        method: 'POST',
      });
    });
    expect(screen.getByText('送信しました')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: '工数リンク解除:inv-2' }),
    );
    expect(
      await screen.findByText('工数リンク解除は draft の請求のみ実行できます'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '詳細:inv-1' }));
    expect(await screen.findByText('請求詳細: INV-001')).toBeInTheDocument();
    expect(screen.getByText('InvoiceDetail:INV-001')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '入金確認:inv-2' }));
    expect(
      await screen.findByText('入金確認を実行しますか？'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '入金確認' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/invoices/inv-2/mark-paid', {
        method: 'POST',
        body: JSON.stringify({}),
      });
    });
    expect(screen.getByText('入金を確認しました')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('row-inv-2')).getByText('paid'),
    ).toBeInTheDocument();
  });
});

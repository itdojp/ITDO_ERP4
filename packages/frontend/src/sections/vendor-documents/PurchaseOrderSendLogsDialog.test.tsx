import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

type DataTableRow = Record<string, unknown> & { id: string };

vi.mock('../../ui', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AsyncStatePanel: ({
    state,
    loadingText,
    empty,
  }: {
    state: string;
    loadingText?: string;
    empty?: { title: string; description: string };
  }) => (
    <div>
      <div>{state}</div>
      {loadingText ? <div>{loadingText}</div> : null}
      {empty ? (
        <>
          <div>{empty.title}</div>
          <div>{empty.description}</div>
        </>
      ) : null}
    </div>
  ),
  Button: ({
    variant,
    size,
    children,
    ...buttonProps
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  }) => (
    <button type="button" {...buttonProps}>
      {children}
    </button>
  ),
  Dialog: ({
    open,
    title,
    footer,
    children,
  }: {
    open: boolean;
    title: string;
    footer?: React.ReactNode;
    children: React.ReactNode;
  }) =>
    open ? (
      <section>
        <h1>{title}</h1>
        <div>{children}</div>
        <footer>{footer}</footer>
      </section>
    ) : null,
  DataTable: ({
    columns,
    rows,
    rowActions,
  }: {
    columns: Array<{ key: string; header: string }>;
    rows: DataTableRow[];
    rowActions?: Array<{
      key: string;
      label: string;
      onSelect: (row: DataTableRow) => void;
    }>;
  }) => (
    <div>
      <div>{columns.map((column) => column.header).join(',')}</div>
      {rows.map((row) => (
        <div key={row.id}>
          <div>{String(row.logId ?? '')}</div>
          <div>{String(row.channel ?? '')}</div>
          <div>{String(row.error ?? '')}</div>
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
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
  erpStatusDictionary: {},
}));

import { PurchaseOrderSendLogsDialog } from './PurchaseOrderSendLogsDialog';

afterEach(() => {
  cleanup();
});

function createProps(
  overrides: Partial<
    React.ComponentProps<typeof PurchaseOrderSendLogsDialog>
  > = {},
): React.ComponentProps<typeof PurchaseOrderSendLogsDialog> {
  return {
    open: true,
    purchaseOrderId: 'po-1',
    purchaseOrderStatus: 'sent',
    purchaseOrderNo: 'PO-001',
    missingNumberLabel: '番号未設定',
    message: '',
    loading: false,
    logs: [
      {
        id: 'log-1',
        channel: 'email',
        status: 'sent',
        createdAt: '2026-03-26T00:00:00.000Z',
        error: null,
        pdfUrl: 'https://example.com/po.pdf',
      },
    ],
    onClose: vi.fn(),
    onOpenPdf: vi.fn(),
    ...overrides,
  };
}

describe('PurchaseOrderSendLogsDialog', () => {
  it('renders send logs and delegates pdf open and close', () => {
    const props = createProps();

    render(<PurchaseOrderSendLogsDialog {...props} />);

    expect(screen.getByText('発注書: 送信履歴')).toBeInTheDocument();
    expect(screen.getByText('sent')).toBeInTheDocument();
    expect(screen.getByText('PO-001')).toBeInTheDocument();
    expect(
      screen.getByText('状態,チャネル,送信日時,エラー,ログID'),
    ).toBeInTheDocument();
    expect(screen.getByText('log-1')).toBeInTheDocument();
    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'PDFを開く:log-1' }));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));

    expect(props.onOpenPdf).toHaveBeenCalledWith(
      'po-1',
      'https://example.com/po.pdf',
    );
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders loading and message states', () => {
    render(
      <PurchaseOrderSendLogsDialog
        {...createProps({
          loading: true,
          message: '送信履歴の取得に失敗しました',
          logs: [],
        })}
      />,
    );

    expect(
      screen.getByText('送信履歴の取得に失敗しました'),
    ).toBeInTheDocument();
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(screen.getByText('送信履歴を取得中')).toBeInTheDocument();
  });

  it('renders empty state and missing order number fallback', () => {
    render(
      <PurchaseOrderSendLogsDialog
        {...createProps({
          purchaseOrderNo: null,
          logs: [],
        })}
      />,
    );

    expect(screen.getByText('番号未設定')).toBeInTheDocument();
    expect(screen.getByText('empty')).toBeInTheDocument();
    expect(screen.getByText('履歴なし')).toBeInTheDocument();
    expect(screen.getByText('送信履歴がありません')).toBeInTheDocument();
  });
});

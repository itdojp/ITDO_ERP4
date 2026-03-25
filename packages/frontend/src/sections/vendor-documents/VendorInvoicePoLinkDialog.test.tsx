import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../ui', () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
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
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
  erpStatusDictionary: {},
}));

import { VendorInvoicePoLinkDialog } from './VendorInvoicePoLinkDialog';

afterEach(() => {
  cleanup();
});

const formatForTest = (amount: number, currency: string) =>
  `${new Intl.NumberFormat('en-US').format(amount)} ${currency}`;

function createProps(
  overrides: Partial<
    React.ComponentProps<typeof VendorInvoicePoLinkDialog>
  > = {},
): React.ComponentProps<typeof VendorInvoicePoLinkDialog> {
  return {
    open: true,
    dialog: {
      invoice: {
        id: 'inv-1',
        vendorInvoiceNo: 'INV-001',
        projectId: 'project-1',
        vendorId: 'vendor-1',
        currency: 'JPY',
        totalAmount: 120000,
        status: 'approved',
      },
      purchaseOrderId: 'po-1',
      reasonText: '',
    },
    busy: false,
    result: null,
    missingNumberLabel: '番号未設定',
    availablePurchaseOrders: [
      { id: 'po-1', poNo: 'PO-001', currency: 'USD', totalAmount: 950 },
      { id: 'po-2', poNo: null, currency: 'JPY', totalAmount: 100000 },
    ],
    selectedPurchaseOrderId: 'po-1',
    selectedPurchaseOrder: {
      id: 'po-1',
      poNo: 'PO-001',
      currency: 'USD',
      totalAmount: 950,
      lines: [],
    },
    purchaseOrderDetailLoading: false,
    purchaseOrderDetailMessage: '',
    onClose: vi.fn(),
    onSave: vi.fn(),
    onChangePurchaseOrderId: vi.fn(),
    onChangeReasonText: vi.fn(),
    renderProject: vi.fn((projectId: string) => `PJ:${projectId}`),
    renderVendor: vi.fn((vendorId: string) => `V:${vendorId}`),
    isReasonRequiredStatus: vi.fn((status: string) => status === 'approved'),
    parseNumberValue: vi.fn((value: number | string | null | undefined) => {
      if (value === null || value === undefined || value === '') return null;
      const parsed =
        typeof value === 'number'
          ? value
          : Number(String(value).replace(/,/g, ''));
      return Number.isFinite(parsed) ? parsed : null;
    }),
    formatAmount: vi.fn((value: number | string, currency: string) => {
      const amount = typeof value === 'number' ? value : Number(value);
      return `${new Intl.NumberFormat('en-US').format(amount)} ${currency}`;
    }),
    ...overrides,
  };
}

describe('VendorInvoicePoLinkDialog', () => {
  it('renders currency mismatch state and delegates input callbacks', () => {
    const props = createProps();

    render(<VendorInvoicePoLinkDialog {...props} />);

    expect(screen.getByText('仕入請求: 関連発注書（PO）')).toBeInTheDocument();
    expect(screen.getByText('approved')).toBeInTheDocument();
    expect(screen.getByText(/INV-001/)).toBeInTheDocument();
    expect(screen.getByText(/PJ:project-1/)).toBeInTheDocument();
    expect(screen.getByText(/V:vendor-1/)).toBeInTheDocument();
    expect(
      screen.getByText('通貨が異なるため合計差分は算出しません'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/合計差分:/)).not.toBeInTheDocument();
    expect(screen.getByText('明細なし')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'po-2' },
    });
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '理由を更新' },
    });
    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));

    expect(props.onChangePurchaseOrderId).toHaveBeenCalledWith('po-2');
    expect(props.onChangeReasonText).toHaveBeenCalledWith('理由を更新');
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText('変更理由（必須）')).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: '番号未設定' }),
    ).toBeInTheDocument();
  });

  it('renders same-currency diff, line subtotals, and result message', () => {
    const props = createProps({
      dialog: {
        invoice: {
          id: 'inv-2',
          vendorInvoiceNo: null,
          projectId: 'project-2',
          vendorId: 'vendor-2',
          currency: 'JPY',
          totalAmount: 120000,
          status: 'draft',
        },
        purchaseOrderId: 'po-2',
        reasonText: '差分確認',
      },
      selectedPurchaseOrderId: 'po-2',
      selectedPurchaseOrder: {
        id: 'po-2',
        poNo: null,
        currency: 'JPY',
        totalAmount: 100000,
        lines: [
          {
            id: 'line-1',
            description: '明細A',
            quantity: '2',
            unitPrice: '15000',
          },
          {
            id: 'line-2',
            description: '明細B',
            quantity: 'abc',
            unitPrice: 20000,
          },
        ],
      },
      result: { text: '保存しました', type: 'success' },
      isReasonRequiredStatus: vi.fn(() => false),
    });

    render(<VendorInvoicePoLinkDialog {...props} />);

    expect(screen.getByText('番号未設定')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('変更理由（任意）')).toBeInTheDocument();
    expect(
      screen.getByText(`PO合計: ${formatForTest(100000, 'JPY')}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`仕入請求合計: ${formatForTest(120000, 'JPY')}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`合計差分: ${formatForTest(20000, 'JPY')}`),
    ).toBeInTheDocument();
    expect(screen.getByText('発注書明細（read-only）')).toBeInTheDocument();
    expect(screen.getByText('明細A')).toBeInTheDocument();
    expect(screen.getByText('明細B')).toBeInTheDocument();
    expect(screen.getByText(formatForTest(30000, 'JPY'))).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.getByText('保存しました')).toBeInTheDocument();
  });

  it('renders loading and error states for purchase order details', () => {
    const { rerender } = render(
      <VendorInvoicePoLinkDialog
        {...createProps({
          selectedPurchaseOrderId: 'po-1',
          selectedPurchaseOrder: null,
          purchaseOrderDetailLoading: true,
          purchaseOrderDetailMessage: '',
        })}
      />,
    );

    expect(screen.getByText('発注書明細を読み込み中...')).toBeInTheDocument();

    rerender(
      <VendorInvoicePoLinkDialog
        {...createProps({
          selectedPurchaseOrderId: 'po-1',
          selectedPurchaseOrder: null,
          purchaseOrderDetailLoading: false,
          purchaseOrderDetailMessage: '発注書の取得に失敗しました',
        })}
      />,
    );

    expect(screen.getByText('発注書の取得に失敗しました')).toBeInTheDocument();
  });
});

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../ui', () => ({
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
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
  erpStatusDictionary: {},
}));

import { VendorInvoiceLineDialog } from './VendorInvoiceLineDialog';

afterEach(() => {
  cleanup();
});

const formatForTest = (amount: number, currency: string) =>
  `${new Intl.NumberFormat('en-US').format(amount)} ${currency}`;

function createProps(
  overrides: Partial<React.ComponentProps<typeof VendorInvoiceLineDialog>> = {},
): React.ComponentProps<typeof VendorInvoiceLineDialog> {
  return {
    open: true,
    dialog: {
      invoice: {
        id: 'inv-1',
        vendorInvoiceNo: 'INV-001',
        projectId: 'project-1',
        vendorId: 'vendor-1',
        purchaseOrderId: 'po-1',
        currency: 'JPY',
        totalAmount: 132000,
        status: 'approved',
        documentUrl: 'https://example.com/invoice.pdf',
      },
    },
    saving: false,
    loading: false,
    expanded: true,
    lines: [
      {
        id: 'line-1',
        lineNo: 1,
        description: 'Consulting',
        quantity: 2,
        unitPrice: 50000,
        amount: 110000,
        taxRate: 10,
        taxAmount: 10000,
        purchaseOrderLineId: 'po-line-1',
      },
    ],
    invoiceLinePurchaseOrderDetail: {
      id: 'po-1',
      lines: [
        {
          id: 'po-line-1',
          description: 'PO Line 1',
          quantity: 3,
          unitPrice: 50000,
        },
      ],
    },
    invoiceLinePoUsageByPoLineId: {
      'po-line-1': {
        existingQuantity: 1,
      },
    },
    invoiceLineRequestedQuantityByPoLine: new Map([['po-line-1', 4]]),
    invoiceLineTotals: {
      amountTotal: 110000,
      taxTotal: 10000,
      grossTotal: 120000,
      invoiceTotal: 132000,
      diff: 12000,
    },
    reason: '',
    message: null,
    missingNumberLabel: '番号未設定',
    onClose: vi.fn(),
    onSave: vi.fn(),
    onToggleExpanded: vi.fn(),
    onAddRow: vi.fn(),
    onUpdateLine: vi.fn(),
    onRemoveLine: vi.fn(),
    onChangeReason: vi.fn(),
    onOpenAllocation: vi.fn(),
    renderProject: vi.fn((projectId: string) => `PJ:${projectId}`),
    renderVendor: vi.fn((vendorId: string) => `V:${vendorId}`),
    formatAmount: vi.fn((value: number | string, currency: string) => {
      const amount = typeof value === 'number' ? value : Number(value);
      return formatForTest(amount, currency);
    }),
    parseNumberValue: vi.fn((value: number | string | null | undefined) => {
      if (value === null || value === undefined || value === '') return null;
      const parsed =
        typeof value === 'number'
          ? value
          : Number(String(value).replace(/,/g, ''));
      return Number.isFinite(parsed) ? parsed : null;
    }),
    isPdfUrl: vi.fn((value?: string | null) =>
      Boolean(value?.endsWith('.pdf')),
    ),
    isReasonRequiredStatus: vi.fn((status: string) => status === 'approved'),
    ...overrides,
  };
}

describe('VendorInvoiceLineDialog', () => {
  it('renders line details, totals, and delegates actions', () => {
    const props = createProps();

    render(<VendorInvoiceLineDialog {...props} />);

    expect(screen.getByText('仕入請求: 請求明細')).toBeInTheDocument();
    expect(screen.getByText(/INV-001/)).toBeInTheDocument();
    expect(screen.getByText(/PJ:project-1/)).toBeInTheDocument();
    expect(screen.getByText(/V:vendor-1/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PDFを開く' })).toHaveAttribute(
      'href',
      'https://example.com/invoice.pdf',
    );
    expect(screen.getByTitle('vendor-invoice-line-pdf')).toBeInTheDocument();
    expect(screen.getByText('PO Line 1 / 3 x 50000')).toBeInTheDocument();
    expect(screen.getByText('自動計算との差分あり')).toBeInTheDocument();
    expect(screen.getByText('自動計算: 11000')).toBeInTheDocument();
    expect(
      screen.getByText((content) =>
        content.includes('他VI利用: 1 / 入力合計: 4 / 入力後残: -2'),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`税抜合計: ${formatForTest(110000, 'JPY')}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`税額合計: ${formatForTest(10000, 'JPY')}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`明細合計: ${formatForTest(120000, 'JPY')}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`請求合計: ${formatForTest(132000, 'JPY')}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText((content) => {
        if (!content.includes('差分:') || !content.includes('JPY'))
          return false;
        const digits = content.replace(/\D/g, '');
        return digits === '12000';
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '差分が残っています。数量/単価/税額を見直してください。',
      ),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('変更理由（必須）')).toBeInTheDocument();

    const row = screen.getByRole('button', { name: '削除' }).closest('tr');
    if (!row) {
      throw new Error('line row not found');
    }
    const rowScope = within(row);

    fireEvent.click(screen.getByRole('button', { name: '請求明細を隠す' }));
    fireEvent.click(screen.getByText('明細追加'));
    fireEvent.change(rowScope.getByDisplayValue('1'), {
      target: { value: '2' },
    });
    fireEvent.change(rowScope.getByPlaceholderText('内容'), {
      target: { value: 'Updated line' },
    });
    fireEvent.change(rowScope.getByDisplayValue('2'), {
      target: { value: '5' },
    });
    fireEvent.change(rowScope.getByDisplayValue('50000'), {
      target: { value: '30000' },
    });
    fireEvent.change(rowScope.getByDisplayValue('110000'), {
      target: { value: '150000' },
    });
    fireEvent.change(rowScope.getByDisplayValue('10'), {
      target: { value: '8' },
    });
    fireEvent.change(rowScope.getByDisplayValue('10000'), {
      target: { value: '12000' },
    });
    fireEvent.change(rowScope.getByRole('combobox'), {
      target: { value: '' },
    });
    fireEvent.change(screen.getByPlaceholderText('変更理由（必須）'), {
      target: { value: '理由を更新' },
    });
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    fireEvent.click(screen.getByRole('button', { name: '配賦明細を開く' }));
    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));

    expect(props.onToggleExpanded).toHaveBeenCalledTimes(1);
    expect(props.onAddRow).toHaveBeenCalledTimes(1);
    expect(props.onUpdateLine).toHaveBeenNthCalledWith(1, 0, {
      lineNo: '2',
    });
    expect(props.onUpdateLine).toHaveBeenNthCalledWith(2, 0, {
      description: 'Updated line',
    });
    expect(props.onUpdateLine).toHaveBeenNthCalledWith(3, 0, {
      quantity: '5',
    });
    expect(props.onUpdateLine).toHaveBeenNthCalledWith(4, 0, {
      unitPrice: '30000',
    });
    expect(props.onUpdateLine).toHaveBeenNthCalledWith(5, 0, {
      amount: '150000',
    });
    expect(props.onUpdateLine).toHaveBeenNthCalledWith(6, 0, {
      taxRate: '8',
    });
    expect(props.onUpdateLine).toHaveBeenNthCalledWith(7, 0, {
      taxAmount: '12000',
    });
    expect(props.onUpdateLine).toHaveBeenNthCalledWith(8, 0, {
      purchaseOrderLineId: '',
    });
    expect(props.onChangeReason).toHaveBeenCalledWith('理由を更新');
    expect(props.onRemoveLine).toHaveBeenCalledWith(0);
    expect(props.onOpenAllocation).toHaveBeenCalledWith(
      props.dialog?.invoice as NonNullable<typeof props.dialog>['invoice'],
    );
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders collapsed and optional reason states without iframe', () => {
    render(
      <VendorInvoiceLineDialog
        {...createProps({
          expanded: false,
          lines: [],
          invoiceLineTotals: null,
          dialog: {
            invoice: {
              id: 'inv-2',
              vendorInvoiceNo: null,
              projectId: 'project-2',
              vendorId: 'vendor-2',
              purchaseOrderId: null,
              currency: 'JPY',
              totalAmount: 0,
              status: 'draft',
              documentUrl: 'https://example.com/file.txt',
            },
          },
          isPdfUrl: vi.fn(() => false),
          isReasonRequiredStatus: vi.fn(() => false),
        })}
      />,
    );

    expect(screen.getByText(/番号未設定/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '請求明細を入力' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('明細追加')).not.toBeInTheDocument();
    expect(
      screen.queryByTitle('vendor-invoice-line-pdf'),
    ).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('変更理由（任意）')).toBeInTheDocument();
  });

  it('renders loading, empty lines, and success message', () => {
    const { rerender } = render(
      <VendorInvoiceLineDialog
        {...createProps({
          loading: true,
          lines: [],
          invoiceLineTotals: null,
          dialog: {
            invoice: {
              id: 'inv-3',
              vendorInvoiceNo: 'INV-003',
              projectId: 'project-3',
              vendorId: 'vendor-3',
              purchaseOrderId: 'po-1',
              currency: 'JPY',
              totalAmount: 50000,
              status: 'approved',
              documentUrl: null,
            },
          },
        })}
      />,
    );

    expect(screen.getByText('PDF未登録')).toBeInTheDocument();
    expect(screen.getByText('請求明細を読み込み中...')).toBeInTheDocument();

    rerender(
      <VendorInvoiceLineDialog
        {...createProps({
          loading: false,
          lines: [],
          invoiceLineTotals: null,
          message: { text: '保存しました', type: 'success' },
          dialog: {
            invoice: {
              id: 'inv-3',
              vendorInvoiceNo: 'INV-003',
              projectId: 'project-3',
              vendorId: 'vendor-3',
              purchaseOrderId: 'po-1',
              currency: 'JPY',
              totalAmount: 50000,
              status: 'approved',
              documentUrl: null,
            },
          },
        })}
      />,
    );

    expect(screen.getByText('請求明細は未入力です')).toBeInTheDocument();
    expect(screen.getByText('保存しました')).toBeInTheDocument();
  });
});

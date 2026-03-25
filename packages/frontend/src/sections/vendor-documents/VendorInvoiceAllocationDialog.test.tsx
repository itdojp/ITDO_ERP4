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

import { VendorInvoiceAllocationDialog } from './VendorInvoiceAllocationDialog';

afterEach(() => {
  cleanup();
});

const formatForTest = (amount: number, currency: string) =>
  `${new Intl.NumberFormat('en-US').format(amount)} ${currency}`;

function createProps(
  overrides: Partial<
    React.ComponentProps<typeof VendorInvoiceAllocationDialog>
  > = {},
): React.ComponentProps<typeof VendorInvoiceAllocationDialog> {
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
        totalAmount: 120000,
        status: 'approved',
        documentUrl: 'https://example.com/invoice.pdf',
      },
    },
    saving: false,
    loading: false,
    expanded: true,
    allocations: [
      {
        projectId: 'project-1',
        amount: 100000,
        taxRate: 10,
        taxAmount: 10000,
        purchaseOrderLineId: 'po-line-1',
      },
    ],
    projects: [
      { id: 'project-1', code: 'P001', name: 'Project One' },
      { id: 'project-2', code: 'P002', name: 'Project Two' },
    ],
    purchaseOrderDetails: {
      'po-1': {
        id: 'po-1',
        lines: [
          {
            id: 'po-line-1',
            description: 'PO Line 1',
            quantity: 2,
            unitPrice: 50000,
          },
        ],
      },
    },
    missingNumberLabel: '番号未設定',
    allocationTotals: {
      amountTotal: 100000,
      taxTotal: 10000,
      grossTotal: 110000,
      invoiceTotal: 120000,
      diff: 10000,
    },
    allocationTaxRateSummary: [{ key: '10%', amount: 100000, tax: 10000 }],
    reason: '',
    message: null,
    onClose: vi.fn(),
    onSave: vi.fn(),
    onToggleExpanded: vi.fn(),
    onAddRow: vi.fn(),
    onUpdateAllocation: vi.fn(),
    onRemoveAllocation: vi.fn(),
    onChangeReason: vi.fn(),
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

describe('VendorInvoiceAllocationDialog', () => {
  it('renders expanded allocation table, totals, and delegates actions', () => {
    const props = createProps();

    render(<VendorInvoiceAllocationDialog {...props} />);

    expect(screen.getByText('仕入請求: 配賦明細')).toBeInTheDocument();
    expect(screen.getByText(/INV-001/)).toBeInTheDocument();
    expect(screen.getByText(/PJ:project-1/)).toBeInTheDocument();
    expect(screen.getByText(/V:vendor-1/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PDFを開く' })).toHaveAttribute(
      'href',
      'https://example.com/invoice.pdf',
    );
    expect(screen.getByTitle('vendor-invoice-pdf')).toBeInTheDocument();
    expect(screen.getByText('PO Line 1 / 2 x 50000')).toBeInTheDocument();
    expect(
      screen.getByText(`税抜合計: ${formatForTest(100000, 'JPY')}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`税額合計: ${formatForTest(10000, 'JPY')}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`配賦合計: ${formatForTest(110000, 'JPY')}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`請求合計: ${formatForTest(120000, 'JPY')}`),
    ).toBeInTheDocument();
    expect(screen.getByText('差分: 10,000 JPY')).toBeInTheDocument();
    expect(
      screen.getByText(`10%: ${formatForTest(110000, 'JPY')}`),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '差分が解消できない場合は理由を添えて管理者へエスカレーションしてください',
      ),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('変更理由（必須）')).toBeInTheDocument();

    const selects = screen.getAllByRole('combobox');
    fireEvent.click(screen.getByRole('button', { name: '配賦明細を隠す' }));
    fireEvent.click(screen.getByText('明細追加'));
    fireEvent.change(selects[0], {
      target: { value: 'project-2' },
    });
    fireEvent.change(screen.getByDisplayValue('100000'), {
      target: { value: '75000' },
    });
    fireEvent.change(screen.getByDisplayValue('10'), {
      target: { value: '8' },
    });
    fireEvent.change(screen.getByDisplayValue('10000'), {
      target: { value: '6000' },
    });
    fireEvent.change(selects[1], {
      target: { value: '' },
    });
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '理由を更新' },
    });
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));

    expect(props.onToggleExpanded).toHaveBeenCalledTimes(1);
    expect(props.onAddRow).toHaveBeenCalledTimes(1);
    expect(props.onUpdateAllocation).toHaveBeenNthCalledWith(1, 0, {
      projectId: 'project-2',
    });
    expect(props.onUpdateAllocation).toHaveBeenNthCalledWith(2, 0, {
      amount: '75000',
    });
    expect(props.onUpdateAllocation).toHaveBeenNthCalledWith(3, 0, {
      taxRate: '8',
    });
    expect(props.onUpdateAllocation).toHaveBeenNthCalledWith(4, 0, {
      taxAmount: '6000',
    });
    expect(props.onUpdateAllocation).toHaveBeenNthCalledWith(5, 0, {
      purchaseOrderLineId: '',
    });
    expect(props.onChangeReason).toHaveBeenCalledWith('理由を更新');
    expect(props.onRemoveAllocation).toHaveBeenCalledWith(0);
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('renders collapsed and empty states without PDF iframe', () => {
    render(
      <VendorInvoiceAllocationDialog
        {...createProps({
          expanded: false,
          allocations: [],
          allocationTotals: null,
          allocationTaxRateSummary: [],
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
      screen.getByRole('button', { name: '配賦明細を入力' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('明細追加')).not.toBeInTheDocument();
    expect(screen.queryByTitle('vendor-invoice-pdf')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('変更理由（任意）')).toBeInTheDocument();
  });

  it('renders loading, empty allocations, and success message', () => {
    const { rerender } = render(
      <VendorInvoiceAllocationDialog
        {...createProps({
          loading: true,
          allocations: [],
          allocationTotals: null,
          allocationTaxRateSummary: [],
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
    expect(screen.getByText('配賦明細を読み込み中...')).toBeInTheDocument();

    rerender(
      <VendorInvoiceAllocationDialog
        {...createProps({
          loading: false,
          allocations: [],
          allocationTotals: null,
          allocationTaxRateSummary: [],
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

    expect(screen.getByText('配賦明細は未入力です')).toBeInTheDocument();
    expect(screen.getByText('保存しました')).toBeInTheDocument();
  });
});

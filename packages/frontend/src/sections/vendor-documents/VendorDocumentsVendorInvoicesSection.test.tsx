import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../ui', () => ({
  Button: ({
    children,
    variant,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => (
    <button type="button" {...props}>
      {children}
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
    filters: React.ReactNode;
    table: React.ReactNode;
  }) => (
    <section>
      <h4>{title}</h4>
      <p>{description}</p>
      <div>{filters}</div>
      <div>{table}</div>
    </section>
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
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input {...props} />
  ),
  Select: ({
    children,
    ...props
  }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <select {...props}>{children}</select>
  ),
  Toast: ({
    title,
    description,
    dismissible,
    onClose,
  }: {
    title: string;
    description: string;
    dismissible?: boolean;
    onClose?: () => void;
  }) => (
    <div>
      <strong>{title}</strong>
      <span>{description}</span>
      {dismissible ? (
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      ) : null}
    </div>
  ),
}));

import { VendorDocumentsVendorInvoicesSection } from './VendorDocumentsVendorInvoicesSection';

afterEach(() => {
  cleanup();
});

function createProps(
  overrides: Partial<
    React.ComponentProps<typeof VendorDocumentsVendorInvoicesSection>
  > = {},
): React.ComponentProps<typeof VendorDocumentsVendorInvoicesSection> {
  return {
    active: true,
    invoiceForm: {
      projectId: 'project-1',
      vendorId: 'vendor-1',
      purchaseOrderId: 'po-1',
      vendorInvoiceNo: 'INV-001',
      receivedDate: '2026-03-05',
      dueDate: '2026-03-31',
      currency: 'JPY',
      totalAmount: 240000,
      documentUrl: 'https://example.com/invoice.pdf',
    },
    projects: [
      { id: 'project-1', code: 'P001', name: 'Project One' },
      { id: 'project-2', code: 'P002', name: 'Project Two' },
    ],
    vendors: [
      { id: 'vendor-1', code: 'V001', name: 'Vendor One' },
      { id: 'vendor-2', code: 'V002', name: 'Vendor Two' },
    ],
    availablePurchaseOrders: [
      { id: 'po-1', poNo: 'PO-001' },
      { id: 'po-2', poNo: 'PO-002' },
    ],
    missingNumberLabel: '番号未設定',
    isInvoiceSaving: false,
    onChangeInvoiceForm: vi.fn(),
    onCreateVendorInvoice: vi.fn(),
    invoiceResult: { text: '請求登録しました', type: 'error' },
    onDismissInvoiceResult: vi.fn(),
    invoiceSavedViewBar: <div>saved view bar</div>,
    onReloadVendorInvoices: vi.fn(),
    invoiceSearch: 'INV-001',
    onChangeInvoiceSearch: vi.fn(),
    invoiceStatusFilter: 'draft',
    onChangeInvoiceStatusFilter: vi.fn(),
    invoiceStatusOptions: ['draft', 'approved'],
    onClearInvoiceFilters: vi.fn(),
    vendorInvoiceListContent: <div>invoice table</div>,
    normalizeCurrency: vi.fn((value: string) => value.trim().toUpperCase()),
    ...overrides,
  };
}

describe('VendorDocumentsVendorInvoicesSection', () => {
  it('updates form fields, renders saved views, and delegates filter actions', () => {
    const props = createProps();

    render(<VendorDocumentsVendorInvoicesSection {...props} />);

    fireEvent.change(screen.getByDisplayValue('P001 / Project One'), {
      target: { value: 'project-2' },
    });
    fireEvent.change(screen.getByDisplayValue('V001 / Vendor One'), {
      target: { value: 'vendor-2' },
    });
    fireEvent.change(screen.getByDisplayValue('PO-001'), {
      target: { value: 'po-2' },
    });
    fireEvent.change(screen.getByPlaceholderText('請求番号'), {
      target: { value: 'INV-002' },
    });
    fireEvent.change(screen.getByPlaceholderText('金額'), {
      target: { value: '360000' },
    });
    fireEvent.change(screen.getByPlaceholderText('通貨'), {
      target: { value: ' usd ' },
    });
    fireEvent.change(screen.getByDisplayValue('2026-03-05'), {
      target: { value: '2026-03-08' },
    });
    fireEvent.change(screen.getByDisplayValue('2026-03-31'), {
      target: { value: '2026-04-10' },
    });
    fireEvent.change(screen.getByPlaceholderText('書類URL'), {
      target: { value: 'https://example.com/invoice-2.pdf' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登録' }));
    fireEvent.click(screen.getByRole('button', { name: '再取得' }));
    fireEvent.change(screen.getByLabelText('仕入請求検索'), {
      target: { value: 'INV-002' },
    });
    fireEvent.change(screen.getByLabelText('仕入請求状態フィルタ'), {
      target: { value: 'approved' },
    });
    fireEvent.click(screen.getByRole('button', { name: '条件クリア' }));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));

    expect(screen.getByText('saved view bar')).toBeInTheDocument();
    expect(props.onChangeInvoiceForm).toHaveBeenNthCalledWith(1, {
      ...props.invoiceForm,
      projectId: 'project-2',
    });
    expect(props.onChangeInvoiceForm).toHaveBeenNthCalledWith(2, {
      ...props.invoiceForm,
      vendorId: 'vendor-2',
    });
    expect(props.onChangeInvoiceForm).toHaveBeenNthCalledWith(3, {
      ...props.invoiceForm,
      purchaseOrderId: 'po-2',
    });
    expect(props.onChangeInvoiceForm).toHaveBeenNthCalledWith(4, {
      ...props.invoiceForm,
      vendorInvoiceNo: 'INV-002',
    });
    expect(props.onChangeInvoiceForm).toHaveBeenNthCalledWith(5, {
      ...props.invoiceForm,
      totalAmount: 360000,
    });
    expect(props.normalizeCurrency).toHaveBeenCalledWith(' usd ');
    expect(props.onChangeInvoiceForm).toHaveBeenNthCalledWith(6, {
      ...props.invoiceForm,
      currency: 'USD',
    });
    expect(props.onChangeInvoiceForm).toHaveBeenNthCalledWith(7, {
      ...props.invoiceForm,
      receivedDate: '2026-03-08',
    });
    expect(props.onChangeInvoiceForm).toHaveBeenNthCalledWith(8, {
      ...props.invoiceForm,
      dueDate: '2026-04-10',
    });
    expect(props.onChangeInvoiceForm).toHaveBeenNthCalledWith(9, {
      ...props.invoiceForm,
      documentUrl: 'https://example.com/invoice-2.pdf',
    });
    expect(props.onCreateVendorInvoice).toHaveBeenCalledTimes(1);
    expect(props.onReloadVendorInvoices).toHaveBeenCalledTimes(1);
    expect(props.onChangeInvoiceSearch).toHaveBeenCalledWith('INV-002');
    expect(props.onChangeInvoiceStatusFilter).toHaveBeenCalledWith('approved');
    expect(props.onClearInvoiceFilters).toHaveBeenCalledTimes(1);
    expect(props.onDismissInvoiceResult).toHaveBeenCalledTimes(1);
    expect(screen.getByText('invoice table')).toBeInTheDocument();
  });

  it('renders inactive section and uses missing purchase order label', () => {
    render(
      <VendorDocumentsVendorInvoicesSection
        {...createProps({
          active: false,
          isInvoiceSaving: true,
          invoiceResult: null,
          availablePurchaseOrders: [{ id: 'po-1', poNo: null }],
          invoiceSearch: '',
          invoiceStatusFilter: 'all',
        })}
      />,
    );

    const section = screen
      .getByRole('heading', { name: '仕入請求', hidden: true })
      .closest('section');
    expect(section).toHaveAttribute('hidden');
    expect(section).toHaveStyle({ display: 'none' });
    expect(
      screen.getByRole('button', { name: '登録中', hidden: true }),
    ).toBeDisabled();
    expect(screen.getByText('番号未設定')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '条件クリア', hidden: true }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('請求登録しました')).not.toBeInTheDocument();
  });
});

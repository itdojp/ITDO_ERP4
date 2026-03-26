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

import { VendorDocumentsPurchaseOrdersSection } from './VendorDocumentsPurchaseOrdersSection';

afterEach(() => {
  cleanup();
});

function createProps(
  overrides: Partial<
    React.ComponentProps<typeof VendorDocumentsPurchaseOrdersSection>
  > = {},
): React.ComponentProps<typeof VendorDocumentsPurchaseOrdersSection> {
  return {
    active: true,
    poForm: {
      projectId: 'project-1',
      vendorId: 'vendor-1',
      issueDate: '2026-03-10',
      dueDate: '2026-03-25',
      currency: 'JPY',
      totalAmount: 98000,
    },
    projects: [
      { id: 'project-1', code: 'P001', name: 'Project One' },
      { id: 'project-2', code: 'P002', name: 'Project Two' },
    ],
    vendors: [
      { id: 'vendor-1', code: 'V001', name: 'Vendor One' },
      { id: 'vendor-2', code: 'V002', name: 'Vendor Two' },
    ],
    isPoSaving: false,
    onChangePoForm: vi.fn(),
    onCreatePurchaseOrder: vi.fn(),
    poResult: { text: '作成しました', type: 'error' },
    onDismissPoResult: vi.fn(),
    onReloadPurchaseOrders: vi.fn(),
    poSearch: 'PO-001',
    onChangePoSearch: vi.fn(),
    poStatusFilter: 'draft',
    onChangePoStatusFilter: vi.fn(),
    poStatusOptions: ['draft', 'sent'],
    onClearPoFilters: vi.fn(),
    purchaseOrderListContent: <div>purchase order table</div>,
    normalizeCurrency: vi.fn((value: string) => value.trim().toUpperCase()),
    ...overrides,
  };
}

describe('VendorDocumentsPurchaseOrdersSection', () => {
  it('updates form fields and delegates filter actions', () => {
    const props = createProps();

    render(<VendorDocumentsPurchaseOrdersSection {...props} />);

    fireEvent.change(screen.getByDisplayValue('P001 / Project One'), {
      target: { value: 'project-2' },
    });
    fireEvent.change(screen.getByDisplayValue('V001 / Vendor One'), {
      target: { value: 'vendor-2' },
    });
    fireEvent.change(screen.getByPlaceholderText('金額'), {
      target: { value: '150000' },
    });
    fireEvent.change(screen.getByPlaceholderText('通貨'), {
      target: { value: ' usd ' },
    });
    fireEvent.change(screen.getByDisplayValue('2026-03-10'), {
      target: { value: '2026-03-15' },
    });
    fireEvent.change(screen.getByDisplayValue('2026-03-25'), {
      target: { value: '2026-03-28' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登録' }));
    fireEvent.click(screen.getByRole('button', { name: '再取得' }));
    fireEvent.change(screen.getByLabelText('発注書検索'), {
      target: { value: 'PO-002' },
    });
    fireEvent.change(screen.getByLabelText('発注書状態フィルタ'), {
      target: { value: 'sent' },
    });
    fireEvent.click(screen.getByRole('button', { name: '条件クリア' }));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));

    expect(props.onChangePoForm).toHaveBeenNthCalledWith(1, {
      ...props.poForm,
      projectId: 'project-2',
    });
    expect(props.onChangePoForm).toHaveBeenNthCalledWith(2, {
      ...props.poForm,
      vendorId: 'vendor-2',
    });
    expect(props.onChangePoForm).toHaveBeenNthCalledWith(3, {
      ...props.poForm,
      totalAmount: 150000,
    });
    expect(props.normalizeCurrency).toHaveBeenCalledWith(' usd ');
    expect(props.onChangePoForm).toHaveBeenNthCalledWith(4, {
      ...props.poForm,
      currency: 'USD',
    });
    expect(props.onChangePoForm).toHaveBeenNthCalledWith(5, {
      ...props.poForm,
      issueDate: '2026-03-15',
    });
    expect(props.onChangePoForm).toHaveBeenNthCalledWith(6, {
      ...props.poForm,
      dueDate: '2026-03-28',
    });
    expect(props.onCreatePurchaseOrder).toHaveBeenCalledTimes(1);
    expect(props.onReloadPurchaseOrders).toHaveBeenCalledTimes(1);
    expect(props.onChangePoSearch).toHaveBeenCalledWith('PO-002');
    expect(props.onChangePoStatusFilter).toHaveBeenCalledWith('sent');
    expect(props.onClearPoFilters).toHaveBeenCalledTimes(1);
    expect(props.onDismissPoResult).toHaveBeenCalledTimes(1);
    expect(screen.getByText('purchase order table')).toBeInTheDocument();
  });

  it('renders inactive and saving states without clear action', () => {
    render(
      <VendorDocumentsPurchaseOrdersSection
        {...createProps({
          active: false,
          isPoSaving: true,
          poResult: null,
          poSearch: '',
          poStatusFilter: 'all',
        })}
      />,
    );

    const section = screen
      .getByRole('heading', { name: '発注書', hidden: true })
      .closest('section');
    expect(section).toHaveAttribute('hidden');
    expect(section).toHaveStyle({ display: 'none' });
    expect(
      screen.getByRole('button', { name: '登録中', hidden: true }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: '条件クリア', hidden: true }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('作成しました')).not.toBeInTheDocument();
  });
});

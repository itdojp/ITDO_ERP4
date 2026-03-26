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

import { VendorDocumentsVendorQuotesSection } from './VendorDocumentsVendorQuotesSection';

afterEach(() => {
  cleanup();
});

function createProps(
  overrides: Partial<
    React.ComponentProps<typeof VendorDocumentsVendorQuotesSection>
  > = {},
): React.ComponentProps<typeof VendorDocumentsVendorQuotesSection> {
  return {
    active: true,
    quoteForm: {
      projectId: 'project-1',
      vendorId: 'vendor-1',
      quoteNo: 'VQ-001',
      issueDate: '2026-03-01',
      currency: 'JPY',
      totalAmount: 120000,
      documentUrl: 'https://example.com/quote.pdf',
    },
    projects: [
      { id: 'project-1', code: 'P001', name: 'Project One' },
      { id: 'project-2', code: 'P002', name: 'Project Two' },
    ],
    vendors: [
      { id: 'vendor-1', code: 'V001', name: 'Vendor One' },
      { id: 'vendor-2', code: 'V002', name: 'Vendor Two' },
    ],
    isQuoteSaving: false,
    onChangeQuoteForm: vi.fn(),
    onCreateVendorQuote: vi.fn(),
    quoteResult: { text: '登録しました', type: 'success' },
    onDismissQuoteResult: vi.fn(),
    onReloadVendorQuotes: vi.fn(),
    quoteSearch: '初期検索',
    onChangeQuoteSearch: vi.fn(),
    quoteStatusFilter: 'pending',
    onChangeQuoteStatusFilter: vi.fn(),
    quoteStatusOptions: ['pending', 'approved'],
    onClearQuoteFilters: vi.fn(),
    vendorQuoteListContent: <div>quote table</div>,
    normalizeCurrency: vi.fn((value: string) => value.trim().toUpperCase()),
    ...overrides,
  };
}

describe('VendorDocumentsVendorQuotesSection', () => {
  it('updates form fields and delegates list actions', () => {
    const props = createProps();

    render(<VendorDocumentsVendorQuotesSection {...props} />);

    fireEvent.change(screen.getByDisplayValue('P001 / Project One'), {
      target: { value: 'project-2' },
    });
    fireEvent.change(screen.getByDisplayValue('V001 / Vendor One'), {
      target: { value: 'vendor-2' },
    });
    fireEvent.change(screen.getByPlaceholderText('見積番号'), {
      target: { value: 'VQ-002' },
    });
    fireEvent.change(screen.getByPlaceholderText('金額'), {
      target: { value: '4500' },
    });
    fireEvent.change(screen.getByPlaceholderText('通貨'), {
      target: { value: ' usd ' },
    });
    fireEvent.change(screen.getByDisplayValue('2026-03-01'), {
      target: { value: '2026-03-12' },
    });
    fireEvent.change(screen.getByPlaceholderText('書類URL'), {
      target: { value: 'https://example.com/quote-2.pdf' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登録' }));
    fireEvent.click(screen.getByRole('button', { name: '再取得' }));
    fireEvent.change(screen.getByLabelText('仕入見積検索'), {
      target: { value: '再検索' },
    });
    fireEvent.change(screen.getByLabelText('仕入見積状態フィルタ'), {
      target: { value: 'approved' },
    });
    fireEvent.click(screen.getByRole('button', { name: '条件クリア' }));
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }));

    expect(props.onChangeQuoteForm).toHaveBeenNthCalledWith(1, {
      ...props.quoteForm,
      projectId: 'project-2',
    });
    expect(props.onChangeQuoteForm).toHaveBeenNthCalledWith(2, {
      ...props.quoteForm,
      vendorId: 'vendor-2',
    });
    expect(props.onChangeQuoteForm).toHaveBeenNthCalledWith(3, {
      ...props.quoteForm,
      quoteNo: 'VQ-002',
    });
    expect(props.onChangeQuoteForm).toHaveBeenNthCalledWith(4, {
      ...props.quoteForm,
      totalAmount: 4500,
    });
    expect(props.normalizeCurrency).toHaveBeenCalledWith(' usd ');
    expect(props.onChangeQuoteForm).toHaveBeenNthCalledWith(5, {
      ...props.quoteForm,
      currency: 'USD',
    });
    expect(props.onChangeQuoteForm).toHaveBeenNthCalledWith(6, {
      ...props.quoteForm,
      issueDate: '2026-03-12',
    });
    expect(props.onChangeQuoteForm).toHaveBeenNthCalledWith(7, {
      ...props.quoteForm,
      documentUrl: 'https://example.com/quote-2.pdf',
    });
    expect(props.onCreateVendorQuote).toHaveBeenCalledTimes(1);
    expect(props.onReloadVendorQuotes).toHaveBeenCalledTimes(1);
    expect(props.onChangeQuoteSearch).toHaveBeenCalledWith('再検索');
    expect(props.onChangeQuoteStatusFilter).toHaveBeenCalledWith('approved');
    expect(props.onClearQuoteFilters).toHaveBeenCalledTimes(1);
    expect(props.onDismissQuoteResult).toHaveBeenCalledTimes(1);
    expect(screen.getByText('quote table')).toBeInTheDocument();
  });

  it('renders inactive and saving states without clear action', () => {
    render(
      <VendorDocumentsVendorQuotesSection
        {...createProps({
          active: false,
          isQuoteSaving: true,
          quoteResult: null,
          quoteSearch: '',
          quoteStatusFilter: 'all',
        })}
      />,
    );

    const section = screen
      .getByRole('heading', { name: '仕入見積', hidden: true })
      .closest('section');
    expect(section).toHaveAttribute('hidden');
    expect(section).toHaveStyle({ display: 'none' });
    expect(
      screen.getByRole('button', { name: '登録中', hidden: true }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: '条件クリア', hidden: true }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('登録しました')).not.toBeInTheDocument();
  });
});

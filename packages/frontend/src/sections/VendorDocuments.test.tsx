import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VendorDocuments } from './VendorDocuments';

const { api, apiResponse, openResponseInNewTab } = vi.hoisted(() => ({
  api: vi.fn(),
  apiResponse: vi.fn(),
  openResponseInNewTab: vi.fn(),
}));

const { savedViews } = vi.hoisted(() => ({
  savedViews: {
    views: [
      {
        id: 'saved-1',
        name: '保存ビュー',
        payload: { search: 'saved search', status: 'approved' },
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
      },
    ],
    activeViewId: 'saved-1',
    selectView: vi.fn(),
    createView: vi.fn(),
    updateView: vi.fn(),
    duplicateView: vi.fn(),
    toggleShared: vi.fn(),
    deleteView: vi.fn(),
  },
}));

vi.mock('../api', () => ({ api, apiResponse }));
vi.mock('../utils/download', () => ({
  formatDateForFilename: () => '2026-03-28',
  openResponseInNewTab,
}));
vi.mock('../components/AnnotationsCard', () => ({
  AnnotationsCard: ({ title }: { title: string }) => (
    <div data-testid="annotations-card">{title}</div>
  ),
}));

vi.mock('./vendor-documents/useVendorInvoiceSavedViews', () => ({
  useVendorInvoiceSavedViews: () => savedViews,
}));
vi.mock('./vendor-documents/useVendorDocumentsLookups', () => ({
  useVendorDocumentsLookups: () => ({
    availablePurchaseOrders: [{ id: 'po-1', poNo: 'PO-001' }],
    availablePurchaseOrdersForInvoicePoLink: [{ id: 'po-1', poNo: 'PO-001' }],
    selectedPurchaseOrderId: 'po-1',
    selectedPurchaseOrder: { id: 'po-1', poNo: 'PO-001' },
    vendorInvoicesByPurchaseOrderId: {},
    renderProject: (id: string) => `project:${id}`,
    renderVendor: (id: string) => `vendor:${id}`,
  }),
}));
vi.mock('./vendor-documents/useVendorDocumentsTableData', () => ({
  useVendorDocumentsTableData: () => ({
    purchaseOrderMap: new Map([
      [
        'po-1',
        {
          id: 'po-1',
          poNo: 'PO-001',
          status: 'draft',
          projectId: 'project-1',
          vendorId: 'vendor-1',
          currency: 'JPY',
          totalAmount: 1200,
        },
      ],
    ]),
    vendorQuoteMap: new Map([
      [
        'quote-1',
        {
          id: 'quote-1',
          quoteNo: 'QUOTE-001',
          projectId: 'project-1',
        },
      ],
    ]),
    vendorInvoiceMap: new Map([
      [
        'inv-1',
        {
          id: 'inv-1',
          vendorInvoiceNo: 'INV-001',
          status: 'draft',
          purchaseOrderId: '',
          projectId: 'project-1',
          vendorId: 'vendor-1',
        },
      ],
    ]),
    poStatusOptions: ['draft', 'approved'],
    quoteStatusOptions: ['draft'],
    invoiceStatusOptions: ['draft', 'approved'],
    purchaseOrderRows: [{ id: 'po-1', poNo: 'PO-001', status: 'draft' }],
    vendorQuoteRows: [{ id: 'quote-1', quoteNo: 'QUOTE-001', status: 'draft' }],
    vendorInvoiceRows: [
      { id: 'inv-1', vendorInvoiceNo: 'INV-001', status: 'draft' },
    ],
    purchaseOrderColumns: [
      { key: 'poNo', header: '発注番号' },
      { key: 'status', header: '状態' },
    ],
    vendorQuoteColumns: [
      { key: 'quoteNo', header: '見積番号' },
      { key: 'status', header: '状態' },
    ],
    vendorInvoiceColumns: [
      { key: 'vendorInvoiceNo', header: '請求番号' },
      { key: 'status', header: '状態' },
    ],
  }),
}));
vi.mock('./vendor-documents/useVendorInvoiceDialogs', () => ({
  useVendorInvoiceDialogs: () => ({
    invoiceAllocationDialog: null,
    invoiceAllocations: [],
    invoiceAllocationLoading: false,
    invoiceAllocationSaving: false,
    invoiceAllocationMessage: '',
    invoiceAllocationReason: '',
    invoiceAllocationExpanded: {},
    invoiceLineDialog: null,
    invoiceLines: [],
    invoiceLineLoading: false,
    invoiceLineSaving: false,
    invoiceLineMessage: '',
    invoiceLineReason: '',
    invoiceLineExpanded: {},
    invoiceLinePoUsageByPoLineId: {},
    invoiceLinePurchaseOrderDetail: null,
    allocationTotals: null,
    allocationTaxRateSummary: [],
    invoiceLineTotals: null,
    invoiceLineRequestedQuantityByPoLine: {},
    openVendorInvoiceAllocationDialog: vi.fn(),
    closeVendorInvoiceAllocationDialog: vi.fn(),
    openVendorInvoiceLineDialog: vi.fn(),
    closeVendorInvoiceLineDialog: vi.fn(),
    addVendorInvoiceAllocationRow: vi.fn(),
    updateVendorInvoiceAllocation: vi.fn(),
    removeVendorInvoiceAllocation: vi.fn(),
    saveVendorInvoiceAllocations: vi.fn(),
    setInvoiceAllocationReason: vi.fn(),
    toggleInvoiceAllocationExpanded: vi.fn(),
    addVendorInvoiceLineRow: vi.fn(),
    updateVendorInvoiceLine: vi.fn(),
    removeVendorInvoiceLine: vi.fn(),
    saveVendorInvoiceLines: vi.fn(),
    setInvoiceLineReason: vi.fn(),
    toggleInvoiceLineExpanded: vi.fn(),
  }),
}));

type AsyncStatePanelProps = {
  state: string;
  loadingText?: string;
  empty?: { title: string; description?: string };
  error?: {
    title: string;
    detail?: string;
    retryLabel?: string;
    onRetry?: () => void;
  };
};

type TabsProps = {
  value: string;
  onValueChange: (value: string) => void;
  items: Array<{ id: string; label: string }>;
};

type DataTableProps = {
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
};

vi.mock('../ui', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AsyncStatePanel: ({
    state,
    loadingText,
    empty,
    error,
  }: AsyncStatePanelProps) => (
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
      <div data-testid="confirm-action-dialog">
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
  DataTable: ({ columns, rows, rowActions }: DataTableProps) => (
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
      <div data-testid="dialog">
        <div>{title}</div>
        <div>{children}</div>
        <div>{footer}</div>
      </div>
    ) : null,
  Tabs: ({ value, onValueChange, items }: TabsProps) => (
    <div>
      <div data-testid="active-tab">{value}</div>
      {items.map((item) => (
        <button
          key={item.id}
          data-testid={`tab-${item.id}`}
          type="button"
          onClick={() => onValueChange(item.id)}
        >
          {item.label}
        </button>
      ))}
      <button
        data-testid="tab-invalid"
        type="button"
        onClick={() => onValueChange('invalid-tab')}
      >
        invalid
      </button>
    </div>
  ),
}));

type PurchaseOrdersSectionProps = {
  active: boolean;
  poForm: { projectId: string; vendorId: string };
  poSearch: string;
  poStatusFilter: string;
  poResult: { text: string; type: 'success' | 'error' } | null;
  onChangePoSearch: (value: string) => void;
  onChangePoStatusFilter: (value: string) => void;
  onClearPoFilters: () => void;
  onReloadPurchaseOrders: () => void;
  purchaseOrderListContent: React.ReactNode;
};

type VendorQuotesSectionProps = {
  active: boolean;
  quoteForm: { projectId: string; vendorId: string };
  vendorQuoteListContent: React.ReactNode;
};

type VendorInvoicesSectionProps = {
  active: boolean;
  invoiceForm: { projectId: string; vendorId: string };
  invoiceSearch: string;
  invoiceStatusFilter: string;
  invoiceSavedViewBar: React.ReactNode;
  onChangeInvoiceSearch: (value: string) => void;
  onChangeInvoiceStatusFilter: (value: string) => void;
  onClearInvoiceFilters: () => void;
  onReloadVendorInvoices: () => void;
  vendorInvoiceListContent: React.ReactNode;
};

type VendorInvoiceSavedViewBarProps = {
  savedViews: { selectView: (viewId: string) => void };
  onChangeInvoiceSearch: (value: string) => void;
  onChangeInvoiceStatusFilter: (value: string) => void;
  invoiceStatusOptions: string[];
  normalizeInvoiceStatusFilter: (value: string, options: string[]) => string;
};

vi.mock('./vendor-documents/VendorDocumentsPurchaseOrdersSection', () => ({
  VendorDocumentsPurchaseOrdersSection: ({
    active,
    poForm,
    poSearch,
    poStatusFilter,
    poResult,
    onChangePoSearch,
    onChangePoStatusFilter,
    onClearPoFilters,
    onReloadPurchaseOrders,
    purchaseOrderListContent,
  }: PurchaseOrdersSectionProps) => (
    <section data-testid="po-section" data-active={active ? 'yes' : 'no'}>
      <div data-testid="po-form-project">{poForm.projectId || '-'}</div>
      <div data-testid="po-form-vendor">{poForm.vendorId || '-'}</div>
      <div data-testid="po-search">{poSearch || '-'}</div>
      <div data-testid="po-status">{poStatusFilter}</div>
      <div data-testid="po-result">{poResult?.text || '-'}</div>
      <button type="button" onClick={() => onChangePoSearch('PO term')}>
        set-po-search
      </button>
      <button type="button" onClick={() => onChangePoStatusFilter('approved')}>
        set-po-status
      </button>
      <button type="button" onClick={onClearPoFilters}>
        clear-po-filters
      </button>
      <button type="button" onClick={onReloadPurchaseOrders}>
        reload-po
      </button>
      {purchaseOrderListContent}
    </section>
  ),
}));
vi.mock('./vendor-documents/VendorDocumentsVendorQuotesSection', () => ({
  VendorDocumentsVendorQuotesSection: ({
    active,
    quoteForm,
    vendorQuoteListContent,
  }: VendorQuotesSectionProps) => (
    <section data-testid="quote-section" data-active={active ? 'yes' : 'no'}>
      <div data-testid="quote-form-project">{quoteForm.projectId || '-'}</div>
      <div data-testid="quote-form-vendor">{quoteForm.vendorId || '-'}</div>
      {vendorQuoteListContent}
    </section>
  ),
}));
vi.mock('./vendor-documents/VendorDocumentsVendorInvoicesSection', () => ({
  VendorDocumentsVendorInvoicesSection: ({
    active,
    invoiceForm,
    invoiceSearch,
    invoiceStatusFilter,
    invoiceSavedViewBar,
    onChangeInvoiceSearch,
    onChangeInvoiceStatusFilter,
    onClearInvoiceFilters,
    onReloadVendorInvoices,
    vendorInvoiceListContent,
  }: VendorInvoicesSectionProps) => (
    <section data-testid="invoice-section" data-active={active ? 'yes' : 'no'}>
      <div data-testid="invoice-form-project">
        {invoiceForm.projectId || '-'}
      </div>
      <div data-testid="invoice-form-vendor">{invoiceForm.vendorId || '-'}</div>
      <div data-testid="invoice-search">{invoiceSearch || '-'}</div>
      <div data-testid="invoice-status">{invoiceStatusFilter}</div>
      <button
        type="button"
        onClick={() => {
          onChangeInvoiceSearch('manual search');
          onChangeInvoiceStatusFilter('approved');
        }}
      >
        set-invoice-filters
      </button>
      <button type="button" onClick={onClearInvoiceFilters}>
        clear-invoice-filters
      </button>
      <button type="button" onClick={onReloadVendorInvoices}>
        reload-invoices
      </button>
      {invoiceSavedViewBar}
      {vendorInvoiceListContent}
    </section>
  ),
}));
vi.mock('./vendor-documents/VendorInvoiceSavedViewBar', () => ({
  VendorInvoiceSavedViewBar: ({
    savedViews,
    onChangeInvoiceSearch,
    onChangeInvoiceStatusFilter,
    invoiceStatusOptions,
    normalizeInvoiceStatusFilter,
  }: VendorInvoiceSavedViewBarProps) => (
    <div data-testid="invoice-saved-view-bar">
      <button
        type="button"
        onClick={() => {
          savedViews.selectView('saved-1');
          onChangeInvoiceSearch('saved search');
          onChangeInvoiceStatusFilter(
            normalizeInvoiceStatusFilter('approved', invoiceStatusOptions),
          );
        }}
      >
        apply-saved-view
      </button>
    </div>
  ),
}));
vi.mock('./vendor-documents/PurchaseOrderSendLogsDialog', () => ({
  PurchaseOrderSendLogsDialog: ({
    open,
    purchaseOrderId,
    message,
    logs,
    onClose,
    onOpenPdf,
  }: {
    open: boolean;
    purchaseOrderId?: string | null;
    message: string;
    logs: unknown[];
    onClose: () => void;
    onOpenPdf: (purchaseOrderId: string, pdfUrl?: string | null) => void;
  }) =>
    open ? (
      <div data-testid="po-send-logs-dialog">
        <div>{purchaseOrderId}</div>
        <div>{String(logs.length)}</div>
        <div>{message}</div>
        <button
          type="button"
          onClick={() => onOpenPdf(purchaseOrderId || '', null)}
        >
          open-missing-pdf
        </button>
        <button type="button" onClick={onClose}>
          close-po-send-logs
        </button>
      </div>
    ) : null,
}));
vi.mock('./vendor-documents/VendorInvoicePoLinkDialog', () => ({
  VendorInvoicePoLinkDialog: ({
    open,
    dialog,
    result,
    onClose,
    onSave,
    onChangePurchaseOrderId,
  }: {
    open: boolean;
    dialog: { purchaseOrderId: string; invoice: { id: string } } | null;
    result: { text: string } | null;
    onClose: () => void;
    onSave: () => void;
    onChangePurchaseOrderId: (value: string) => void;
  }) =>
    open ? (
      <div data-testid="invoice-po-link-dialog">
        <div>{dialog?.invoice.id}</div>
        <div>{dialog?.purchaseOrderId || '-'}</div>
        <div>{result?.text || ''}</div>
        <button type="button" onClick={() => onChangePurchaseOrderId('po-1')}>
          choose-po-1
        </button>
        <button type="button" onClick={onSave}>
          save-po-link
        </button>
        <button type="button" onClick={onClose}>
          close-po-link
        </button>
      </div>
    ) : null,
}));
vi.mock('./vendor-documents/VendorInvoiceAllocationDialog', () => ({
  VendorInvoiceAllocationDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="invoice-allocation-dialog" /> : null,
}));
vi.mock('./vendor-documents/VendorInvoiceLineDialog', () => ({
  VendorInvoiceLineDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="invoice-line-dialog" /> : null,
}));

function installApiMock(options?: {
  failProjects?: boolean;
  failVendors?: boolean;
}) {
  const failProjects = options?.failProjects ?? false;
  const failVendors = options?.failVendors ?? false;
  vi.mocked(api).mockImplementation(
    async (path: string, init?: { method?: string; body?: string }) => {
      const method = init?.method || 'GET';
      if (path === '/projects') {
        if (failProjects) throw new Error('projects failed');
        return {
          items: [{ id: 'project-1', code: 'P001', name: '案件A' }],
        };
      }
      if (path === '/vendors') {
        if (failVendors) throw new Error('vendors failed');
        return {
          items: [{ id: 'vendor-1', code: 'V001', name: '業者A' }],
        };
      }
      if (path === '/purchase-orders') {
        return {
          items: [
            {
              id: 'po-1',
              poNo: 'PO-001',
              status: 'draft',
              projectId: 'project-1',
              vendorId: 'vendor-1',
              currency: 'JPY',
              totalAmount: 1200,
            },
          ],
        };
      }
      if (path === '/vendor-quotes') {
        return {
          items: [
            {
              id: 'quote-1',
              quoteNo: 'QUOTE-001',
              status: 'draft',
              projectId: 'project-1',
              vendorId: 'vendor-1',
            },
          ],
        };
      }
      if (path === '/vendor-invoices') {
        return {
          items: [
            {
              id: 'inv-1',
              vendorInvoiceNo: 'INV-001',
              status: 'draft',
              projectId: 'project-1',
              vendorId: 'vendor-1',
              purchaseOrderId: '',
            },
          ],
        };
      }
      if (path === '/purchase-orders/po-1/submit' && method === 'POST') {
        return { ok: true };
      }
      if (path === '/purchase-orders/po-1') {
        return {
          id: 'po-1',
          poNo: 'PO-001',
          status: 'draft',
          projectId: 'project-1',
          vendorId: 'vendor-1',
          currency: 'JPY',
          totalAmount: 1200,
          lineItems: [],
        };
      }
      if (path === '/purchase-orders/po-1/send-logs') {
        return {
          items: [
            {
              id: 'send-log-1',
              channel: 'email',
              status: 'sent',
              sentAt: '2026-03-28T00:00:00.000Z',
            },
          ],
        };
      }
      if (path === '/vendor-invoices/inv-1/link-po' && method === 'POST') {
        return { ok: true };
      }
      throw new Error(`Unhandled api path: ${method} ${path}`);
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  installApiMock();
});

afterEach(() => {
  cleanup();
});

describe('VendorDocuments', () => {
  it('loads initial lookups and auto-selects the first project and vendor', async () => {
    render(<VendorDocuments />);

    await waitFor(() => {
      expect(screen.getByTestId('po-form-project')).toHaveTextContent(
        'project-1',
      );
    });

    expect(screen.getByTestId('po-form-vendor')).toHaveTextContent('vendor-1');
    expect(screen.getByTestId('quote-form-project')).toHaveTextContent(
      'project-1',
    );
    expect(screen.getByTestId('invoice-form-vendor')).toHaveTextContent(
      'vendor-1',
    );
    expect(screen.getByTestId('tab-purchase-orders')).toHaveTextContent(
      '発注書 (1)',
    );
    expect(screen.getByTestId('tab-vendor-quotes')).toHaveTextContent(
      '仕入見積 (1)',
    );
    expect(screen.getByTestId('tab-vendor-invoices')).toHaveTextContent(
      '仕入請求 (1)',
    );
  });

  it('shows top-level lookup failure alerts and ignores invalid tab changes', async () => {
    installApiMock({ failProjects: true, failVendors: true });

    render(<VendorDocuments />);

    await waitFor(() => {
      expect(
        screen.getByText('案件一覧の取得に失敗しました'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText('業者一覧の取得に失敗しました'),
    ).toBeInTheDocument();

    expect(screen.getByTestId('active-tab')).toHaveTextContent(
      'purchase-orders',
    );
    fireEvent.click(screen.getByTestId('tab-invalid'));
    expect(screen.getByTestId('active-tab')).toHaveTextContent(
      'purchase-orders',
    );

    fireEvent.click(screen.getByTestId('tab-vendor-invoices'));
    expect(screen.getByTestId('active-tab')).toHaveTextContent(
      'vendor-invoices',
    );
    expect(screen.getByTestId('invoice-section')).toHaveAttribute(
      'data-active',
      'yes',
    );
  });

  it('updates invoice filters through saved views and clears them', async () => {
    render(<VendorDocuments />);

    await waitFor(() => {
      expect(screen.getByTestId('invoice-search')).toHaveTextContent('-');
    });

    fireEvent.click(screen.getByTestId('tab-vendor-invoices'));
    fireEvent.click(screen.getByText('set-invoice-filters'));
    expect(screen.getByTestId('invoice-search')).toHaveTextContent(
      'manual search',
    );
    expect(screen.getByTestId('invoice-status')).toHaveTextContent('approved');

    fireEvent.click(screen.getByText('apply-saved-view'));
    expect(savedViews.selectView).toHaveBeenCalledWith('saved-1');
    expect(screen.getByTestId('invoice-search')).toHaveTextContent(
      'saved search',
    );
    expect(screen.getByTestId('invoice-status')).toHaveTextContent('approved');

    fireEvent.click(screen.getByText('clear-invoice-filters'));
    expect(screen.getByTestId('invoice-search')).toHaveTextContent('-');
    expect(screen.getByTestId('invoice-status')).toHaveTextContent('all');
  });

  it('opens purchase order send logs and handles missing pdf URLs', async () => {
    render(<VendorDocuments />);

    await waitFor(() => {
      expect(screen.getByText('送信履歴:po-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('送信履歴:po-1'));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/purchase-orders/po-1/send-logs');
    });

    expect(screen.getByTestId('po-send-logs-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('open-missing-pdf'));
    expect(screen.getByText('PDF URL がありません')).toBeInTheDocument();
  });

  it('confirms purchase order submission and supports invoice PO linking plus annotations', async () => {
    render(<VendorDocuments />);

    await waitFor(() => {
      expect(screen.getByText('承認依頼:po-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('承認依頼:po-1'));
    expect(screen.getByTestId('confirm-action-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('実行'));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/purchase-orders/po-1/submit', {
        method: 'POST',
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('po-result')).toHaveTextContent(
        '発注書を承認依頼しました',
      );
    });

    fireEvent.click(screen.getByTestId('tab-vendor-invoices'));
    fireEvent.click(screen.getByText('PO紐づけ:inv-1'));
    expect(screen.getByTestId('invoice-po-link-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByText('choose-po-1'));
    fireEvent.click(screen.getByText('save-po-link'));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/vendor-invoices/inv-1/link-po', {
        method: 'POST',
        body: JSON.stringify({ purchaseOrderId: 'po-1' }),
      });
    });

    fireEvent.click(screen.getByText('注釈:inv-1'));
    expect(screen.getByTestId('annotations-card')).toHaveTextContent(
      '仕入請求: INV-001',
    );
    fireEvent.click(screen.getByText('閉じる'));
    expect(screen.queryByTestId('annotations-card')).not.toBeInTheDocument();
  });
});

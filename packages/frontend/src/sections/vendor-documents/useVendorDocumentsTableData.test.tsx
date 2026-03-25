import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useVendorDocumentsTableData } from './useVendorDocumentsTableData';
import type {
  PurchaseOrder,
  VendorInvoice,
  VendorQuote,
} from './vendorDocumentsShared';

const purchaseOrders: PurchaseOrder[] = [
  {
    id: 'po-1',
    poNo: 'PO-001',
    projectId: 'proj-1',
    vendorId: 'vendor-1',
    issueDate: '2026-03-01',
    dueDate: '2026-03-10',
    currency: 'JPY',
    totalAmount: 100000,
    status: 'approved',
  },
  {
    id: 'po-2',
    poNo: null,
    projectId: 'proj-2',
    vendorId: 'vendor-2',
    issueDate: '2026-03-02',
    dueDate: null,
    currency: 'JPY',
    totalAmount: 200000,
    status: 'draft',
  },
];

const vendorQuotes: VendorQuote[] = [
  {
    id: 'quote-1',
    quoteNo: 'QT-001',
    projectId: 'proj-1',
    vendorId: 'vendor-1',
    issueDate: '2026-02-28',
    currency: 'JPY',
    totalAmount: 50000,
    status: 'sent',
  },
  {
    id: 'quote-2',
    quoteNo: null,
    projectId: 'proj-2',
    vendorId: 'vendor-2',
    issueDate: null,
    currency: 'JPY',
    totalAmount: 60000,
    status: 'draft',
  },
];

const vendorInvoices: VendorInvoice[] = [
  {
    id: 'inv-1',
    vendorInvoiceNo: 'INV-001',
    projectId: 'proj-1',
    vendorId: 'vendor-1',
    purchaseOrderId: 'po-1',
    purchaseOrder: { id: 'po-1', poNo: 'PO-001' },
    receivedDate: '2026-03-03',
    dueDate: '2026-03-31',
    currency: 'JPY',
    totalAmount: 30000,
    status: 'received',
    documentUrl: null,
  },
  {
    id: 'inv-2',
    vendorInvoiceNo: 'INV-002',
    projectId: 'proj-1',
    vendorId: 'vendor-1',
    purchaseOrderId: 'po-1',
    purchaseOrder: { id: 'po-1', poNo: 'PO-001' },
    receivedDate: '2026-03-04',
    dueDate: '2026-03-31',
    currency: 'JPY',
    totalAmount: 31000,
    status: 'received',
    documentUrl: null,
  },
  {
    id: 'inv-3',
    vendorInvoiceNo: 'INV-003',
    projectId: 'proj-1',
    vendorId: 'vendor-1',
    purchaseOrderId: 'po-1',
    purchaseOrder: { id: 'po-1', poNo: 'PO-001' },
    receivedDate: '2026-03-05',
    dueDate: '2026-03-31',
    currency: 'JPY',
    totalAmount: 32000,
    status: 'received',
    documentUrl: null,
  },
  {
    id: 'inv-4',
    vendorInvoiceNo: 'INV-004',
    projectId: 'proj-1',
    vendorId: 'vendor-1',
    purchaseOrderId: 'po-1',
    purchaseOrder: { id: 'po-1', poNo: 'PO-001' },
    receivedDate: '2026-03-06',
    dueDate: '2026-03-31',
    currency: 'JPY',
    totalAmount: 33000,
    status: 'received',
    documentUrl: null,
  },
  {
    id: 'inv-5',
    vendorInvoiceNo: null,
    projectId: 'proj-2',
    vendorId: 'vendor-2',
    purchaseOrderId: 'po-2',
    purchaseOrder: null,
    receivedDate: null,
    dueDate: null,
    currency: 'JPY',
    totalAmount: 34000,
    status: 'draft',
    documentUrl: null,
  },
];

const vendorInvoicesByPurchaseOrderId = new Map<string, VendorInvoice[]>([
  ['po-1', vendorInvoices.slice(0, 4)],
  ['po-2', [vendorInvoices[4]]],
]);

const renderProject = (projectId: string) =>
  ({ 'proj-1': 'P001 / Project One', 'proj-2': 'P002 / Project Two' })[
    projectId
  ] ?? projectId;

const renderVendor = (vendorId: string) =>
  ({ 'vendor-1': 'V001 / Vendor One', 'vendor-2': 'V002 / Vendor Two' })[
    vendorId
  ] ?? vendorId;

describe('useVendorDocumentsTableData', () => {
  it('builds status options, row summaries, and column definitions', () => {
    const expectedTotalAmount = `${(100000).toLocaleString()} JPY`;
    const { result } = renderHook(() =>
      useVendorDocumentsTableData({
        purchaseOrders,
        vendorQuotes,
        vendorInvoices,
        vendorInvoicesByPurchaseOrderId,
        poSearch: '',
        poStatusFilter: 'all',
        quoteSearch: '',
        quoteStatusFilter: 'all',
        invoiceSearch: '',
        invoiceStatusFilter: 'all',
        missingNumberLabel: '未設定',
        renderProject,
        renderVendor,
      }),
    );

    expect(result.current.poStatusOptions).toEqual(['approved', 'draft']);
    expect(result.current.quoteStatusOptions).toEqual(['draft', 'sent']);
    expect(result.current.invoiceStatusOptions).toEqual(['draft', 'received']);
    expect(result.current.purchaseOrderMap.get('po-1')).toBe(purchaseOrders[0]);
    expect(result.current.vendorQuoteMap.get('quote-1')).toBe(vendorQuotes[0]);
    expect(result.current.vendorInvoiceMap.get('inv-1')).toBe(
      vendorInvoices[0],
    );

    expect(result.current.purchaseOrderRows).toEqual([
      expect.objectContaining({
        id: 'po-1',
        poNo: 'PO-001',
        project: 'P001 / Project One',
        vendor: 'V001 / Vendor One',
        totalAmount: expectedTotalAmount,
        schedule: '発行 2026-03-01 / 納期 2026-03-10',
        linkedInvoices: '4件 (INV-001, INV-002, INV-003 他1件)',
      }),
      expect.objectContaining({
        id: 'po-2',
        poNo: '未設定',
        linkedInvoices: '1件 (未設定)',
      }),
    ]);

    expect(result.current.vendorQuoteRows).toEqual([
      expect.objectContaining({
        id: 'quote-1',
        quoteNo: 'QT-001',
        issueDate: '2026-02-28',
      }),
      expect.objectContaining({
        id: 'quote-2',
        quoteNo: '未設定',
        issueDate: '-',
      }),
    ]);

    expect(result.current.vendorInvoiceRows).toEqual([
      expect.objectContaining({
        id: 'inv-1',
        vendorInvoiceNo: 'INV-001',
        schedule: '受領 2026-03-03 / 期限 2026-03-31',
        purchaseOrder: 'PO-001',
      }),
      expect.objectContaining({
        id: 'inv-2',
      }),
      expect.objectContaining({
        id: 'inv-3',
      }),
      expect.objectContaining({
        id: 'inv-4',
      }),
      expect.objectContaining({
        id: 'inv-5',
        vendorInvoiceNo: '未設定',
        schedule: '受領 - / 期限 -',
        purchaseOrder: 'po-2',
      }),
    ]);

    expect(
      result.current.purchaseOrderColumns.map((column) => column.key),
    ).toEqual([
      'poNo',
      'project',
      'vendor',
      'status',
      'totalAmount',
      'schedule',
      'linkedInvoices',
    ]);
    expect(
      result.current.vendorQuoteColumns.map((column) => column.key),
    ).toEqual([
      'quoteNo',
      'project',
      'vendor',
      'status',
      'totalAmount',
      'issueDate',
    ]);
    expect(
      result.current.vendorInvoiceColumns.map((column) => column.key),
    ).toEqual([
      'vendorInvoiceNo',
      'project',
      'vendor',
      'status',
      'totalAmount',
      'schedule',
      'purchaseOrder',
    ]);
  });

  it('filters tables by search text and selected status', () => {
    const { result } = renderHook(() =>
      useVendorDocumentsTableData({
        purchaseOrders,
        vendorQuotes,
        vendorInvoices,
        vendorInvoicesByPurchaseOrderId,
        poSearch: 'inv-004',
        poStatusFilter: 'approved',
        quoteSearch: 'project two',
        quoteStatusFilter: 'draft',
        invoiceSearch: 'po-001',
        invoiceStatusFilter: 'received',
        missingNumberLabel: '未設定',
        renderProject,
        renderVendor,
      }),
    );

    expect(result.current.purchaseOrderRows.map((row) => row.id)).toEqual([
      'po-1',
    ]);
    expect(result.current.vendorQuoteRows.map((row) => row.id)).toEqual([
      'quote-2',
    ]);
    expect(result.current.vendorInvoiceRows.map((row) => row.id)).toEqual([
      'inv-1',
      'inv-2',
      'inv-3',
      'inv-4',
    ]);
  });
});

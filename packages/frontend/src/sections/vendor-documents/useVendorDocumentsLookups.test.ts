import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useVendorDocumentsLookups } from './useVendorDocumentsLookups';
import type {
  ProjectOption,
  PurchaseOrder,
  PurchaseOrderDetail,
  VendorInvoice,
  VendorOption,
} from './vendorDocumentsShared';

const projects: ProjectOption[] = [
  { id: 'proj-1', code: 'P001', name: 'Project One' },
  { id: 'proj-2', code: 'P002', name: 'Project Two' },
];

const vendors: VendorOption[] = [
  { id: 'vendor-1', code: 'V001', name: 'Vendor One' },
  { id: 'vendor-2', code: 'V002', name: 'Vendor Two' },
];

const purchaseOrders: PurchaseOrder[] = [
  {
    id: 'po-1',
    poNo: 'PO-001',
    projectId: 'proj-1',
    vendorId: 'vendor-1',
    status: 'approved',
    totalAmount: 1000,
    currency: 'JPY',
    issueDate: '2026-03-01',
    dueDate: null,
  },
  {
    id: 'po-2',
    poNo: 'PO-002',
    projectId: 'proj-2',
    vendorId: 'vendor-2',
    status: 'approved',
    totalAmount: 2000,
    currency: 'JPY',
    issueDate: '2026-03-02',
    dueDate: null,
  },
];

const vendorInvoices: VendorInvoice[] = [
  {
    id: 'inv-1',
    vendorInvoiceNo: 'INV-001',
    vendorId: 'vendor-1',
    projectId: 'proj-1',
    purchaseOrderId: 'po-1',
    receivedDate: '2026-03-10',
    dueDate: '2026-03-31',
    totalAmount: 1100,
    status: 'draft',
    currency: 'JPY',
    documentUrl: null,
  },
  {
    id: 'inv-2',
    vendorInvoiceNo: 'INV-002',
    vendorId: 'vendor-1',
    projectId: 'proj-1',
    purchaseOrderId: 'po-1',
    receivedDate: '2026-03-11',
    dueDate: '2026-03-31',
    totalAmount: 1200,
    status: 'draft',
    currency: 'JPY',
    documentUrl: null,
  },
  {
    id: 'inv-3',
    vendorInvoiceNo: 'INV-003',
    vendorId: 'vendor-2',
    projectId: 'proj-2',
    purchaseOrderId: null,
    receivedDate: '2026-03-12',
    dueDate: '2026-03-31',
    totalAmount: 1300,
    status: 'draft',
    currency: 'JPY',
    documentUrl: null,
  },
];

const purchaseOrderDetails: Record<string, PurchaseOrderDetail> = {
  'po-1': {
    ...purchaseOrders[0],
    lines: [],
  },
};

describe('useVendorDocumentsLookups', () => {
  it('builds filtered lookups and render helpers', () => {
    const { result } = renderHook(() =>
      useVendorDocumentsLookups({
        projects,
        vendors,
        purchaseOrders,
        vendorInvoices,
        invoiceForm: { projectId: 'proj-1', vendorId: 'vendor-1' },
        invoicePoLinkDialog: {
          invoice: vendorInvoices[0],
          purchaseOrderId: ' po-1 ',
        },
        purchaseOrderDetails,
      }),
    );

    expect(result.current.availablePurchaseOrders.map((po) => po.id)).toEqual([
      'po-1',
    ]);
    expect(
      result.current.availablePurchaseOrdersForInvoicePoLink.map((po) => po.id),
    ).toEqual(['po-1']);
    expect(result.current.selectedPurchaseOrderId).toBe('po-1');
    expect(result.current.selectedPurchaseOrder).toBe(
      purchaseOrderDetails['po-1'],
    );
    expect(
      result.current.vendorInvoicesByPurchaseOrderId
        .get('po-1')
        ?.map((item) => item.id),
    ).toEqual(['inv-1', 'inv-2']);
    expect(result.current.renderProject('proj-1')).toBe('P001 / Project One');
    expect(result.current.renderProject('unknown-project')).toBe(
      'unknown-project',
    );
    expect(result.current.renderVendor('vendor-1')).toBe('V001 / Vendor One');
    expect(result.current.renderVendor('unknown-vendor')).toBe(
      'unknown-vendor',
    );
  });

  it('returns empty purchase-order link candidates when the dialog is closed', () => {
    const { result } = renderHook(() =>
      useVendorDocumentsLookups({
        projects,
        vendors,
        purchaseOrders,
        vendorInvoices,
        invoiceForm: { projectId: 'proj-2', vendorId: 'vendor-2' },
        invoicePoLinkDialog: null,
        purchaseOrderDetails: {},
      }),
    );

    expect(result.current.availablePurchaseOrders.map((po) => po.id)).toEqual([
      'po-2',
    ]);
    expect(result.current.availablePurchaseOrdersForInvoicePoLink).toEqual([]);
    expect(result.current.selectedPurchaseOrderId).toBeUndefined();
    expect(result.current.selectedPurchaseOrder).toBeNull();
  });
});

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  api: vi.fn(),
}));

import { api } from '../../api';
import { useVendorInvoiceDialogs } from './useVendorInvoiceDialogs';
import type {
  ProjectOption,
  PurchaseOrderDetail,
  VendorInvoice,
} from './vendorDocumentsShared';

const projects: ProjectOption[] = [
  { id: 'proj-1', code: 'P001', name: 'Project One' },
  { id: 'proj-2', code: 'P002', name: 'Project Two' },
];

const invoice: VendorInvoice = {
  id: 'inv-1',
  vendorInvoiceNo: 'INV-001',
  projectId: 'proj-1',
  vendorId: 'vendor-1',
  purchaseOrderId: 'po-1',
  purchaseOrder: { id: 'po-1', poNo: 'PO-001' },
  receivedDate: '2026-03-05',
  dueDate: '2026-03-31',
  currency: 'JPY',
  totalAmount: 160,
  status: 'approved',
  documentUrl: null,
};

const purchaseOrderDetail: PurchaseOrderDetail = {
  id: 'po-1',
  poNo: 'PO-001',
  projectId: 'proj-1',
  vendorId: 'vendor-1',
  issueDate: '2026-03-01',
  dueDate: '2026-03-15',
  currency: 'JPY',
  totalAmount: 160,
  status: 'approved',
  lines: [
    {
      id: 'po-line-1',
      purchaseOrderId: 'po-1',
      description: 'Line 1',
      quantity: 3,
      unitPrice: 50,
      taxRate: 10,
    },
  ],
};

function createParams() {
  return {
    projects,
    purchaseOrderDetails: { 'po-1': purchaseOrderDetail },
    loadPurchaseOrderDetail: vi.fn(),
    loadVendorInvoices: vi.fn(),
    isVendorInvoiceAllocationReasonRequiredStatus: vi.fn(
      (status: string) => status === 'approved',
    ),
    isVendorInvoiceLineReasonRequiredStatus: vi.fn(
      (status: string) => status === 'approved',
    ),
  };
}

describe('useVendorInvoiceDialogs', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset();
  });

  it('loads allocation dialog data, computes totals, and blocks save without a required reason', async () => {
    const params = createParams();
    vi.mocked(api).mockResolvedValueOnce({
      invoice,
      items: [
        {
          projectId: 'proj-1',
          amount: 100,
          taxRate: 10,
          taxAmount: 10,
          purchaseOrderLineId: 'po-line-1',
        },
        {
          projectId: 'proj-2',
          amount: 50,
          taxRate: null,
          taxAmount: null,
          purchaseOrderLineId: '',
        },
      ],
    });

    const { result } = renderHook(() => useVendorInvoiceDialogs(params));

    await act(async () => {
      await result.current.openVendorInvoiceAllocationDialog(invoice);
    });

    expect(params.loadPurchaseOrderDetail).toHaveBeenCalledWith('po-1');
    expect(result.current.invoiceAllocationDialog).toEqual({ invoice });
    expect(result.current.invoiceAllocationLoading).toBe(false);
    expect(result.current.invoiceAllocations).toEqual([
      expect.objectContaining({ projectId: 'proj-1', amount: 100 }),
      expect.objectContaining({ projectId: 'proj-2', amount: 50 }),
    ]);
    expect(result.current.allocationTotals).toEqual({
      amountTotal: 150,
      taxTotal: 10,
      grossTotal: 160,
      invoiceTotal: 160,
      diff: 0,
    });
    expect(result.current.allocationTaxRateSummary).toEqual([
      { key: '10%', amount: 100, tax: 10 },
      { key: '免税', amount: 50, tax: 0 },
    ]);

    act(() => {
      result.current.addVendorInvoiceAllocationRow();
    });

    expect(
      result.current.invoiceAllocations[
        result.current.invoiceAllocations.length - 1
      ],
    ).toEqual(
      expect.objectContaining({
        projectId: 'proj-1',
        amount: 0,
        taxRate: null,
        taxAmount: null,
        purchaseOrderLineId: '',
      }),
    );

    await act(async () => {
      await result.current.saveVendorInvoiceAllocations();
    });

    expect(result.current.invoiceAllocationMessage).toEqual({
      text: '変更理由を入力してください',
      type: 'error',
    });
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('loads line dialog data, computes derived state, and blocks save without a required reason', async () => {
    const params = createParams();
    vi.mocked(api).mockResolvedValueOnce({
      invoice: { ...invoice, totalAmount: 110 },
      items: [
        {
          lineNo: 1,
          description: '既存明細',
          quantity: 2,
          unitPrice: 50,
          amount: 100,
          taxRate: 10,
          taxAmount: 10,
          purchaseOrderLineId: 'po-line-1',
        },
      ],
      poLineUsage: [
        {
          purchaseOrderLineId: 'po-line-1',
          purchaseOrderQuantity: 3,
          existingQuantity: 0,
          requestedQuantity: 2,
          remainingQuantity: 1,
          exceeds: false,
        },
      ],
    });

    const { result } = renderHook(() => useVendorInvoiceDialogs(params));

    await act(async () => {
      await result.current.openVendorInvoiceLineDialog({
        ...invoice,
        totalAmount: 110,
      });
    });

    expect(params.loadPurchaseOrderDetail).toHaveBeenCalledWith('po-1');
    expect(result.current.invoiceLineDialog).toEqual({
      invoice: { ...invoice, totalAmount: 110 },
    });
    expect(result.current.invoiceLineLoading).toBe(false);
    expect(result.current.invoiceLinePurchaseOrderDetail).toBe(
      purchaseOrderDetail,
    );
    expect(result.current.invoiceLinePoUsageByPoLineId).toEqual({
      'po-line-1': expect.objectContaining({ remainingQuantity: 1 }),
    });
    expect(
      result.current.invoiceLineRequestedQuantityByPoLine.get('po-line-1'),
    ).toBe(2);
    expect(result.current.invoiceLineTotals).toEqual({
      amountTotal: 100,
      taxTotal: 10,
      grossTotal: 110,
      invoiceTotal: 110,
      diff: 0,
    });

    act(() => {
      result.current.addVendorInvoiceLineRow();
    });

    expect(
      result.current.invoiceLines[result.current.invoiceLines.length - 1],
    ).toEqual(
      expect.objectContaining({
        tempId: 'tmp-line-2',
        lineNo: 2,
        description: '',
        quantity: 1,
        unitPrice: 0,
      }),
    );

    await act(async () => {
      await result.current.saveVendorInvoiceLines();
    });

    expect(result.current.invoiceLineMessage).toEqual({
      text: '変更理由を入力してください',
      type: 'error',
    });
    expect(api).toHaveBeenCalledTimes(1);
  });
});

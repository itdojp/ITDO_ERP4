import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import {
  parseNumberValue,
  type MessageState,
  type ProjectOption,
  type PurchaseOrderDetail,
  type VendorInvoice,
  type VendorInvoiceAllocation,
  type VendorInvoiceLine,
  type VendorInvoicePoLineUsage,
} from './vendorDocumentsShared';
import { buildVendorInvoiceLinePayload } from './vendorInvoiceLinePayload';

type UseVendorInvoiceDialogsParams = {
  projects: ProjectOption[];
  purchaseOrderDetails: Record<string, PurchaseOrderDetail>;
  loadPurchaseOrderDetail: (purchaseOrderId: string) => void | Promise<void>;
  loadVendorInvoices: () => void | Promise<void>;
  isVendorInvoiceAllocationReasonRequiredStatus: (status: string) => boolean;
  isVendorInvoiceLineReasonRequiredStatus: (status: string) => boolean;
};

export function useVendorInvoiceDialogs(params: UseVendorInvoiceDialogsParams) {
  const {
    projects,
    purchaseOrderDetails,
    loadPurchaseOrderDetail,
    loadVendorInvoices,
    isVendorInvoiceAllocationReasonRequiredStatus,
    isVendorInvoiceLineReasonRequiredStatus,
  } = params;

  const [invoiceAllocationDialog, setInvoiceAllocationDialog] = useState<{
    invoice: VendorInvoice;
  } | null>(null);
  const [invoiceAllocations, setInvoiceAllocations] = useState<
    VendorInvoiceAllocation[]
  >([]);
  const [invoiceAllocationLoading, setInvoiceAllocationLoading] =
    useState(false);
  const [invoiceAllocationSaving, setInvoiceAllocationSaving] = useState(false);
  const [invoiceAllocationMessage, setInvoiceAllocationMessage] =
    useState<MessageState>(null);
  const [invoiceAllocationReason, setInvoiceAllocationReason] = useState('');
  const [invoiceAllocationExpanded, setInvoiceAllocationExpanded] =
    useState(false);

  const [invoiceLineDialog, setInvoiceLineDialog] = useState<{
    invoice: VendorInvoice;
  } | null>(null);
  const [invoiceLines, setInvoiceLines] = useState<VendorInvoiceLine[]>([]);
  const [invoiceLineLoading, setInvoiceLineLoading] = useState(false);
  const [invoiceLineSaving, setInvoiceLineSaving] = useState(false);
  const [invoiceLineMessage, setInvoiceLineMessage] =
    useState<MessageState>(null);
  const [invoiceLineReason, setInvoiceLineReason] = useState('');
  const [invoiceLineExpanded, setInvoiceLineExpanded] = useState(false);
  const [invoiceLinePoUsageByPoLineId, setInvoiceLinePoUsageByPoLineId] =
    useState<Record<string, VendorInvoicePoLineUsage>>({});

  const invoiceLineTempIdRef = useRef(0);
  const nextInvoiceLineTempId = useCallback(() => {
    invoiceLineTempIdRef.current += 1;
    return `tmp-line-${invoiceLineTempIdRef.current}`;
  }, []);

  const allocationTotals = useMemo(() => {
    if (!invoiceAllocationDialog || invoiceAllocations.length === 0)
      return null;
    let amountTotal = 0;
    let taxTotal = 0;
    invoiceAllocations.forEach((item) => {
      amountTotal += parseNumberValue(item.amount) ?? 0;
      taxTotal += parseNumberValue(item.taxAmount) ?? 0;
    });
    const grossTotal = amountTotal + taxTotal;
    const invoiceTotal = parseNumberValue(
      invoiceAllocationDialog.invoice.totalAmount,
    );
    const diff = invoiceTotal != null ? invoiceTotal - grossTotal : null;
    return { amountTotal, taxTotal, grossTotal, invoiceTotal, diff };
  }, [invoiceAllocationDialog, invoiceAllocations]);

  const allocationTaxRateSummary = useMemo(() => {
    const summary = new Map<string, { amount: number; tax: number }>();
    invoiceAllocations.forEach((item) => {
      const rateValue = parseNumberValue(item.taxRate);
      const key = rateValue == null ? '免税' : `${rateValue}%`;
      const entry = summary.get(key) || { amount: 0, tax: 0 };
      entry.amount += parseNumberValue(item.amount) ?? 0;
      entry.tax += parseNumberValue(item.taxAmount) ?? 0;
      summary.set(key, entry);
    });
    return Array.from(summary.entries()).map(([key, value]) => ({
      key,
      amount: value.amount,
      tax: value.tax,
    }));
  }, [invoiceAllocations]);

  const invoiceLineTotals = useMemo(() => {
    if (!invoiceLineDialog || invoiceLines.length === 0) return null;
    let amountTotal = 0;
    let taxTotal = 0;
    let grossTotal = 0;
    invoiceLines.forEach((line) => {
      const quantity = parseNumberValue(line.quantity) ?? 0;
      const unitPrice = parseNumberValue(line.unitPrice) ?? 0;
      const amount =
        parseNumberValue(line.amount) ?? Math.round(quantity * unitPrice);
      const taxRate = parseNumberValue(line.taxRate);
      const taxAmount =
        parseNumberValue(line.taxAmount) ??
        (taxRate == null ? 0 : Math.round((amount * taxRate) / 100));
      amountTotal += amount;
      taxTotal += taxAmount;
      grossTotal += amount + taxAmount;
    });
    const invoiceTotal = parseNumberValue(
      invoiceLineDialog.invoice.totalAmount,
    );
    const diff = invoiceTotal != null ? invoiceTotal - grossTotal : null;
    return {
      amountTotal,
      taxTotal,
      grossTotal,
      invoiceTotal,
      diff,
    };
  }, [invoiceLineDialog, invoiceLines]);

  const invoiceLineRequestedQuantityByPoLine = useMemo(() => {
    const map = new Map<string, number>();
    invoiceLines.forEach((line) => {
      const lineId = line.purchaseOrderLineId?.trim();
      if (!lineId) return;
      const quantity = parseNumberValue(line.quantity) ?? 0;
      map.set(lineId, (map.get(lineId) || 0) + quantity);
    });
    return map;
  }, [invoiceLines]);

  const invoiceLinePurchaseOrderDetail = invoiceLineDialog?.invoice
    .purchaseOrderId
    ? purchaseOrderDetails[invoiceLineDialog.invoice.purchaseOrderId] || null
    : null;

  const loadVendorInvoiceAllocations = useCallback(
    async (invoiceId: string) => {
      setInvoiceAllocationLoading(true);
      try {
        const res = await api<{
          invoice: VendorInvoice;
          items: VendorInvoiceAllocation[];
        }>(`/vendor-invoices/${invoiceId}/allocations`);
        setInvoiceAllocations(res.items || []);
        setInvoiceAllocationDialog((prev) =>
          prev ? { ...prev, invoice: res.invoice } : prev,
        );
      } catch (err) {
        console.error('Failed to load vendor invoice allocations.', err);
        setInvoiceAllocationMessage({
          text: '配賦明細の取得に失敗しました',
          type: 'error',
        });
        setInvoiceAllocations([]);
      } finally {
        setInvoiceAllocationLoading(false);
      }
    },
    [],
  );

  const loadVendorInvoiceLines = useCallback(
    async (invoiceId: string) => {
      setInvoiceLineLoading(true);
      try {
        const res = await api<{
          invoice: VendorInvoice;
          items: VendorInvoiceLine[];
          poLineUsage?: VendorInvoicePoLineUsage[];
        }>(`/vendor-invoices/${invoiceId}/lines`);
        setInvoiceLines(
          (res.items || []).map((item) =>
            item.id || item.tempId
              ? item
              : { ...item, tempId: nextInvoiceLineTempId() },
          ),
        );
        const usageByPoLineId: Record<string, VendorInvoicePoLineUsage> = {};
        (res.poLineUsage || []).forEach((entry) => {
          usageByPoLineId[entry.purchaseOrderLineId] = entry;
        });
        setInvoiceLinePoUsageByPoLineId(usageByPoLineId);
        setInvoiceLineDialog((prev) =>
          prev ? { ...prev, invoice: res.invoice } : prev,
        );
      } catch (err) {
        console.error('Failed to load vendor invoice lines.', err);
        setInvoiceLineMessage({
          text: '請求明細の取得に失敗しました',
          type: 'error',
        });
        setInvoiceLines([]);
        setInvoiceLinePoUsageByPoLineId({});
      } finally {
        setInvoiceLineLoading(false);
      }
    },
    [nextInvoiceLineTempId],
  );

  const openVendorInvoiceAllocationDialog = useCallback(
    async (invoice: VendorInvoice) => {
      setInvoiceAllocationDialog({ invoice });
      setInvoiceAllocationReason('');
      setInvoiceAllocationMessage(null);
      setInvoiceAllocationExpanded(false);
      setInvoiceAllocations([]);
      if (invoice.purchaseOrderId) {
        void loadPurchaseOrderDetail(invoice.purchaseOrderId);
      }
      await loadVendorInvoiceAllocations(invoice.id);
    },
    [loadPurchaseOrderDetail, loadVendorInvoiceAllocations],
  );

  const closeVendorInvoiceAllocationDialog = useCallback(() => {
    setInvoiceAllocationDialog(null);
  }, []);

  const openVendorInvoiceLineDialog = useCallback(
    async (invoice: VendorInvoice) => {
      setInvoiceLineDialog({ invoice });
      setInvoiceLineReason('');
      setInvoiceLineMessage(null);
      setInvoiceLineExpanded(false);
      setInvoiceLines([]);
      setInvoiceLinePoUsageByPoLineId({});
      if (invoice.purchaseOrderId) {
        void loadPurchaseOrderDetail(invoice.purchaseOrderId);
      }
      await loadVendorInvoiceLines(invoice.id);
    },
    [loadPurchaseOrderDetail, loadVendorInvoiceLines],
  );

  const closeVendorInvoiceLineDialog = useCallback(() => {
    setInvoiceLineDialog(null);
  }, []);

  const addVendorInvoiceAllocationRow = useCallback(() => {
    const defaultProjectId =
      invoiceAllocationDialog?.invoice.projectId || projects[0]?.id || '';
    setInvoiceAllocations((prev) => [
      ...prev,
      {
        projectId: defaultProjectId,
        amount: 0,
        taxRate: null,
        taxAmount: null,
        purchaseOrderLineId: '',
      },
    ]);
  }, [invoiceAllocationDialog, projects]);

  const updateVendorInvoiceAllocation = useCallback(
    (index: number, update: Partial<VendorInvoiceAllocation>) => {
      setInvoiceAllocations((prev) =>
        prev.map((item, idx) =>
          idx === index ? { ...item, ...update } : item,
        ),
      );
    },
    [],
  );

  const removeVendorInvoiceAllocation = useCallback((index: number) => {
    setInvoiceAllocations((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  const addVendorInvoiceLineRow = useCallback(() => {
    const maxLineNo = invoiceLines.reduce((maxValue, line) => {
      const value = parseNumberValue(line.lineNo);
      if (value == null || !Number.isInteger(value)) return maxValue;
      return Math.max(maxValue, value);
    }, 0);
    const nextLineNo = maxLineNo + 1;
    setInvoiceLines((prev) => [
      ...prev,
      {
        tempId: nextInvoiceLineTempId(),
        lineNo: nextLineNo,
        description: '',
        quantity: 1,
        unitPrice: 0,
        amount: null,
        taxRate: null,
        taxAmount: null,
        purchaseOrderLineId: '',
      },
    ]);
  }, [invoiceLines, nextInvoiceLineTempId]);

  const updateVendorInvoiceLine = useCallback(
    (index: number, update: Partial<VendorInvoiceLine>) => {
      setInvoiceLines((prev) =>
        prev.map((item, idx) =>
          idx === index ? { ...item, ...update } : item,
        ),
      );
    },
    [],
  );

  const removeVendorInvoiceLine = useCallback((index: number) => {
    setInvoiceLines((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  const saveVendorInvoiceLines = useCallback(async () => {
    if (!invoiceLineDialog) return;
    const invoice = invoiceLineDialog.invoice;
    const reasonText = invoiceLineReason.trim();
    if (
      isVendorInvoiceLineReasonRequiredStatus(invoice.status) &&
      !reasonText
    ) {
      setInvoiceLineMessage({
        text: '変更理由を入力してください',
        type: 'error',
      });
      return;
    }
    const payloadResult = buildVendorInvoiceLinePayload(
      invoiceLines,
      reasonText,
    );
    if (!payloadResult.ok) {
      setInvoiceLineMessage({ text: payloadResult.errorText, type: 'error' });
      return;
    }

    try {
      setInvoiceLineSaving(true);
      setInvoiceLineMessage(null);
      await api(`/vendor-invoices/${invoice.id}/lines`, {
        method: 'PUT',
        body: JSON.stringify(payloadResult.payload),
      });
      setInvoiceLineMessage({
        text: '請求明細を更新しました',
        type: 'success',
      });
      await loadVendorInvoices();
      await loadVendorInvoiceLines(invoice.id);
    } catch (err) {
      console.error('Failed to update vendor invoice lines.', err);
      const errorText = err instanceof Error ? err.message : String(err);
      if (errorText.includes('PO_LINE_QUANTITY_EXCEEDED')) {
        setInvoiceLineMessage({
          text: 'PO明細の数量上限を超えています（数量を見直してください）',
          type: 'error',
        });
      } else if (errorText.includes('LINE_TOTAL_MISMATCH')) {
        setInvoiceLineMessage({
          text: '請求合計との差分が解消されていません',
          type: 'error',
        });
      } else if (errorText.includes('INVALID_PURCHASE_ORDER_LINE')) {
        setInvoiceLineMessage({
          text: '選択したPO明細が関連POに属していません',
          type: 'error',
        });
      } else {
        setInvoiceLineMessage({
          text: '請求明細の更新に失敗しました',
          type: 'error',
        });
      }
    } finally {
      setInvoiceLineSaving(false);
    }
  }, [
    invoiceLineDialog,
    invoiceLines,
    invoiceLineReason,
    loadVendorInvoiceLines,
    isVendorInvoiceLineReasonRequiredStatus,
    loadVendorInvoices,
  ]);

  const saveVendorInvoiceAllocations = useCallback(async () => {
    if (!invoiceAllocationDialog) return;
    const invoice = invoiceAllocationDialog.invoice;
    const reasonText = invoiceAllocationReason.trim();
    if (
      isVendorInvoiceAllocationReasonRequiredStatus(invoice.status) &&
      !reasonText
    ) {
      setInvoiceAllocationMessage({
        text: '変更理由を入力してください',
        type: 'error',
      });
      return;
    }

    const payload: {
      allocations: Array<{
        projectId: string;
        amount: number;
        taxRate?: number;
        taxAmount?: number;
        purchaseOrderLineId?: string;
      }>;
      reasonText?: string;
    } = { allocations: [] };

    for (let i = 0; i < invoiceAllocations.length; i += 1) {
      const entry = invoiceAllocations[i];
      const projectId = entry.projectId.trim();
      if (!projectId) {
        setInvoiceAllocationMessage({
          text: `配賦明細 ${i + 1} の案件が未選択です`,
          type: 'error',
        });
        return;
      }
      const amount = parseNumberValue(entry.amount);
      if (amount == null || amount < 0) {
        setInvoiceAllocationMessage({
          text: `配賦明細 ${i + 1} の金額が不正です`,
          type: 'error',
        });
        return;
      }
      const taxRate =
        entry.taxRate === undefined ||
        entry.taxRate === null ||
        entry.taxRate === ''
          ? null
          : parseNumberValue(entry.taxRate);
      if (entry.taxRate != null && taxRate == null) {
        setInvoiceAllocationMessage({
          text: `配賦明細 ${i + 1} の税率が不正です`,
          type: 'error',
        });
        return;
      }
      const taxAmount =
        entry.taxAmount === undefined ||
        entry.taxAmount === null ||
        entry.taxAmount === ''
          ? null
          : parseNumberValue(entry.taxAmount);
      if (entry.taxAmount != null && taxAmount == null) {
        setInvoiceAllocationMessage({
          text: `配賦明細 ${i + 1} の税額が不正です`,
          type: 'error',
        });
        return;
      }
      const purchaseOrderLineId = entry.purchaseOrderLineId?.trim();
      payload.allocations.push({
        projectId,
        amount,
        ...(taxRate != null ? { taxRate } : {}),
        ...(taxAmount != null ? { taxAmount } : {}),
        ...(purchaseOrderLineId ? { purchaseOrderLineId } : {}),
      });
    }
    if (reasonText) {
      payload.reasonText = reasonText;
    }

    try {
      setInvoiceAllocationSaving(true);
      setInvoiceAllocationMessage(null);
      await api(`/vendor-invoices/${invoice.id}/allocations`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      setInvoiceAllocationMessage({
        text: '配賦明細を更新しました',
        type: 'success',
      });
      await loadVendorInvoices();
      await loadVendorInvoiceAllocations(invoice.id);
    } catch (err) {
      console.error('Failed to update vendor invoice allocations.', err);
      setInvoiceAllocationMessage({
        text: '配賦明細の更新に失敗しました',
        type: 'error',
      });
    } finally {
      setInvoiceAllocationSaving(false);
    }
  }, [
    invoiceAllocationDialog,
    invoiceAllocationReason,
    invoiceAllocations,
    loadVendorInvoiceAllocations,
    isVendorInvoiceAllocationReasonRequiredStatus,
    loadVendorInvoices,
  ]);

  const toggleInvoiceAllocationExpanded = useCallback(() => {
    setInvoiceAllocationExpanded((prev) => !prev);
  }, []);

  const toggleInvoiceLineExpanded = useCallback(() => {
    setInvoiceLineExpanded((prev) => !prev);
  }, []);

  return {
    invoiceAllocationDialog,
    invoiceAllocations,
    invoiceAllocationLoading,
    invoiceAllocationSaving,
    invoiceAllocationMessage,
    invoiceAllocationReason,
    invoiceAllocationExpanded,
    invoiceLineDialog,
    invoiceLines,
    invoiceLineLoading,
    invoiceLineSaving,
    invoiceLineMessage,
    invoiceLineReason,
    invoiceLineExpanded,
    invoiceLinePoUsageByPoLineId,
    invoiceLinePurchaseOrderDetail,
    allocationTotals,
    allocationTaxRateSummary,
    invoiceLineTotals,
    invoiceLineRequestedQuantityByPoLine,
    openVendorInvoiceAllocationDialog,
    closeVendorInvoiceAllocationDialog,
    openVendorInvoiceLineDialog,
    closeVendorInvoiceLineDialog,
    addVendorInvoiceAllocationRow,
    updateVendorInvoiceAllocation,
    removeVendorInvoiceAllocation,
    saveVendorInvoiceAllocations,
    setInvoiceAllocationReason,
    toggleInvoiceAllocationExpanded,
    addVendorInvoiceLineRow,
    updateVendorInvoiceLine,
    removeVendorInvoiceLine,
    saveVendorInvoiceLines,
    setInvoiceLineReason,
    toggleInvoiceLineExpanded,
  };
}

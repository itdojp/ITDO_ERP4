import { parseNumberValue } from './vendorDocumentsShared';
import type { VendorInvoiceLine } from './vendorDocumentsShared';

type VendorInvoiceLinePayload = {
  lines: Array<{
    lineNo: number;
    description: string;
    quantity: number;
    unitPrice: number;
    amount?: number | null;
    taxRate?: number | null;
    taxAmount?: number | null;
    purchaseOrderLineId?: string | null;
  }>;
  reasonText?: string;
};

type BuildVendorInvoiceLinePayloadResult =
  | { ok: true; payload: VendorInvoiceLinePayload }
  | { ok: false; errorText: string };

export function buildVendorInvoiceLinePayload(
  lines: VendorInvoiceLine[],
  reasonText: string,
): BuildVendorInvoiceLinePayloadResult {
  const payload: VendorInvoiceLinePayload = { lines: [] };
  const lineNos = new Set<number>();

  for (let i = 0; i < lines.length; i += 1) {
    const entry = lines[i];
    const lineNoRaw =
      entry.lineNo === undefined || entry.lineNo === null
        ? i + 1
        : parseNumberValue(entry.lineNo);
    if (
      lineNoRaw == null ||
      !Number.isInteger(lineNoRaw) ||
      Number(lineNoRaw) <= 0
    ) {
      return {
        ok: false,
        errorText: `請求明細 ${i + 1} の行番号が不正です`,
      };
    }
    const lineNo = Number(lineNoRaw);
    if (lineNos.has(lineNo)) {
      return {
        ok: false,
        errorText: `請求明細 ${i + 1} の行番号が重複しています`,
      };
    }
    lineNos.add(lineNo);

    const description = entry.description.trim();
    if (!description) {
      return {
        ok: false,
        errorText: `請求明細 ${i + 1} の内容を入力してください`,
      };
    }
    const quantity = parseNumberValue(entry.quantity);
    if (quantity == null || quantity <= 0) {
      return {
        ok: false,
        errorText: `請求明細 ${i + 1} の数量が不正です`,
      };
    }
    const unitPrice = parseNumberValue(entry.unitPrice);
    if (unitPrice == null || unitPrice < 0) {
      return {
        ok: false,
        errorText: `請求明細 ${i + 1} の単価が不正です`,
      };
    }
    const amount =
      entry.amount === undefined || entry.amount === null || entry.amount === ''
        ? null
        : parseNumberValue(entry.amount);
    if (
      entry.amount != null &&
      entry.amount !== '' &&
      (amount == null || amount < 0)
    ) {
      return {
        ok: false,
        errorText: `請求明細 ${i + 1} の金額が不正です`,
      };
    }
    const taxRate =
      entry.taxRate === undefined ||
      entry.taxRate === null ||
      entry.taxRate === ''
        ? null
        : parseNumberValue(entry.taxRate);
    if (
      entry.taxRate != null &&
      entry.taxRate !== '' &&
      (taxRate == null || taxRate < 0)
    ) {
      return {
        ok: false,
        errorText: `請求明細 ${i + 1} の税率が不正です`,
      };
    }
    const taxAmount =
      entry.taxAmount === undefined ||
      entry.taxAmount === null ||
      entry.taxAmount === ''
        ? null
        : parseNumberValue(entry.taxAmount);
    if (
      entry.taxAmount != null &&
      entry.taxAmount !== '' &&
      (taxAmount == null || taxAmount < 0)
    ) {
      return {
        ok: false,
        errorText: `請求明細 ${i + 1} の税額が不正です`,
      };
    }
    const purchaseOrderLineId = entry.purchaseOrderLineId?.trim();
    payload.lines.push({
      lineNo,
      description,
      quantity,
      unitPrice,
      amount,
      taxRate,
      taxAmount,
      purchaseOrderLineId: purchaseOrderLineId || null,
    });
  }

  if (reasonText) {
    payload.reasonText = reasonText;
  }
  return { ok: true, payload };
}

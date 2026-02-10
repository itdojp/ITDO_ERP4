export type VendorInvoiceLineDraft = {
  lineNo: number;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number | null;
  taxRate: number | null;
  taxAmount: number | null;
  purchaseOrderLineId?: string | null;
};

export type VendorInvoiceLineNormalized = {
  lineNo: number;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRate: number | null;
  taxAmount: number;
  grossAmount: number;
  purchaseOrderLineId: string | null;
};

export type VendorInvoiceLineTotals = {
  amountTotal: number;
  taxTotal: number;
  grossTotal: number;
  diff: number;
};

export function normalizeVendorInvoiceLines(
  items: VendorInvoiceLineDraft[],
  invoiceTotal: number,
  options: { autoAdjust?: boolean } = {},
): {
  items: VendorInvoiceLineNormalized[];
  totals: VendorInvoiceLineTotals;
} {
  const normalized: VendorInvoiceLineNormalized[] = items.map((entry) => {
    const amount =
      entry.amount != null ? entry.amount : entry.quantity * entry.unitPrice;
    const taxAmount =
      entry.taxAmount != null
        ? entry.taxAmount
        : entry.taxRate != null
          ? amount * entry.taxRate
          : 0;
    const grossAmount = amount + taxAmount;
    return {
      lineNo: entry.lineNo,
      description: entry.description,
      quantity: entry.quantity,
      unitPrice: entry.unitPrice,
      amount,
      taxRate: entry.taxRate,
      taxAmount,
      grossAmount,
      purchaseOrderLineId: entry.purchaseOrderLineId || null,
    };
  });

  let amountTotal = 0;
  let taxTotal = 0;
  let grossTotal = 0;
  for (const item of normalized) {
    amountTotal += item.amount;
    taxTotal += item.taxAmount;
    grossTotal += item.grossAmount;
  }

  let diff = invoiceTotal - grossTotal;
  const autoAdjust = options.autoAdjust !== false;
  if (autoAdjust && normalized.length > 0 && Math.abs(diff) > 0.00001) {
    const last = normalized[normalized.length - 1];
    const nextTax = last.taxAmount + diff;
    const nextGross = last.grossAmount + diff;
    if (nextTax >= -0.00001 && nextGross >= -0.00001) {
      last.taxAmount = nextTax;
      last.grossAmount = nextGross;
      taxTotal += diff;
      grossTotal += diff;
      diff = invoiceTotal - grossTotal;
    }
  }

  return {
    items: normalized,
    totals: {
      amountTotal,
      taxTotal,
      grossTotal,
      diff,
    },
  };
}

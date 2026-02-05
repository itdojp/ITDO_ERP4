export type VendorInvoiceAllocationDraft = {
  amount: number;
  taxRate?: number | null;
  taxAmount?: number | null;
};

export type VendorInvoiceAllocationTotals = {
  amountTotal: number;
  taxTotal: number;
  grossTotal: number;
  diff: number;
};

function computeTaxAmount(amount: number, taxRate: number) {
  return Math.round((amount * taxRate) / 100);
}

export function normalizeVendorInvoiceAllocations(
  items: VendorInvoiceAllocationDraft[],
  invoiceTotal: number,
  options?: { autoAdjust?: boolean },
) {
  const normalized = items.map((item) => {
    const taxRate = item.taxRate ?? null;
    let taxAmount = item.taxAmount ?? null;
    if (taxAmount == null && taxRate != null) {
      taxAmount = computeTaxAmount(item.amount, taxRate);
    }
    if (taxAmount == null) {
      taxAmount = 0;
    }
    return {
      ...item,
      taxRate,
      taxAmount,
    };
  });

  const totals = normalized.reduce(
    (acc, item) => {
      acc.amountTotal += item.amount;
      acc.taxTotal += item.taxAmount ?? 0;
      acc.grossTotal += item.amount + (item.taxAmount ?? 0);
      return acc;
    },
    { amountTotal: 0, taxTotal: 0, grossTotal: 0 },
  );

  let diff = invoiceTotal - totals.grossTotal;
  let adjusted = false;
  if (options?.autoAdjust !== false && normalized.length > 0) {
    if (Math.abs(diff) > 0.00001) {
      const lastIndex = normalized.length - 1;
      const last = normalized[lastIndex];
      normalized[lastIndex] = {
        ...last,
        taxAmount: (last.taxAmount ?? 0) + diff,
      };
      adjusted = true;
      const recalculated = normalized.reduce(
        (acc, item) => {
          acc.amountTotal += item.amount;
          acc.taxTotal += item.taxAmount ?? 0;
          acc.grossTotal += item.amount + (item.taxAmount ?? 0);
          return acc;
        },
        { amountTotal: 0, taxTotal: 0, grossTotal: 0 },
      );
      totals.amountTotal = recalculated.amountTotal;
      totals.taxTotal = recalculated.taxTotal;
      totals.grossTotal = recalculated.grossTotal;
      diff = invoiceTotal - totals.grossTotal;
    }
  }

  return {
    items: normalized,
    totals: {
      amountTotal: totals.amountTotal,
      taxTotal: totals.taxTotal,
      grossTotal: totals.grossTotal,
      diff,
    },
    adjusted,
  };
}

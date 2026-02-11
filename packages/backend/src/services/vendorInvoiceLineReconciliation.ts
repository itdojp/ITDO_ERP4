const EPSILON = 0.00001;

type PurchaseOrderLineQuantityInput = {
  id: string;
  quantity: unknown;
};

type ExistingVendorInvoiceLineQuantityInput = {
  purchaseOrderLineId: unknown;
  quantity: unknown;
};

type RequestedVendorInvoiceLineQuantityInput = {
  purchaseOrderLineId: string | null;
  quantity: number;
};

export type ExceededPurchaseOrderLineQuantity = {
  purchaseOrderLineId: string;
  purchaseOrderQuantity: number;
  existingQuantity: number;
  requestedQuantity: number;
};

export type PurchaseOrderLineQuantitySummary = {
  purchaseOrderLineId: string;
  purchaseOrderQuantity: number;
  existingQuantity: number;
  requestedQuantity: number;
  remainingQuantity: number;
  exceeds: boolean;
};

type FindExceededPurchaseOrderLineQuantitiesInput = {
  purchaseOrderLines: PurchaseOrderLineQuantityInput[];
  existingInvoiceLines: ExistingVendorInvoiceLineQuantityInput[];
  requestedInvoiceLines: RequestedVendorInvoiceLineQuantityInput[];
};

function normalizeId(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function toFiniteNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === 'object') {
    const candidate = value as { toNumber?: () => number };
    if (typeof candidate.toNumber === 'function') {
      const parsed = candidate.toNumber();
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

export function findExceededPurchaseOrderLineQuantities(
  input: FindExceededPurchaseOrderLineQuantitiesInput,
): ExceededPurchaseOrderLineQuantity[] {
  return summarizePurchaseOrderLineQuantities(input)
    .filter((entry) => entry.exceeds)
    .map((entry) => ({
      purchaseOrderLineId: entry.purchaseOrderLineId,
      purchaseOrderQuantity: entry.purchaseOrderQuantity,
      existingQuantity: entry.existingQuantity,
      requestedQuantity: entry.requestedQuantity,
    }));
}

export function summarizePurchaseOrderLineQuantities(
  input: FindExceededPurchaseOrderLineQuantitiesInput,
): PurchaseOrderLineQuantitySummary[] {
  const purchaseOrderQuantityByLine = new Map<string, number>();
  const orderedLineIds: string[] = [];
  for (const line of input.purchaseOrderLines) {
    const lineId = normalizeId(line.id);
    if (!lineId) continue;
    if (!purchaseOrderQuantityByLine.has(lineId)) {
      orderedLineIds.push(lineId);
    }
    purchaseOrderQuantityByLine.set(lineId, toFiniteNumber(line.quantity) ?? 0);
  }

  const existingQtyByLine = new Map<string, number>();
  for (const line of input.existingInvoiceLines) {
    const lineId = normalizeId(line.purchaseOrderLineId);
    if (!lineId) continue;
    const current = existingQtyByLine.get(lineId) || 0;
    existingQtyByLine.set(
      lineId,
      current + (toFiniteNumber(line.quantity) ?? 0),
    );
  }

  const requestedQtyByLine = new Map<string, number>();
  for (const line of input.requestedInvoiceLines) {
    const lineId = normalizeId(line.purchaseOrderLineId);
    if (!lineId) continue;
    const current = requestedQtyByLine.get(lineId) || 0;
    requestedQtyByLine.set(lineId, current + line.quantity);
  }

  return orderedLineIds.map((lineId) => {
    const purchaseOrderQuantity = purchaseOrderQuantityByLine.get(lineId) ?? 0;
    const existingQuantity = existingQtyByLine.get(lineId) || 0;
    const requestedQuantity = requestedQtyByLine.get(lineId) || 0;
    const remainingQuantity =
      purchaseOrderQuantity - existingQuantity - requestedQuantity;
    return {
      purchaseOrderLineId: lineId,
      purchaseOrderQuantity,
      existingQuantity,
      requestedQuantity,
      remainingQuantity,
      exceeds: remainingQuantity < -EPSILON,
    };
  });
}

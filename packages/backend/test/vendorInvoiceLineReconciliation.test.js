import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findExceededPurchaseOrderLineQuantities,
  summarizePurchaseOrderLineQuantities,
} from '../dist/services/vendorInvoiceLineReconciliation.js';

test('findExceededPurchaseOrderLineQuantities: allows partial invoice within PO quantity', () => {
  const exceeded = findExceededPurchaseOrderLineQuantities({
    purchaseOrderLines: [{ id: 'po-line-1', quantity: 10 }],
    existingInvoiceLines: [{ purchaseOrderLineId: 'po-line-1', quantity: 4 }],
    requestedInvoiceLines: [
      { purchaseOrderLineId: 'po-line-1', quantity: 2 },
      { purchaseOrderLineId: 'po-line-1', quantity: 4 },
    ],
  });
  assert.equal(exceeded.length, 0);
});

test('findExceededPurchaseOrderLineQuantities: detects exceeded quantity by line', () => {
  const exceeded = findExceededPurchaseOrderLineQuantities({
    purchaseOrderLines: [
      { id: 'po-line-1', quantity: 10 },
      { id: 'po-line-2', quantity: 5 },
    ],
    existingInvoiceLines: [
      { purchaseOrderLineId: 'po-line-1', quantity: 3 },
      { purchaseOrderLineId: 'po-line-2', quantity: 2 },
    ],
    requestedInvoiceLines: [
      { purchaseOrderLineId: 'po-line-1', quantity: 4 },
      { purchaseOrderLineId: 'po-line-1', quantity: 5 },
      { purchaseOrderLineId: 'po-line-2', quantity: 1 },
    ],
  });
  assert.deepEqual(exceeded, [
    {
      purchaseOrderLineId: 'po-line-1',
      purchaseOrderQuantity: 10,
      existingQuantity: 3,
      requestedQuantity: 9,
    },
  ]);
});

test('findExceededPurchaseOrderLineQuantities: tolerates floating point boundary', () => {
  const exceeded = findExceededPurchaseOrderLineQuantities({
    purchaseOrderLines: [{ id: 'po-line-1', quantity: 0.3 }],
    existingInvoiceLines: [{ purchaseOrderLineId: 'po-line-1', quantity: 0.1 }],
    requestedInvoiceLines: [{ purchaseOrderLineId: 'po-line-1', quantity: 0.2 }],
  });
  assert.equal(exceeded.length, 0);
});

test('findExceededPurchaseOrderLineQuantities: ignores malformed and unknown line ids', () => {
  const exceeded = findExceededPurchaseOrderLineQuantities({
    purchaseOrderLines: [{ id: 'po-line-1', quantity: 2 }],
    existingInvoiceLines: [
      { purchaseOrderLineId: 'po-line-1', quantity: 'not-a-number' },
      { purchaseOrderLineId: '  ', quantity: 100 },
    ],
    requestedInvoiceLines: [
      { purchaseOrderLineId: null, quantity: 1 },
      { purchaseOrderLineId: 'unknown', quantity: 100 },
      { purchaseOrderLineId: 'po-line-1', quantity: 2 },
    ],
  });
  assert.equal(exceeded.length, 0);
});

test('summarizePurchaseOrderLineQuantities: returns remaining quantity per PO line', () => {
  const summary = summarizePurchaseOrderLineQuantities({
    purchaseOrderLines: [
      { id: 'po-line-1', quantity: 10 },
      { id: 'po-line-2', quantity: 5 },
    ],
    existingInvoiceLines: [
      { purchaseOrderLineId: 'po-line-1', quantity: 3 },
      { purchaseOrderLineId: 'po-line-2', quantity: 1.5 },
    ],
    requestedInvoiceLines: [
      { purchaseOrderLineId: 'po-line-1', quantity: 4 },
      { purchaseOrderLineId: 'po-line-2', quantity: 2 },
    ],
  });
  assert.deepEqual(summary, [
    {
      purchaseOrderLineId: 'po-line-1',
      purchaseOrderQuantity: 10,
      existingQuantity: 3,
      requestedQuantity: 4,
      remainingQuantity: 3,
      exceeds: false,
    },
    {
      purchaseOrderLineId: 'po-line-2',
      purchaseOrderQuantity: 5,
      existingQuantity: 1.5,
      requestedQuantity: 2,
      remainingQuantity: 1.5,
      exceeds: false,
    },
  ]);
});

test('summarizePurchaseOrderLineQuantities: marks exceeded when quantity is over PO', () => {
  const summary = summarizePurchaseOrderLineQuantities({
    purchaseOrderLines: [{ id: 'po-line-1', quantity: 8 }],
    existingInvoiceLines: [{ purchaseOrderLineId: 'po-line-1', quantity: 6 }],
    requestedInvoiceLines: [{ purchaseOrderLineId: 'po-line-1', quantity: 3 }],
  });
  assert.deepEqual(summary, [
    {
      purchaseOrderLineId: 'po-line-1',
      purchaseOrderQuantity: 8,
      existingQuantity: 6,
      requestedQuantity: 3,
      remainingQuantity: -1,
      exceeds: true,
    },
  ]);
});

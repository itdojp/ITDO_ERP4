import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeVendorInvoiceAllocations } from '../dist/services/vendorInvoiceAllocations.js';

test('normalizeVendorInvoiceAllocations: computes taxAmount when missing', () => {
  const result = normalizeVendorInvoiceAllocations(
    [{ amount: 1000, taxRate: 10 }],
    1100,
  );
  assert.equal(result.items[0].taxAmount, 100);
  assert.equal(result.totals.grossTotal, 1100);
  assert.equal(result.totals.diff, 0);
});

test('normalizeVendorInvoiceAllocations: auto-adjusts diff on last item', () => {
  const result = normalizeVendorInvoiceAllocations(
    [
      { amount: 1000, taxRate: 10, taxAmount: 100 },
      { amount: 500, taxRate: 10, taxAmount: 50 },
    ],
    1601,
  );
  assert.equal(result.items[1].taxAmount, 1);
  assert.equal(result.totals.grossTotal, 1601);
  assert.equal(result.totals.diff, 0);
});

test('normalizeVendorInvoiceAllocations: keeps diff when autoAdjust disabled', () => {
  const result = normalizeVendorInvoiceAllocations(
    [
      { amount: 1000, taxRate: 10, taxAmount: 100 },
      { amount: 500, taxRate: 10, taxAmount: 50 },
    ],
    1601,
    { autoAdjust: false },
  );
  assert.equal(result.items[1].taxAmount, 50);
  assert.equal(result.totals.grossTotal, 1650);
  assert.equal(result.totals.diff, -49);
});

test('normalizeVendorInvoiceAllocations: keeps diff when autoAdjust would make tax negative', () => {
  const result = normalizeVendorInvoiceAllocations(
    [{ amount: 100, taxRate: null, taxAmount: 0 }],
    50,
    { autoAdjust: true },
  );
  assert.equal(result.items[0].taxAmount, 0);
  assert.equal(result.totals.grossTotal, 100);
  assert.equal(result.totals.diff, -50);
});

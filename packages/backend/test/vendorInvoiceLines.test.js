import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeVendorInvoiceLines } from '../dist/services/vendorInvoiceLines.js';

test('normalizeVendorInvoiceLines: computes amount/tax/gross when omitted', () => {
  const result = normalizeVendorInvoiceLines(
    [
      {
        lineNo: 1,
        description: 'line-1',
        quantity: 2,
        unitPrice: 100,
        amount: null,
        taxRate: 10,
        taxAmount: null,
      },
    ],
    220,
  );
  assert.equal(result.items[0].amount, 200);
  assert.equal(result.items[0].taxAmount, 20);
  assert.equal(result.items[0].grossAmount, 220);
  assert.equal(result.totals.diff, 0);
});

test('normalizeVendorInvoiceLines: auto-adjusts diff by last line taxAmount', () => {
  const result = normalizeVendorInvoiceLines(
    [
      {
        lineNo: 1,
        description: 'line-1',
        quantity: 1,
        unitPrice: 100,
        amount: 100,
        taxRate: null,
        taxAmount: 0,
      },
      {
        lineNo: 2,
        description: 'line-2',
        quantity: 1,
        unitPrice: 100,
        amount: 100,
        taxRate: null,
        taxAmount: 0,
      },
    ],
    205,
    { autoAdjust: true },
  );
  assert.equal(result.items[1].taxAmount, 5);
  assert.equal(result.items[1].grossAmount, 105);
  assert.equal(result.totals.grossTotal, 205);
  assert.equal(Math.abs(result.totals.diff) <= 0.00001, true);
});

test('normalizeVendorInvoiceLines: keeps diff when autoAdjust disabled', () => {
  const result = normalizeVendorInvoiceLines(
    [
      {
        lineNo: 1,
        description: 'line-1',
        quantity: 1,
        unitPrice: 100,
        amount: 100,
        taxRate: null,
        taxAmount: 0,
      },
    ],
    120,
    { autoAdjust: false },
  );
  assert.equal(result.totals.grossTotal, 100);
  assert.equal(result.totals.diff, 20);
});

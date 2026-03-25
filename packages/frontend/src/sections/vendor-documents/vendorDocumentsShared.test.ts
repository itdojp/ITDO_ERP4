import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatAmount,
  formatDate,
  isDocumentTabId,
  isPdfUrl,
  normalizeInvoiceStatusFilter,
  parseNumberValue,
} from './vendorDocumentsShared';

describe('vendorDocumentsShared', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it('validates document tab ids', () => {
    expect(isDocumentTabId('purchase-orders')).toBe(true);
    expect(isDocumentTabId('vendor-quotes')).toBe(true);
    expect(isDocumentTabId('unknown')).toBe(false);
  });

  it('normalizes invoice status filters', () => {
    const options = ['pending', 'approved'];
    expect(normalizeInvoiceStatusFilter('all', options)).toBe('all');
    expect(normalizeInvoiceStatusFilter('approved', options)).toBe('approved');
    expect(normalizeInvoiceStatusFilter('rejected', options)).toBe('all');
  });

  it('formats dates and numeric values', () => {
    expect(formatDate('2026-03-25T10:20:30.000Z')).toBe('2026-03-25');
    expect(formatDate(null)).toBe('-');
    expect(parseNumberValue(10)).toBe(10);
    expect(parseNumberValue('12.5')).toBe(12.5);
    expect(parseNumberValue('')).toBeNull();
    expect(parseNumberValue('abc')).toBeNull();
  });

  it('formats amounts and detects pdf urls', () => {
    expect(formatAmount('12345', 'JPY')).toBe(
      `${(12345).toLocaleString()} JPY`,
    );
    expect(formatAmount('abc', 'JPY')).toBe('- JPY');
    expect(isPdfUrl('https://example.com/file.pdf')).toBe(true);
    expect(isPdfUrl('https://example.com/file.PDF?download=1')).toBe(true);
    expect(isPdfUrl('https://example.com/file.txt')).toBe(false);
  });

  it('exposes default document forms', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T00:00:00.000Z'));
    const {
      defaultPurchaseOrderForm,
      defaultVendorInvoiceForm,
      defaultVendorQuoteForm,
    } = await import('./vendorDocumentsShared');
    const today = new Date().toISOString().slice(0, 10);

    expect(defaultPurchaseOrderForm.currency).toBe('JPY');
    expect(defaultPurchaseOrderForm.issueDate).toBe(today);
    expect(defaultVendorQuoteForm.issueDate).toBe(today);
    expect(defaultVendorInvoiceForm.receivedDate).toBe(today);
    expect(defaultVendorInvoiceForm.documentUrl).toBe('');
  });
});

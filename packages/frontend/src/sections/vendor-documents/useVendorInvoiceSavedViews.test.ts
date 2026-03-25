import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { createLocalStorageSavedViewsAdapter, useSavedViews } = vi.hoisted(
  () => ({
    createLocalStorageSavedViewsAdapter: vi.fn(),
    useSavedViews: vi.fn(),
  }),
);

vi.mock('../../ui', () => ({
  createLocalStorageSavedViewsAdapter,
  useSavedViews,
}));

import { useVendorInvoiceSavedViews } from './useVendorInvoiceSavedViews';

describe('useVendorInvoiceSavedViews', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T00:00:00.000Z'));
    createLocalStorageSavedViewsAdapter.mockReset();
    useSavedViews.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes the default saved view and storage adapter to useSavedViews', () => {
    const adapter = { kind: 'local-storage-adapter' };
    const savedViewsResult = {
      views: [{ id: 'default' }],
      activeViewId: 'default',
    };
    createLocalStorageSavedViewsAdapter.mockReturnValue(adapter);
    useSavedViews.mockReturnValue(savedViewsResult);

    const { result } = renderHook(() => useVendorInvoiceSavedViews());

    expect(createLocalStorageSavedViewsAdapter).toHaveBeenCalledWith(
      'erp4-vendor-invoice-filter-saved-views',
    );
    expect(useSavedViews).toHaveBeenCalledWith({
      initialViews: [
        {
          id: 'default',
          name: '既定',
          payload: { search: '', status: 'all' },
          createdAt: '2026-03-25T00:00:00.000Z',
          updatedAt: '2026-03-25T00:00:00.000Z',
        },
      ],
      initialActiveViewId: 'default',
      storageAdapter: adapter,
    });
    expect(result.current).toBe(savedViewsResult);
  });
});

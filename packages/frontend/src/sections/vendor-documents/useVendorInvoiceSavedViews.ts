import { useMemo } from 'react';
import { createLocalStorageSavedViewsAdapter, useSavedViews } from '../../ui';
import type { UseSavedViewsResult } from '../../ui';
import type { InvoiceSavedFilterPayload } from './vendorDocumentsShared';

export function useVendorInvoiceSavedViews(): UseSavedViewsResult<InvoiceSavedFilterPayload> {
  const initialViewTimestamp = useMemo(() => new Date().toISOString(), []);
  return useSavedViews<InvoiceSavedFilterPayload>({
    initialViews: [
      {
        id: 'default',
        name: '既定',
        payload: { search: '', status: 'all' },
        createdAt: initialViewTimestamp,
        updatedAt: initialViewTimestamp,
      },
    ],
    initialActiveViewId: 'default',
    storageAdapter:
      createLocalStorageSavedViewsAdapter<InvoiceSavedFilterPayload>(
        'erp4-vendor-invoice-filter-saved-views',
      ),
  });
}

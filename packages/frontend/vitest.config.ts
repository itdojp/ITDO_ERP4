import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const coreCoverageInclude = [
  'src/utils/attachments.ts',
  'src/utils/clipboard.ts',
  'src/utils/datetime.ts',
  'src/utils/deepLink.ts',
  'src/utils/download.ts',
  'src/utils/offlineQueue.ts',
  'src/ui/statusDictionary.ts',
  'src/ui/listStatePanel.tsx',
  'src/sections/vendor-documents/vendorInvoiceLinePayload.ts',
  'src/sections/vendor-documents/vendorDocumentsShared.ts',
  'src/sections/vendor-documents/useVendorDocumentsLookups.ts',
  'src/sections/vendor-documents/useVendorDocumentsTableData.tsx',
  'src/sections/vendor-documents/VendorInvoiceAllocationDialog.tsx',
  'src/sections/vendor-documents/VendorInvoiceLineDialog.tsx',
  'src/sections/vendor-documents/VendorInvoiceSavedViewBar.tsx',
  'src/sections/vendor-documents/VendorInvoicePoLinkDialog.tsx',
  'src/sections/vendor-documents/PurchaseOrderSendLogsDialog.tsx',
  'src/sections/vendor-documents/VendorDocumentsPurchaseOrdersSection.tsx',
  'src/sections/vendor-documents/VendorDocumentsVendorInvoicesSection.tsx',
  'src/sections/vendor-documents/VendorDocumentsVendorQuotesSection.tsx',
  'src/sections/vendor-documents/useVendorInvoiceDialogs.ts',
  'src/sections/vendor-documents/useVendorInvoiceSavedViews.ts',
  'src/sections/PeriodLocks.tsx',
  'src/sections/HelpModal.tsx',
  'src/sections/ChatSettingsCard.tsx',
  'src/sections/ScimSettingsCard.tsx',
  'src/sections/WorklogSettingsCard.tsx',
  'src/sections/ChatRoomSettingsCard.tsx',
];

const coverageInclude =
  process.env.FRONTEND_COVERAGE_SCOPE === 'ui-core'
    ? coreCoverageInclude
    : ['src/**/*.{ts,tsx}'];
const coverageReportsDirectory =
  process.env.FRONTEND_COVERAGE_SCOPE === 'ui-core'
    ? './coverage/ui-core'
    : './coverage/full';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reportsDirectory: coverageReportsDirectory,
      reporter: ['text-summary', 'json-summary', 'lcov'],
      include: coverageInclude,
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/test/**',
      ],
    },
  },
});

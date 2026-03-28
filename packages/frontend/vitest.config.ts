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
  // SCIM settings card coverage for the new unit test.
  'src/sections/ScimSettingsCard.tsx',
  'src/sections/ChatRoomSettingsCard.tsx',
  'src/sections/RateCardSettingsCard.tsx',
  'src/sections/DocumentSendLogs.tsx',
  'src/sections/ProjectMilestones.tsx',
  'src/sections/AdminJobs.tsx',
  'src/sections/admin-settings/AccountingMappingRulesCard.tsx',
  'src/sections/admin-settings/AuditHistoryPanel.tsx',
  'src/sections/admin-settings/IntegrationExportJobsCard.tsx',
  'src/sections/admin-settings/IntegrationReconciliationCard.tsx',
  'src/sections/admin-settings/IntegrationSettingsCard.tsx',
  'src/sections/admin-settings/AlertSettingsCard.tsx',
  'src/sections/admin-settings/ReportSubscriptionsCard.tsx',
  'src/sections/admin-settings/TemplateSettingsCard.tsx',
  'src/sections/admin-settings/AuthIdentityMigrationCard.tsx',
  'src/sections/PdfFiles.tsx',
  'src/sections/AccessReviews.tsx',
  'src/sections/InvoiceDetail.tsx',
  'src/sections/AuditLogs.tsx',
  'src/sections/Reports.tsx',
  'src/sections/DailyReport.tsx',
  'src/sections/EstimateDetail.tsx',
  'src/sections/Estimates.tsx',
  'src/sections/ChatBreakGlass.tsx',
  'src/sections/Dashboard.tsx',
  'src/sections/Invoices.tsx',
  'src/sections/GlobalSearch.tsx',
  'src/sections/LeaveRequests.tsx',
  'src/sections/HRAnalytics.tsx',
  'src/sections/Expenses.tsx',
  'src/sections/MasterData.tsx',
  'src/sections/ProjectTasks.tsx',
  'src/sections/Projects.tsx',
  'src/sections/Approvals.tsx',
  'src/sections/TimeEntries.tsx',
  'src/sections/GroupManagementCard.tsx',
  'src/sections/AdminSettings.tsx',
  'src/sections/VendorDocuments.tsx',
  'src/sections/CurrentUser.tsx',
  'src/sections/RoomChat.tsx',
  'src/hooks/useProjects.ts',
  'src/hooks/useProjectTasks.ts',
  'src/hooks/useChatRooms.ts',
  'src/components/ChatEvidencePicker.tsx',
];

const uiCoreCoverageInclude = [
  ...coreCoverageInclude,
  'src/sections/WorklogSettingsCard.tsx',
];

const coverageInclude =
  process.env.FRONTEND_COVERAGE_SCOPE === 'ui-core'
    ? uiCoreCoverageInclude
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

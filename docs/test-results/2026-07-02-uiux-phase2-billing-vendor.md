# 2026-07-02 UI/UX Phase 2 Billing and Vendor Evidence

## Scope

- Umbrella issue: #1821
- Phase issue: #1824
- Screens:
  - 見積 (`Estimates`, `EstimateDetail`)
  - 請求 (`Invoices`, `InvoiceDetail`)
  - 仕入/発注 (`VendorDocuments` and vendor-document subcomponents)

## Implementation summary

- Added Phase 1 workflow UX primitives to billing and vendor document screens.
- Added decision summaries for estimate, invoice, and vendor document workflows.
- Clarified form/list hierarchy for creating, filtering, sending, paying, approving, and linking documents.
- Preserved existing E2E navigation and business-action selectors where possible.

## Local verification

```bash
npm run test --prefix packages/frontend -- Estimates.test.tsx Invoices.test.tsx VendorDocuments.test.tsx VendorDocumentsPurchaseOrdersSection.test.tsx VendorDocumentsVendorQuotesSection.test.tsx VendorDocumentsVendorInvoicesSection.test.tsx
npm run format:check --prefix packages/frontend
npm run typecheck --prefix packages/frontend
npm run lint --prefix packages/frontend
npm run build --prefix packages/frontend
```

Result: PASS.

Notes:

- Frontend build completed with the existing Vite chunk-size warning only.

## E2E screenshot evidence

Command:

```bash
TMPDIR="$PWD/.codex-local/tmp/e2e-uiux-phase2" \
XDG_RUNTIME_DIR="$PWD/.codex-local/tmp/xdg-runtime-uiux-phase2" \
BACKEND_PORT=3105 \
FRONTEND_PORT=5180 \
E2E_PODMAN_CONTAINER_NAME=erp4-pg-e2e-uiux-phase2 \
E2E_CAPTURE=1 \
E2E_GREP='phase 2 billing and vendor document UX/UI summaries render' \
E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-07-02-uiux-phase2-billing-vendor" \
./scripts/e2e-frontend.sh
```

Result: PASS, 1 test.

Screenshots:

- `docs/test-results/2026-07-02-uiux-phase2-billing-vendor/01-uiux-estimates.png`
- `docs/test-results/2026-07-02-uiux-phase2-billing-vendor/02-uiux-invoices.png`
- `docs/test-results/2026-07-02-uiux-phase2-billing-vendor/03-uiux-vendor-documents-po.png`
- `docs/test-results/2026-07-02-uiux-phase2-billing-vendor/04-uiux-vendor-documents-invoices.png`

## Operational note

The E2E run passed and evidence was saved. During cleanup, the Podman test container `erp4-pg-e2e-uiux-phase2` entered a `Stopping` state and did not respond to normal `stop`, `rm -f`, or `kill` cleanup attempts. This appears to be a local rootless Podman runtime cleanup issue, not an application test failure.

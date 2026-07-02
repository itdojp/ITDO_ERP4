# UI/UX Phase 12 Dashboard Evidence

- Date: 2026-07-02 JST
- Scope: Home dashboard (`Dashboard.tsx`)
- Issue: #1844
- Umbrella: #1821

## What changed

- Added a workflow-oriented page header explaining the home dashboard decision context.
- Added `ホームサマリー` metrics for approvals, notifications, alerts, and management insights.
- Added a `主要業務へのショートカット` panel for daily reporting, approvals, projects, billing, and vendor workflows.
- Grouped the existing approval/notification, alert, and insight content into clearly named workflow panels.
- Preserved existing notification actions, alert list behavior, insight display, API calls, deep-link behavior, and labels used by existing tests.

## Local verification

```bash
npm run test --prefix packages/frontend -- Dashboard.test.tsx
npm run format:check --prefix packages/frontend
npm run typecheck --prefix packages/frontend
npm run lint --prefix packages/frontend
npm run build --prefix packages/frontend
npm audit --prefix packages/frontend --audit-level=high
npm audit --prefix packages/backend --audit-level=high
git diff --check
```

Targeted E2E command:

```bash
TMPDIR="$PWD/tmp" BACKEND_PORT=3014 FRONTEND_PORT=5184 \
E2E_PODMAN_CONTAINER_NAME=erp4-pg-e2e-uiux-phase12-dashboard \
E2E_PODMAN_HOST_PORT=55454 E2E_DATE=2026-07-02 \
E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-07-02-uiux-phase12-dashboard" \
E2E_GREP='phase 12 dashboard UX/UI summary renders' \
E2E_CAPTURE=1 E2E_SKIP_PLAYWRIGHT_INSTALL=1 ./scripts/e2e-frontend.sh
```

## Screenshot evidence

- `docs/test-results/2026-07-02-uiux-phase12-dashboard/01-uiux-dashboard.png`

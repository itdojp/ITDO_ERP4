# UX/UI follow-up #1848: workflowUx primitive and token hardening

Date: 2026-07-02 JST  
Issue: #1848  
Branch: `codex/workflow-ux-tokens-1848-20260702`

## Scope

This change hardens the shared `workflowUx` primitives used across the all-screen UX/UI baseline.

Included:

- Centralized `workflowUxTokens` bridge for design-system CSS custom properties and PoC-safe fallbacks.
- Replaced repeated inline fallback values in `workflowUx` styles with token references and a shared border helper.
- Kept the existing DOM sibling contract for page headings and summaries so phase E2E specs remain stable.
- Strengthened `WorkflowPageHeader` by linking the level-2 heading to its guidance text via `aria-describedby`.
- Preserved #1847 metric semantics (`dl` / `dt` / `dd`) and panel `aria-labelledby` / `aria-describedby` contracts.
- Added workflowUx token/contract unit coverage.
- Added `docs/ui/workflow-ux-primitives.md` and linked it from `docs/ui/ux-quality.md`.

## Known non-targets

- No new dependency was added.
- No external `@itdo/design-system` package API was changed.
- Vite chunk-size reduction remains #1849.
- Visual regression automation remains #1850.

## Local verification

```bash
npm ci --prefix packages/frontend
npm run test --prefix packages/frontend -- workflowUx.test.tsx
npm run test --prefix packages/frontend -- workflowUx.test.tsx DailyReport.test.tsx Projects.test.tsx Invoices.test.tsx
npm run lint --prefix packages/frontend
npm run typecheck --prefix packages/frontend
TMPDIR="$PWD/tmp" BACKEND_PORT=3019 FRONTEND_PORT=5189 E2E_CAPTURE=0 \
  E2E_SCOPE=full E2E_GREP='UX/UI summar' \
  E2E_PODMAN_CONTAINER_NAME=erp4-pg-e2e-workflow-1848 E2E_PODMAN_HOST_PORT=55459 \
  ./scripts/e2e-frontend.sh
npm run format:check --prefix packages/frontend
npm run test --prefix packages/frontend
npm run build --prefix packages/frontend
npm audit --prefix packages/frontend --audit-level=high
npm audit --prefix packages/backend --audit-level=high
git diff --check
```

Results:

- `npm ci --prefix packages/frontend`: PASS, 0 vulnerabilities.
- `npm run test --prefix packages/frontend -- workflowUx.test.tsx`: PASS, 1 file / 3 tests.
- Representative component tests (`workflowUx`, `DailyReport`, `Projects`, `Invoices`): PASS, 4 files / 21 tests.
- `npm run lint --prefix packages/frontend`: PASS.
- `npm run typecheck --prefix packages/frontend`: PASS.
- UIUX phase E2E summaries (`E2E_GREP='UX/UI summar'`): PASS, 12 tests covering the phase1〜phase12 evidence screens. One existing console 500 message appeared during phase3 setup, but the user-visible assertions passed.
- `npm run format:check --prefix packages/frontend`: PASS.
- `npm run test --prefix packages/frontend`: PASS, 76 files / 441 tests.
- `npm run build --prefix packages/frontend`: PASS with the existing non-fatal Vite chunk-size warning tracked by #1849.
- `npm audit --prefix packages/frontend --audit-level=high`: PASS, 0 vulnerabilities.
- `npm audit --prefix packages/backend --audit-level=high`: PASS, 0 vulnerabilities.
- `git diff --check`: PASS.

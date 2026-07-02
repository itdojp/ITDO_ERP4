# UX/UI follow-up #1847: accessibility, keyboard, and screen-reader audit

Date: 2026-07-02 JST  
Issue: #1847  
Branch: `codex/ux-a11y-1847-20260702`

## Scope

This PR covers a representative accessibility pass for the ERP4 frontend after the all-screen UX/UI baseline.

Included checks and fixes:

- App-level landmarks and keyboard routing:
  - skip link to the main content
  - explicit `nav` landmark for the primary menu
  - single `main` landmark with an accessible workflow name
  - `aria-current="page"` for the active menu item
  - keyboard focus handoff to `main` after menu navigation
- Command palette:
  - keyboard shortcut metadata on the launcher button
  - Japanese listbox label for command results
  - app-level bridge that gives the design-system command search input an accessible name until the upstream component exposes an input-label prop
  - Escape dismissal check
- `workflowUx` primitives:
  - metric summaries use semantic definition-list markup instead of color-only card differences
  - panels expose `aria-labelledby` and `aria-describedby` relationships for heading and guidance text
- Representative screen assertions:
  - 日報 + ウェルビーイング
  - 案件
  - 請求
  - コマンドパレット

## Known non-targets

- This is not a full WCAG 2.2 AA certification or assistive-technology lab run.
- This PR does not add `@axe-core/playwright`; the gate is implemented with Playwright role/label/landmark/focus assertions to avoid adding a new dependency before #1848 design-system hardening.
- Full-screen visual regression automation remains scoped to #1850.
- Broader design-token and primitive API hardening remains scoped to #1848, including replacing the app-level command-palette input-label bridge with an upstream design-system prop when available.

## Screenshots

- `docs/test-results/2026-07-02-uiux-followup-a11y-audit/01-a11y-invoice-workflow.png`
- `docs/test-results/2026-07-02-uiux-followup-a11y-audit/02-a11y-command-palette.png`

## Local verification

Executed in clean worktree:

```bash
npm ci --prefix packages/frontend
npm run test --prefix packages/frontend -- App.test.tsx workflowUx.test.tsx
npm run lint --prefix packages/frontend
npm run typecheck --prefix packages/frontend
npm run format:check --prefix packages/frontend
npm run test --prefix packages/frontend
npm run build --prefix packages/frontend
npm audit --prefix packages/frontend --audit-level=high
npm audit --prefix packages/backend --audit-level=high
git diff --check
TMPDIR="$PWD/tmp" BACKEND_PORT=3017 FRONTEND_PORT=5187 E2E_CAPTURE=1 \
  E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-07-02-uiux-followup-a11y-audit" \
  E2E_SCOPE=full E2E_GREP='a11y workflow|command palette' \
  E2E_PODMAN_CONTAINER_NAME=erp4-pg-e2e-a11y-1847 E2E_PODMAN_HOST_PORT=55457 \
  ./scripts/e2e-frontend.sh
TMPDIR="$PWD/tmp" BACKEND_PORT=3018 FRONTEND_PORT=5188 E2E_CAPTURE=0 \
  E2E_SCOPE=full E2E_GREP='ux-quality baseline' \
  E2E_PODMAN_CONTAINER_NAME=erp4-pg-e2e-a11y-1847-uxq E2E_PODMAN_HOST_PORT=55458 \
  ./scripts/e2e-frontend.sh
```

Results:

- `npm ci --prefix packages/frontend`: PASS, 0 vulnerabilities.
- `npm run test --prefix packages/frontend -- App.test.tsx workflowUx.test.tsx`: PASS, 2 files / 27 tests.
- `npm run lint --prefix packages/frontend`: PASS.
- `npm run typecheck --prefix packages/frontend`: PASS.
- `npm run format:check --prefix packages/frontend`: PASS.
- `npm run test --prefix packages/frontend`: PASS, 76 files / 440 tests.
- `npm run build --prefix packages/frontend`: PASS with the existing non-fatal Vite chunk-size warning tracked by #1849.
- `npm audit --prefix packages/frontend --audit-level=high`: PASS, 0 vulnerabilities.
- `npm audit --prefix packages/backend --audit-level=high`: PASS, 0 vulnerabilities.
- `git diff --check`: PASS.
- `frontend-a11y-workflow.spec.ts`: PASS, 2 tests, screenshot evidence captured.
- `frontend-ux-quality.spec.ts`: PASS, 1 test, confirms existing label/error/keyboard baseline remains compatible with the metric semantic-markup change.

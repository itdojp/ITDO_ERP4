# UX/UI follow-up visual regression evidence

Date: 2026-07-02

Issue: #1850

## Scope

Phase 1〜12 の screenshot evidence から、各 phase 1 画面を代表 baseline として Playwright screenshot snapshot に固定した。

Baseline path:

```text
packages/frontend/e2e/frontend-uiux-visual-regression.spec.ts-snapshots/
```

## Local verification

### Baseline generation

```bash
TMPDIR="$PWD/tmp" \
BACKEND_PORT=3031 \
FRONTEND_PORT=5191 \
E2E_PODMAN_CONTAINER_NAME=erp4-pg-e2e-visual-1850 \
E2E_PODMAN_HOST_PORT=55471 \
E2E_SKIP_PLAYWRIGHT_INSTALL=1 \
./scripts/e2e-uiux-visual-regression.sh --update-snapshots
```

Result: PASS, 12 tests.

### Visual comparison

```bash
TMPDIR="$PWD/tmp" \
BACKEND_PORT=3032 \
FRONTEND_PORT=5192 \
E2E_PODMAN_CONTAINER_NAME=erp4-pg-e2e-visual-1850-compare \
E2E_PODMAN_HOST_PORT=55472 \
E2E_SKIP_PLAYWRIGHT_INSTALL=1 \
./scripts/e2e-uiux-visual-regression.sh
```

Result: PASS, 12 tests.

## Committed baseline screenshots

- [phase-01-daily-report-linux.png](../../packages/frontend/e2e/frontend-uiux-visual-regression.spec.ts-snapshots/phase-01-daily-report-linux.png)
- [phase-02-invoices-linux.png](../../packages/frontend/e2e/frontend-uiux-visual-regression.spec.ts-snapshots/phase-02-invoices-linux.png)
- [phase-03-approvals-linux.png](../../packages/frontend/e2e/frontend-uiux-visual-regression.spec.ts-snapshots/phase-03-approvals-linux.png)
- [phase-04-reports-linux.png](../../packages/frontend/e2e/frontend-uiux-visual-regression.spec.ts-snapshots/phase-04-reports-linux.png)
- [phase-05-room-chat-linux.png](../../packages/frontend/e2e/frontend-uiux-visual-regression.spec.ts-snapshots/phase-05-room-chat-linux.png)
- [phase-06-master-data-linux.png](../../packages/frontend/e2e/frontend-uiux-visual-regression.spec.ts-snapshots/phase-06-master-data-linux.png)
- [phase-07-admin-settings-linux.png](../../packages/frontend/e2e/frontend-uiux-visual-regression.spec.ts-snapshots/phase-07-admin-settings-linux.png)
- [phase-08-pdf-files-linux.png](../../packages/frontend/e2e/frontend-uiux-visual-regression.spec.ts-snapshots/phase-08-pdf-files-linux.png)
- [phase-09-access-reviews-linux.png](../../packages/frontend/e2e/frontend-uiux-visual-regression.spec.ts-snapshots/phase-09-access-reviews-linux.png)
- [phase-10-document-send-logs-linux.png](../../packages/frontend/e2e/frontend-uiux-visual-regression.spec.ts-snapshots/phase-10-document-send-logs-linux.png)
- [phase-11-period-locks-linux.png](../../packages/frontend/e2e/frontend-uiux-visual-regression.spec.ts-snapshots/phase-11-period-locks-linux.png)
- [phase-12-dashboard-linux.png](../../packages/frontend/e2e/frontend-uiux-visual-regression.spec.ts-snapshots/phase-12-dashboard-linux.png)

## Notes

- Visual regression is opt-in with `UIUX_VISUAL_REGRESSION=1`; default `E2E_SCOPE=core/full` does not make this a required PR gate.
- Browser clock, locale, timezone, viewport, color scheme, animation, transition, and caret behavior are fixed to reduce false positives.
- Manual GitHub Actions workflow: `.github/workflows/uiux-visual-regression.yml`.

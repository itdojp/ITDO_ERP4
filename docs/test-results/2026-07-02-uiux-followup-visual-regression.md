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
- Phase 8 / PDF管理はファイルID・更新時刻を含む一覧行を `tbody` mask 対象とする。post-merge regression で当該行の実行時差分が確認されたため、サマリー・検索条件・一覧レイアウト枠を比較対象として維持する。
- Manual GitHub Actions workflow: `.github/workflows/uiux-visual-regression.yml`.

## Post-merge stabilization

After PR #1854 was merged, #1846 post-merge regression detected Phase 8 / PDF管理 instability:

- `phase-08-pdf-files.png`: 26,285 pixels differed, ratio 0.03.
- Difference source: dynamic PDF file list rows containing seed/API-derived file identifiers and update timestamps.
- Stabilization: mask the Phase 8 `tbody` while keeping the summary, search controls, table header, and layout frame under screenshot comparison.

Verification after stabilization:

- `./scripts/e2e-uiux-visual-regression.sh --update-snapshots` — PASS, 12 tests.
- `./scripts/e2e-uiux-visual-regression.sh` — PASS, 12 tests.
- `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh` — PASS, 105 tests.

# UX/UI follow-up #1849: frontend bundle and chunk warning

Date: 2026-07-02 JST

Scope: Issue #1849

## Objective

Reduce the frontend bundle/chunk risk identified after the all-screen UX/UI baseline without changing screen behavior. The implementation must not hide the Vite large chunk warning by only raising `chunkSizeWarningLimit`; it must split code and add an explicit size budget.

## Before

Command:

```bash
npm run build --prefix packages/frontend
```

Observed before changing `App.tsx` / Vite config:

| Asset                      |     Bytes | gzip bytes |
| -------------------------- | --------: | ---------: |
| `assets/index-9Z3gAjh2.js` | 1,300,008 |    346,942 |

Vite emitted `Some chunks are larger than 500 kB after minification`.

## Change summary

- Converted non-global screen sections in `packages/frontend/src/pages/App.tsx` from eager imports to `React.lazy` dynamic imports.
- Added section loading fallback with `role="status"` and `aria-live="polite"`.
- Added section-level error boundary so a failed dynamic import is visible to users and resets when navigating to another section.
- Added Vite 8 / Rolldown manual chunk grouping for React, design-system, TanStack, Markdown, and fallback vendor chunks.
- Added `npm run build:budget --prefix packages/frontend` to guard entry JS, initial JS, gzip initial JS, and individual JS chunk size.

## After

Commands:

```bash
npm run build --prefix packages/frontend
npm run build:budget --prefix packages/frontend
```

Observed after final split:

| Metric                                                |                              Value |
| ----------------------------------------------------- | ---------------------------------: |
| Entry JS (`assets/index-C6VSNjza.js`)                 |   53,150 bytes / gzip 15,966 bytes |
| Initial JS total                                      | 528,750 bytes / gzip 160,520 bytes |
| Largest JS chunk (`assets/design-system-CFnPNwub.js`) |  296,583 bytes / gzip 88,575 bytes |
| Vite large chunk warning                              |                        Not present |
| `build:budget`                                        |                               PASS |

Detailed assets:

- Before asset list: `docs/test-results/2026-07-02-uiux-followup-bundle-chunk/before-assets.json`
- After asset list: `docs/test-results/2026-07-02-uiux-followup-bundle-chunk/after-assets.json`
- Summary: `docs/test-results/2026-07-02-uiux-followup-bundle-chunk/summary.json`

## Local verification

- `npm ci --prefix packages/frontend`: PASS, 0 vulnerabilities.
- `npm run test --prefix packages/frontend -- App.test.tsx`: PASS, 26 tests.
- `npm run typecheck --prefix packages/frontend`: PASS.
- `npm run lint --prefix packages/frontend`: PASS.
- `npm run format:check --prefix packages/frontend`: PASS.
- `npx --prefix packages/frontend prettier --check docs/ui/frontend-bundle-budget.md docs/ui/ux-quality.md docs/test-results/2026-07-02-uiux-followup-bundle-chunk.md docs/test-results/2026-07-02-uiux-followup-bundle-chunk/*.json`: PASS.
- `npm run test --prefix packages/frontend`: PASS, 76 files / 442 tests.
- `npm run build --prefix packages/frontend`: PASS, no Vite large chunk warning.
- `npm run build:budget --prefix packages/frontend`: PASS.
- `npm audit --prefix packages/frontend --audit-level=high`: PASS, 0 vulnerabilities.
- `git diff --check`: PASS.
- `TMPDIR="$PWD/tmp" BACKEND_PORT=3023 FRONTEND_PORT=5193 E2E_CAPTURE=0 E2E_SCOPE=core E2E_PODMAN_CONTAINER_NAME=erp4-pg-e2e-bundle-1849-review E2E_PODMAN_HOST_PORT=55463 ./scripts/e2e-frontend.sh`: PASS, 105 tests.

## Notes

- Dynamic import changed deep-link timing: section-level open events now wait until the lazy-loaded section is committed, preventing event loss before child listeners mount.
- The final core E2E pass includes dashboard notification routing and phase 10 document/audit-log deep links.

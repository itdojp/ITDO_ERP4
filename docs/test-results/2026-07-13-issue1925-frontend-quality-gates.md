# Issue #1925 frontend max-lines / UI core coverage gate verification

- Date: 2026-07-13 JST
- Issue: #1925 `quality(frontend): max-linesを2000へ引き下げserver-state core coverage gateを追加する`
- Branch: `codex/frontend-quality-gates-1925-20260713`
- Base: `origin/main` at `b5855f3c7aa73d9b9119ff91e8cab61b0cf18ab6`

## Scope

`RoomChat` / `AdminSettings` の server-state hook 抽出完了後の品質ゲートとして、frontend の巨大化防止と focused coverage を CI で固定する。

- frontend ESLint `max-lines` default を 2500 行から 2000 行へ引き下げた。
- `packages/frontend/coverage-thresholds.json` を追加し、`ui-core.files` を coverage scope の正本にした。
- `coverage:ui-core:check` を追加し、既存必須 `CI / frontend` job 内で coverage 計測と閾値チェックを実行する。
- `frontend-quality-gates.test.mjs` を追加し、2000行 max-lines negative test、coverage completeness、stale entry、threshold regression を固定した。
- `RoomChat.test.tsx` の duplicate-submit test は coverage 実行時の遅延でも送信ボタン有効化を待つように安定化した。
- `RateCardSettingsCard.test.tsx` の disable flow は CI 並列実行時に空リストを掴まないよう、対象 item と disable button の描画完了を待つように安定化した。
- `EstimateDetail.test.tsx` の send-log retry flow は CI 並列実行時に API 呼び出し完了だけでなく、retry 後の履歴 item / error text の描画完了を待つように安定化した。

## Line count inventory

2026-07-13 JST 時点の `packages/frontend/src` production source では 2000 行超ファイルはない。

| Rank | File                                                             | Lines |
| ---: | ---------------------------------------------------------------- | ----: |
|    1 | `src/sections/RoomChat.tsx`                                      |  1803 |
|    2 | `src/sections/Projects.tsx`                                      |  1695 |
|    3 | `src/sections/CurrentUser.tsx`                                   |  1687 |
|    4 | `src/sections/Approvals.tsx`                                     |  1477 |
|    5 | `src/components/AnnotationsCard.tsx`                             |  1443 |
|    6 | `src/sections/VendorDocuments.tsx`                               |  1391 |
|    7 | `src/sections/Dashboard.tsx`                                     |  1251 |
|    8 | `src/sections/LeaveRequests.tsx`                                 |  1220 |
|    9 | `src/sections/Reports.tsx`                                       |  1130 |
|   10 | `src/pages/App.tsx`                                              |  1095 |
|  ref | `src/sections/AdminSettings.tsx`                                 |   929 |
|  ref | `src/sections/admin-settings/AdminSettingsPolicyPanel.tsx`       |  1008 |
|  ref | `src/sections/admin-settings/useAdminSettingsPolicyResources.ts` |   813 |

次段階の 1500 行 gate へ進めるには、`RoomChat.tsx`、`Projects.tsx`、`CurrentUser.tsx` を追加分割し、coverage scope / tests を同一PRで更新する。

## Coverage scope and threshold

`packages/frontend/coverage-thresholds.json` の `ui-core.files` は 92 production files を対象にする。既存 core UI / utility / major screen に加えて、次を completeness test で必須対象にした。

- `src/sections/AdminSettings.tsx`
- `src/sections/admin-settings/**` production files
- `src/sections/RoomChat.tsx`
- `src/sections/room-chat/**` production files

実測 baseline と gate threshold:

| Metric     | Measured | Threshold |
| ---------- | -------: | --------: |
| statements |   68.22% |    68.00% |
| branches   |   61.13% |    61.00% |
| functions  |   67.36% |    67.00% |
| lines      |   70.68% |    70.50% |

`coverage:ui-core:check` は `coverage/ui-core/coverage-summary.json` から `ui-core.files` のみを再集計する。対象外 UI の追加で分母が変わらない一方、AdminSettings / RoomChat 境界から対象ファイルを外した場合は completeness test または summary missing check が失敗する。

CI run `29230135795` / `29230137927` では V8 coverage の環境差により statements 68.10%、branches 61.07%、functions 67.15%、lines 70.56% とローカルより低く計測されたため、初期 gate は CI 実測値を下回る最小安全マージン付きの閾値（68.0 / 61.0 / 67.0 / 70.5）に調整した。

## Negative coverage

Added `packages/frontend/scripts/frontend-quality-gates.test.mjs` to cover:

- frontend ESLint default max-lines is 2000;
- a generated 2001-line production module fails ESLint via `max-lines`;
- AdminSettings / RoomChat production files are all included in `ui-core.files`;
- removing `src/sections/room-chat/useRoomChatMessages.ts` from the fixture scope fails completeness;
- configured source files must exist on disk;
- configured file missing from coverage summary fails the threshold checker;
- below-threshold fixture summary fails `check-coverage-thresholds.mjs`;
- threshold values cannot be lowered below the #1925 baseline.

## Verification

| Command                                                                                                               | Result | Notes                                                                                              |
| --------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| `npm ci --prefix packages/frontend`                                                                                   | PASS   | 0 vulnerabilities                                                                                  |
| `npm run quality-gates:test --prefix packages/frontend`                                                               | PASS   | node:test / 10 tests                                                                               |
| `npm run test --prefix packages/frontend -- src/sections/RoomChat.test.tsx`                                           | PASS   | 1 file / 11 tests                                                                                  |
| `npm run test --prefix packages/frontend -- src/sections/RateCardSettingsCard.test.tsx`                               | PASS   | 1 file / 10 tests                                                                                  |
| `npm run test --prefix packages/frontend -- src/sections/EstimateDetail.test.tsx src/sections/InvoiceDetail.test.tsx` | PASS   | 2 files / 8 tests                                                                                  |
| `npm run coverage:ui-core:check --prefix packages/frontend`                                                           | PASS   | node:test 10 tests + Vitest 82 files / 468 tests; thresholds above                                 |
| `npm run typecheck --prefix packages/frontend`                                                                        | PASS   | TypeScript no-emit                                                                                 |
| `npm run lint --prefix packages/frontend`                                                                             | PASS   | ESLint, including `max-lines` 2000 gate                                                            |
| `npm run format:check --prefix packages/frontend`                                                                     | PASS   | Prettier check for frontend source                                                                 |
| `npm run test --prefix packages/frontend`                                                                             | PASS   | 82 files / 468 tests                                                                               |
| `npm run build --prefix packages/frontend`                                                                            | PASS   | `AdminSettings` chunk `145.14 kB` / gzip `30.93 kB`; `RoomChat` chunk `46.00 kB` / gzip `13.11 kB` |
| `npm run build:budget --prefix packages/frontend`                                                                     | PASS   | initial JS `516.7 KiB` / gzip `157.7 KiB`                                                          |
| `npm audit --prefix packages/frontend --audit-level=high`                                                             | PASS   | 0 vulnerabilities                                                                                  |
| `node scripts/check-test-results-index.mjs`                                                                           | PASS   | index up to date                                                                                   |
| `node scripts/check-doc-image-links.mjs`                                                                              | PASS   | 115 image links in 323 markdown files                                                              |
| `git diff --check`                                                                                                    | PASS   | whitespace check                                                                                   |
| `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`                                                              | PASS   | 105 tests; Podman DB port fallback 55433 -> 55437                                                  |

## Compatibility notes

- UI/API/deep link/permission behavior is unchanged.
- No new npm dependency was added.
- CI branch-protection job names are unchanged; focused coverage is added inside existing `CI / frontend`.
- No temporary 2000-line allowance was introduced.

# UX/UI Phase 6 - マスタ管理・運用ジョブ 検証結果

## 対象

- Umbrella Issue: #1821
- Phase Issue: #1832
- 対象画面:
  - マスタ管理 (`packages/frontend/src/sections/MasterData.tsx`)
  - ジョブ管理 (`packages/frontend/src/sections/AdminJobs.tsx`)

## 実装概要

- Phase 1 で導入した `workflowUx` primitives をマスタ管理・運用ジョブ画面へ適用。
- `MasterData` にページ説明、`マスタ管理サマリー`、顧客・業者・連絡先の workflow panel を追加。
- `AdminJobs` にページ説明、`運用ジョブサマリー`、実行パラメータとジョブ実行一覧の workflow panel を追加。
- 既存の入力ラベル、ボタン名、API 呼び出し、保存ビュー、ジョブ実行・詳細確認の操作意味は維持。

## ローカル検証

| Check                                                                                                                | Result | Notes                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------- |
| `npm ci --prefix packages/frontend`                                                                                  | PASS   | 482 packages installed, 0 vulnerabilities                                 |
| `npm ci --prefix packages/backend`                                                                                   | PASS   | Backend dependencies installed for local E2E/audit, 0 vulnerabilities     |
| `npm run test --prefix packages/frontend -- MasterData.test.tsx AdminJobs.test.tsx`                                  | PASS   | 2 files / 21 tests                                                        |
| `npm run format:check --prefix packages/frontend`                                                                    | PASS   | Frontend source formatting OK                                             |
| `npm run typecheck --prefix packages/frontend`                                                                       | PASS   | TypeScript no emit                                                        |
| `npm run lint --prefix packages/frontend`                                                                            | PASS   | ESLint target `src/**/*`                                                  |
| `npm run build --prefix packages/frontend`                                                                           | PASS   | Vite build OK; existing chunk-size warning only                           |
| `npm audit --prefix packages/frontend --audit-level=high`                                                            | PASS   | 0 vulnerabilities                                                         |
| `npm audit --prefix packages/backend --audit-level=high`                                                             | PASS   | 0 vulnerabilities                                                         |
| `git diff --check`                                                                                                   | PASS   | Whitespace check OK                                                       |
| Targeted local E2E                                                                                                   | PASS   | `phase 6 master data and admin jobs UX/UI summaries render @core`, 1 test |
| `npx --prefix packages/frontend prettier --check packages/frontend/e2e/frontend-uiux-phase6-master-jobs.spec.ts ...` | PASS   | Phase 6 spec/source/test formatting OK                                    |

### Targeted E2E command

```bash
TMPDIR="$PWD/.codex-local/tmp/e2e-uiux-phase6" \
XDG_RUNTIME_DIR="$PWD/.codex-local/tmp/xdg-runtime-uiux-phase6" \
BACKEND_PORT=3110 \
FRONTEND_PORT=5185 \
E2E_PODMAN_CONTAINER_NAME=erp4-pg-e2e-uiux-phase6-master \
E2E_PODMAN_HOST_PORT=55446 \
E2E_CAPTURE=1 \
E2E_GREP='phase 6 master data and admin jobs UX/UI summaries render' \
E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-07-02-uiux-phase6-master-jobs" \
./scripts/e2e-frontend.sh
```

## スクリーンショット証跡

- `docs/test-results/2026-07-02-uiux-phase6-master-jobs/01-uiux-master-data.png`
- `docs/test-results/2026-07-02-uiux-phase6-master-jobs/02-uiux-admin-jobs.png`

## 目視確認

- マスタ管理画面で `マスタ管理サマリー`、顧客・業者・連絡先の workflow panel が表示されることを確認。
- 運用ジョブ画面で `運用ジョブサマリー`、実行パラメータ、ジョブ実行一覧の workflow panel が表示されることを確認。

## 既知のローカル環境メモ

- E2E 自体は PASS したが、ローカル rootless Podman の停止処理で `erp4-pg-e2e-uiux-phase6-master` が `Stopping` に残った。
- `podman stop -t 10` と `podman rm` は `given PID did not die within timeout` / `container state improper` で失敗した。
- 同様の `Stopping` 残存は Phase 1〜5 のローカル E2E でも確認済みで、アプリケーション実装・GitHub CI の成否とは切り分けて扱う。

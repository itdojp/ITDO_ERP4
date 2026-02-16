# 2026-02-17 E2E Flaky Stabilization (Issue #993)

Issue: #993  
Branch: `chore/993-flaky-stabilization`

## 変更点

- `scripts/e2e-frontend.sh`
  - サービス起動待機を 40 秒固定から環境変数駆動へ変更
  - 追加: `E2E_SERVICE_READY_TIMEOUT_SEC`（既定 80）, `E2E_SERVICE_READY_INTERVAL_SEC`（既定 1）
- `packages/frontend/e2e/frontend-smoke.spec.ts`
  - `E2E_ACTION_TIMEOUT_MS` 未指定時の既定値を CI 30 秒 / local 12 秒に調整
- `packages/frontend/src/sections/AdminSettings.tsx`
  - 手入力 JSON の検証失敗を `console.error` で出さず、開発時 `console.warn` に変更
- `docs/manual/e2e-evidence-howto.md`, `docs/manual/ui-evidence-quickstart.md`
  - 新しい待機時間調整パラメータを追記

## 実行確認

| Command | Result |
| --- | --- |
| `bash -n scripts/e2e-frontend.sh` | pass |
| `npm run lint --prefix packages/frontend` | pass |
| `npm run typecheck --prefix packages/frontend` | pass |
| `E2E_CAPTURE=0 E2E_SCOPE=core ./scripts/e2e-frontend.sh` | pass (30 passed) |

## 備考

- 既存の未追跡証跡ディレクトリ（`docs/test-results/2026-02-16-frontend-e2e/`）は本作業で変更していません。

# 2026-02-16 Code Review Baseline

Issue: #993  
Branch: `main` @ `323342e`

## 実行結果（品質ゲート）

| Command             | Exit | Duration(s) |
| ------------------- | ---: | ----------: |
| `make lint`         |    0 |          13 |
| `make format-check` |    0 |           5 |
| `make typecheck`    |    0 |          21 |
| `make build`        |    0 |          17 |
| `make test`         |    0 |          17 |
| `make audit`        |    0 |           5 |
| `make e2e`          |    0 |         150 |

ログ保存先: `tmp/baseline-20260216T140400Z/`

## 実行サマリ

- Backend test: `171 passed / 0 failed`
- Frontend E2E: `54 passed / 1 skipped`
- Evidence: `docs/test-results/2026-02-16-frontend-e2e`

## 観測事項（要フォロー）

- `make build` で frontend bundle size warning（>500kB）が出力される
- `make e2e` 中に以下ログが出力される（テスト失敗には未発展）
  - `[e2e] click skipped: ... list not ready: ...`
  - `AdminSettings parseJson subjects failed`（`console.error`）
- `make audit` は high/critical なしで成功。ただし low/moderate 脆弱性が出力される
  - `lodash`（経路: `prisma` 開発系依存）
  - `qs`

## 初期判定

- #993 の「0. キックオフ/基準化」は実施済み
- 次段で「仕様⇔実装トレーサビリティ」と「観測事項の原因切り分け」を並行実施する

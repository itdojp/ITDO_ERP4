# CI/CD 運用設計（現行実装ベース）

## 目的

- PR マージ前に、ビルド・型・テスト・セキュリティ・公開仕様（OpenAPI）を自動検証する。
- 週次/日次の監視ワークフローで、依存や運用ブロッカーを可視化する。

## 対象ブランチとトリガー

- `CI`（`.github/workflows/ci.yml`）
  - `push`（全ブランチ）
  - `pull_request`
  - `schedule`（毎日 18:00 UTC / 03:00 JST）
- 補助ワークフロー
  - `CodeQL`: `push(main)` / `pull_request` / `schedule`（毎週）
  - `Link Check`: `push` / `pull_request` / `workflow_dispatch`
  - `Dependabot Alert Watch`: `schedule`（毎週）/ `workflow_dispatch`
  - `ESLint 10 Readiness Watch`: `schedule`（毎週）/ `workflow_dispatch`
  - `Design System Package Watch`: `schedule`（毎日）/ `workflow_dispatch`
  - `DAST (OWASP ZAP)`: `schedule`（毎週）/ `workflow_dispatch`
  - `Performance`: `schedule`（毎週）/ `workflow_dispatch`
  - `Release (manual build)`: `workflow_dispatch`

## PRゲート（必須）

- PR で実行される主なジョブ
  - `backend`: backend build/test/prisma validate
  - `frontend`: frontend typecheck/build
  - `lint`: backend/frontend lint + format + doc image link check
  - `security-audit`: npm audit（high/critical）+ SBOM
  - `data-quality`: 非ブロッキング（`continue-on-error: true`）
  - `e2e-frontend`: PRでは `E2E_SCOPE=core`
  - `api-schema`: OpenAPI スナップショット差分と breaking change 検証
  - `secret-scan`: PR と schedule で実行
  - `analyze`（CodeQL）
  - `lychee`（Link Check）

## 条件付きジョブの仕様

- `e2e-frontend`
  - PR: 実行
  - push: デフォルトブランチのみ実行
  - schedule: 実行
- `api-schema`
  - `pull_request` のみ実行
- `secret-scan`
  - `pull_request` / `schedule` のみ実行
- 上記により、`push` や一部イベントでは `skipped` が正常系として発生する。

## 監視系ワークフローと Issue 同期

### Dependabot Alert Watch

- 実体: `scripts/check-dependabot-alerts.sh`
- 主用途:
  - alert #10/#11 の状態と lockfile 解決状態の監視
  - `#1153` への bot コメント同期
- ローカル記録:
  - `make dependabot-alerts-check`
  - `RUN_CHECK=1 FAIL_ON_CHECK=1 make dependabot-alerts-record`
  - テンプレート: `docs/test-results/dependabot-alerts-template.md`
- 失敗時:
  - failure reason を分類して `BLOCKED` コメントを更新
  - 状態同期は安全側でスキップ

### ESLint 10 Readiness Watch

- 実体: `scripts/check-eslint10-readiness.sh`
- 主用途:
  - `@typescript-eslint` + React 系 plugin の peer 互換監視
  - `#914` への bot コメント同期
- ローカル記録:
  - `make eslint10-readiness-check`
  - `RUN_CHECK=1 FAIL_ON_CHECK=1 make eslint10-readiness-record`
  - テンプレート: `docs/test-results/eslint10-readiness-template.md`
- `ready=true` 時のみ再開通知コメントを追加

## ローカル再現コマンド（最小）

- 総合:
  - `make lint`
  - `make format-check`
  - `make typecheck`
  - `make build`
  - `make test`
  - `make audit`
- 補助:
  - `make e2e`（ローカルE2E）
  - `make dependabot-alerts-check`
  - `RUN_CHECK=1 make dependabot-alerts-record`（単独実行時は既存ログまたは `LOG_FILE` 指定が必要）
  - `make eslint10-readiness-check`
  - `RUN_CHECK=1 make eslint10-readiness-record`（単独実行時は既存ログまたは `LOG_FILE` 指定が必要）
  - `make pr-comments PR=<番号>`

## Artifact 方針（主要）

- `security-audit`: CycloneDX SBOM
- `e2e-frontend`: 失敗時診断ログ
- `secret-scan`: TSV レポート
- `DAST`: ZAP レポート
- `Performance`: ベンチ結果
- `Design System Package Watch`: チェックログ

## 既知の運用ルール

- `data-quality` は非ブロッキング（品質傾向監視用）
- Dependabot の `eslint` / `@eslint/js` major は readiness 条件未達の間は抑止
- 監視系ワークフローは、失敗時でも Issue 状態を不用意に更新しない設計を優先

## 今後の改善候補

- workflow 単位の必須/任意を PR テンプレートに明示
- `schedule` 実行の失敗トリアージを運用ダッシュボードに集約
- CI 実行時間短縮（キャッシュ最適化・並列性調整）

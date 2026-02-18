# セキュリティ運用（Runbook）

## 入口
- ベースライン: `docs/security/security-baseline.md`

## 運用タスク（例）
- シークレットの管理/ローテーション（鍵/トークン）
- 権限（RBAC/プロジェクト所属）の棚卸し
- 監査ログ/権限変更ログの確認（必要に応じて）
- 依存脆弱性（`security-audit`）の継続対応

## キャッシュ/Push 方針（運用前提）
- APIレスポンスは `Cache-Control: no-store` / `Pragma: no-cache` を前提とする
- Service Worker のキャッシュ対象は静的アセットのみ（`/assets/*` とコアファイル）
- Push 通知の遷移URLは same-origin 相対パスのみ許可し、外部URLは開かない

## DAST（OWASP ZAP）運用
- 定常実行: GitHub Actions `DAST (OWASP ZAP)`（`/.github/workflows/dast-zap.yml`）
  - `schedule`: 毎週月曜 06:00 UTC
  - `workflow_dispatch`: 手動実行可能
- スキャン方式:
  - backend を CI 上で起動し、`http://127.0.0.1:3002/healthz` を ZAP baseline で検査
  - 初期運用は non-blocking（`Run ZAP baseline` ステップは `continue-on-error: true`）
- 成果物:
  - `zap-report-<run_id>`（`zap-report.html` / `zap-report.json` / `zap-report.md`）
  - `dast-backend-log-<run_id>`（backend 起動ログ）
- 指摘対応:
  1. Medium/High の新規検知は Security ラベル付き Issue を起票
  2. 該当 run の artifact URL と再現条件を Issue に記載
  3. 誤検知の場合は理由と抑止方針（rule ignore など）を Issue に記録

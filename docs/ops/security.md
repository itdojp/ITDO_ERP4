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

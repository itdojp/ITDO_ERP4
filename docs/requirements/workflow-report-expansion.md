# 自動化ワークフロー/レポート拡張（案）

## 目的
- 定期レポート生成・配信の運用を標準化する。
- 承認フローの条件分岐を拡張し、運用負荷を下げる。

## レポート拡張
※ 集計対象や月次/週次レポートの基本要件は `mvp-scope.md` に準拠し、本書では配信/テンプレート面の拡張を記述する。

### 定期レポート
- 月次/週次の自動生成
- 送信先: 管理者/グループ/担当者
- フォーマット: CSV/PDF
- 失敗時は再送（最大3回、指数バックオフ）
- 永続失敗は管理者に通知し、手動再送を許容

#### 配信実装（PoC→本実装）
- 配信チャネル: `email` / `dashboard` を想定
  - `email`: recipients.emails が空の場合は `skipped` 扱い
  - `dashboard`: recipients.users/roles が空の場合は `skipped` 扱い（管理画面の配信履歴に記録）
- 配信ステータス: `success` / `stub` / `failed` / `failed_permanent` / `skipped`
- 再送ジョブ: `POST /jobs/report-deliveries/retry`（`status=failed` + `nextRetryAt<=now` を再送）
- 再送ポリシー: `REPORT_DELIVERY_RETRY_MAX`（デフォルト3）、`REPORT_DELIVERY_RETRY_BASE_MINUTES`（デフォルト60）
- 永続失敗通知: `REPORT_DELIVERY_FAILURE_EMAILS`（カンマ区切り、未設定なら通知なし）
- CSV 添付: `REPORT_STORAGE_DIR`（デフォルト `/tmp/erp4/reports`）に書き出して添付
- PDF 添付: `generatePdf` の出力ファイル（`PDF_STORAGE_DIR`）を添付

### テンプレート拡張
- レポート項目のON/OFF
- 出力レイアウトのプリセット
- 署名/ロゴの挿入（PDF）

### reportKey 一覧（report_subscriptions）
レポート購読で利用する `reportKey` と想定パラメータ。

| reportKey | 用途 | 必須パラメータ | 任意パラメータ | 対応API |
| --- | --- | --- | --- | --- |
| project-effort | 案件工数/経費 | projectId | from, to, format, layout | GET `/reports/project-effort/:projectId` |
| project-profit | 案件損益（合計） | projectId | from, to, format, layout | GET `/reports/project-profit/:projectId` |
| project-profit-by-user | 案件損益（ユーザ別） | projectId | from, to, userIds, format, layout | GET `/reports/project-profit/:projectId/by-user` |
| project-profit-by-group | 案件損益（グループ別） | projectId, userIds | from, to, label, format, layout | GET `/reports/project-profit/:projectId/by-group` |
| group-effort | グループ工数 | userIds | from, to, format, layout | GET `/reports/group-effort` |
| overtime | 個人残業 | userId | from, to, format, layout | GET `/reports/overtime/:userId` |
| delivery-due | 納期未請求 | - | from, to, projectId, format, layout | GET `/reports/delivery-due` |

補足:
- `format` は `csv`/`pdf` を想定。省略時は JSON 返却。
- `layout` は PDF テンプレート識別子の suffix (`report:<name>:<layout>`) に利用。

## 自動化ワークフロー
※ 条件分岐/アクションの定義は `approval-alerts.md` / `mvp-scope.md` を正とし、本書ではレポート連携の補足のみを定義する。
- レポート連携の補足:
  - 承認分岐結果（スキップ/二重チェック/追加承認）をレポート生成のトリガーや送信先条件に利用できる。
  - 承認状態をレポート上に明示できる（例: 追加承認待ちフラグ）。

## 通知/監査
- 通知/監査の基本要件は `approval-alerts.md` / `approval-log.md` に準拠する。
- 自動化によりスキップした場合も監査ログに記録（既存の状態遷移ログの拡張）。

## オープン事項
- 自動化条件の管理画面UI

# PDF/メール本実装（仕様メモ）

## 目的
- 帳票テンプレートの差し替えとレイアウト設定を運用可能にする。
- PDF生成とメール送信を本番運用レベルにする（送信履歴/イベントトラッキング含む）。

## テンプレ管理
- `doc_template_settings` を管理画面/APIでCRUD。
- `kind` 単位で `isDefault=true` を1件に保つ。
- `templateId` は `/pdf-templates` で取得できるテンプレ一覧から選択。

### layoutConfig の想定キー
- `documentTitle`: 帳票のタイトル
- `companyName` / `companyAddress` / `companyPhone` / `companyEmail`
- `footerNote`
- `signatureLabel`
- `signatureImageUrl` (data URL / URL / ローカルパス)
- `signatureText` (署名テキスト)

## PDF生成
- `PDF_PROVIDER=local` の場合はローカル生成 + `/pdf-files/:filename` で配布。
- `PDF_PROVIDER=external` の場合は `PDF_EXTERNAL_URL` に JSON POST して PDF バイナリを取得し、ローカル保存。

## 送信ログ
- `document_send_logs` に送信履歴を保存。
- `document_send_events` にプロバイダ通知イベントを保存。

## SendGridイベント
- `/webhooks/sendgrid/events` を追加。
- `custom_args.sendLogId` があれば送信ログに紐付け。
- `SENDGRID_EVENT_WEBHOOK_SECRET` を設定した場合は `x-erp4-webhook-key` の一致を要求。
- サイズ/件数制限: `SENDGRID_EVENT_MAX_BYTES`, `SENDGRID_EVENT_MAX_BATCH`。

## リトライ
- `POST /document-send-logs/:id/retry` で再送を行う。
- 再送時は新しい `document_send_logs` を作成し、`metadata.retryOf` に元ログIDを保存。
- 連続再送は `SEND_LOG_RETRY_COOLDOWN_MINUTES` で制限する。

## PDF/アセットの安全対策
- 画像URLは `PDF_ASSET_ALLOWED_HOSTS` の許可リストに限定可能。
- `PDF_ASSET_MAX_BYTES` / `PDF_DATA_URL_MAX_BYTES` でサイズ制限。
- `PDF_EXTERNAL_MAX_BYTES` / `PDF_EXTERNAL_TIMEOUT_MS` で外部PDFの制限。

## 運用設定チェックリスト
### メール（SMTP）
- `MAIL_TRANSPORT=smtp`
- `MAIL_FROM`
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE`
- `SMTP_USER` / `SMTP_PASS`（任意）

### メール（SendGrid）
- `MAIL_TRANSPORT=sendgrid`
- `MAIL_FROM`
- `SENDGRID_API_KEY`
- `SENDGRID_BASE_URL`（任意）

### SendGridイベント
- `SENDGRID_EVENT_WEBHOOK_SECRET`（任意、設定時は `x-erp4-webhook-key` の値の一致が必要）
- `SENDGRID_EVENT_MAX_BYTES` / `SENDGRID_EVENT_MAX_BATCH`（任意）

### PDF（local）
- `PDF_PROVIDER=local`
- `PDF_STORAGE_DIR`
- `PDF_BASE_URL`（任意、未設定なら `/pdf-files`）

### PDF（external）
- `PDF_PROVIDER=external`
- `PDF_EXTERNAL_URL`
- `PDF_EXTERNAL_API_KEY`（任意）

## QA/確認手順（本番運用前）
1. `POST /invoices/:id/send` または `POST /purchase-orders/:id/send` を実行
2. `GET /document-send-logs/:id` で `status` と `error` を確認
3. `GET /document-send-logs/:id/events` でイベント紐付けを確認（SendGridの場合）
4. `GET /pdf-files/:filename` が 200 で返ることを確認（localの場合）
5. `POST /document-send-logs/:id/retry` で再送が新しいログとして記録されることを確認

## 障害時の確認ポイント
- `MAIL_TRANSPORT` と必須環境変数（`MAIL_FROM` / `SENDGRID_API_KEY` / `SMTP_HOST` など）の不足
- `document_send_logs` の `status` と `error`、`providerMessageId` の有無
- `PDF_EXTERNAL_URL` の到達性と `PDF_EXTERNAL_MAX_BYTES` の制限
- `PDF_STORAGE_DIR` の権限・ディスク容量（localの場合）
- `SENDGRID_EVENT_WEBHOOK_SECRET` の一致（SendGridイベント受信時）

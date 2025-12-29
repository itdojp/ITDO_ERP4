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

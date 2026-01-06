# レポート配信 運用検証（2026-01-06）

## 目的
- レポート配信の定期実行/再送/失敗通知/CSV・PDF生成を検証する。

## 環境
- Podman: `scripts/podman-poc.sh reset`
- Backend: `node packages/backend/dist/index.js`
- ENV: `AUTH_MODE=header`, `MAIL_TRANSPORT=stub`, `REPORT_DELIVERY_FAILURE_EMAILS=ops@example.com`

## 実施内容と結果
### 1. CSV配信（delivery-due）
- Project: `b14bf631-3312-479a-9af3-78737ac1c22d` / Milestone: `6543bd22-6ee6-4c16-a38e-feae991c52a5`
- Report subscription (CSV): `e5606548-859c-4fe2-8f7e-64f1c293b6e3`
- Run結果: delivery `1dab9a1d-51bb-4cf9-866d-1334863acb58` が `status=stub`
- CSV保存: `/tmp/erp4/reports/delivery-due-e5606548-859c-4fe2-8f7e-64f1c293b6e3-2026-01-06T102440657Z.csv`（261 bytes）

### 2. 定期実行ジョブ（dry-run/実行）
- `DRY_RUN=1 ./scripts/run-report-deliveries.sh`
  - `/jobs/report-subscriptions/run` → count=1
  - `/jobs/report-deliveries/retry` → count=0
- `./scripts/run-report-deliveries.sh`
  - subscriptions 実行で delivery 作成を確認

### 3. リトライ動作
- `ReportDelivery` を一時的に `status=failed` / `nextRetryAt=now()` に更新
- `/jobs/report-deliveries/retry` 実行後に `status=stub` へ更新を確認

### 4. 失敗通知
- 失敗用 subscription: `daa58166-02a9-4edf-b520-71b87aa99be8`（無効メール）
- delivery `bcc469ef-6159-4a09-ab0a-1891bead91df` が `status=failed_permanent` / `error=invalid_recipient`
- `REPORT_DELIVERY_FAILURE_EMAILS` 宛てに通知（stubログで確認）

### 5. PDF生成
- Report subscription (PDF): `c228e7cf-f6e4-4ca3-a17c-59b55f523817`
- delivery `3dcefb5e-dbd6-4777-be0b-ab52f456733e` が `status=stub`
- PDF保存: `/tmp/erp4/pdfs/report-delivery-due-default-delivery-due-03a24077-b4c6-4817-bf81-d8130559c7c6-2026-01-06T102949429Z.pdf`（1672 bytes）

## 補足
- 失敗通知は stub 送信ログで確認（`Report delivery failed: delivery-due`）。

# フロントE2E（full + UIエビデンス r1）

## 実行日時
- 2026-01-19

## 実行コマンド
```bash
E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-01-19-frontend-e2e-r1" \
E2E_CAPTURE=1 \
E2E_SCOPE=full \
./scripts/e2e-frontend.sh
```

## 実行条件（主要）
- DB: Podman（`E2E_DB_MODE=podman`、デフォルト）
- 証跡: 取得あり（`E2E_CAPTURE=1`）
- 外部LLM: stub（`CHAT_EXTERNAL_LLM_PROVIDER=stub`、デフォルト）
- 画面ベースURL: `http://localhost:5173`（デフォルト）

## 結果
- 32 passed / 1 skipped
- skip: `pwa push subscribe flow @pwa`（`VITE_PUSH_PUBLIC_KEY` 未設定のためスキップ）

## エビデンス格納先
- `docs/test-results/2026-01-19-frontend-e2e-r1/`

## 追加/更新キャプチャ（管理設定の詳細）
- `11-chat-settings.png`（チャット設定）
- `11-chat-room-settings.png`（チャットルーム設定）
- `11-scim-provisioning.png`（SCIM プロビジョニング）
- `11-rate-card.png`（単価（RateCard））
- `11-alert-settings.png`（アラート設定（簡易モック））
- `11-approval-rules.png`（承認ルール（簡易モック））
- `11-template-settings.png`（テンプレ設定（見積/請求/発注））
- `11-report-subscriptions.png`（レポート購読（配信設定））
- `11-integration-settings.png`（外部連携設定（HR/CRM））

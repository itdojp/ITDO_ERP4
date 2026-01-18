# Feature Flag 運用（最小導入）

## 目的
- デプロイ（成果物の配布）と機能有効化を分離し、リリース事故時の切り戻しを容易にする
- 設定変更の監査（誰がいつ変更したか）を可能にする

## 方針（現時点）
- **DB設定（Settingsテーブル）** を Feature Flag の保管先とする
  - アプリの再デプロイ無しで ON/OFF できる
  - 変更は監査ログに残す（`audit_logs`）

## 現行の最小 Feature Flag（Chat）
現時点で Feature Flag 相当として運用できる設定は `ChatSetting` です。
- `allowUserPrivateGroupCreation`: private group 作成可否
- `allowDmCreation`: DM 作成可否

API（管理者/マネージャ向け）
- 取得: `GET /chat-settings`
- 更新: `PATCH /chat-settings`

例（DM作成を無効化）
```bash
curl -X PATCH "$API_URL/chat-settings" \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer $TOKEN" \\
  -d '{\"allowDmCreation\": false}'
```

## 事故時の基本手順
1. 影響範囲の特定（request-id / 直近デプロイSHA）
2. 可能なら Feature Flag を OFF（機能無効化）
3. 必要に応じて成果物をロールバック（`docs/ops/release-strategy.md`）

## 注意事項
- Feature Flag は「一時的な切り戻し手段」であり、恒久対策は Issue 化して対応する
- Flag の追加は増やしすぎると運用負債になるため、最小限から開始する


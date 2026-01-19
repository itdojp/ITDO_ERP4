# トラブルシュート（PoC/検証）

## 目的
- 代表的な障害/問い合わせの一次切り分けを標準化する

## 参照
- 運用一次切り分け: [incident-response](../ops/incident-response.md)
- 設定（環境変数）: [configuration](../ops/configuration.md)
- 権限: [role-permissions](role-permissions.md)

## 1. 401/403（認証・権限）
- 401（未認証）:
  - PoC: 擬似ログインが未設定（現在のユーザーで設定）
  - 本番: OIDC/JWT 設定（`JWT_*` / `AUTH_MODE`）を確認
- 403（権限不足）:
  - 役割（roles）/案件スコープ（projectIds）/グループ（groupIds）を確認

## 2. 画面が表示されない/通信できない
- フロントが `VITE_API_BASE` を参照できているか確認
- backend の `/health` が 200 で応答するか確認

## 3. E2E が落ちる（Playwright）
チェックポイント:
- DB が起動している（Podman/CIのpostgres）
- `psql` が利用できる（direct mode の場合）
- `playwright install chromium` が完了している

ローカル実行手順は [e2e-evidence-howto](e2e-evidence-howto.md) を参照。

## 4. チャット添付が失敗する
- `CHAT_ATTACHMENT_PROVIDER` を確認（local/gdrive）
- gdrive の場合は `CHAT_ATTACHMENT_GDRIVE_*` が揃っているか確認
- 疎通チェック: [scripts/check-chat-gdrive.ts](../../scripts/check-chat-gdrive.ts)

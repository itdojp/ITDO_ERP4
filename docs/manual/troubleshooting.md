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
- backend の `/healthz` が `200` で応答するか確認
- backend の `/readyz` が `200` で応答するか確認（`503` は依存障害の可能性）
- ブラウザ開発者ツールで失敗した API を開き、Response Headers の `x-request-id` を控える（CORS や通信断時は取得できない場合あり）

## 3. E2E が落ちる（Playwright）
チェックポイント:
- DB が起動している（Podman/CIのpostgres）
- `psql` が利用できる（direct mode の場合）
- `playwright install chromium` が完了している

よくある原因/対処:
- Podman DB のポート競合:
  - `E2E_PODMAN_HOST_PORT` 未指定の場合、`scripts/e2e-frontend.sh` が空きポートへ自動フォールバックします（ログに表示）。
  - ポートを固定したい場合は `E2E_PODMAN_HOST_PORT=55435` のように明示指定します（競合時はエラーで停止）。
- `E2E_DB_MODE=direct`:
  - `DATABASE_URL` が必須です（例: `postgresql://...`）。
  - `psql` が必要です（未導入の場合は `E2E_DB_MODE=podman` を利用）。
- Playwright のインストール:
  - 既にインストール済みであれば `E2E_SKIP_PLAYWRIGHT_INSTALL=1` でスキップできます。
- 実行ログの確認:
  - backend は `tmp/e2e-backend.log`、frontend は `tmp/e2e-frontend.log` を確認します。
  - `x-request-id` を採取できた場合は、該当ログを採取した `x-request-id` の値で検索します。

ローカル実行手順は [e2e-evidence-howto](e2e-evidence-howto.md) を参照。

## 4. チャット添付が失敗する
- `CHAT_ATTACHMENT_PROVIDER` を確認（local/gdrive）
- gdrive の場合は `CHAT_ATTACHMENT_GDRIVE_*` が揃っているか確認
- 疎通チェック: [scripts/check-chat-gdrive.ts](../../scripts/check-chat-gdrive.ts)

## 5. 運用へエスカレーションする条件
PoC/検証の一次切り分けで止めず、[incident-response](../ops/incident-response.md) に切り替える条件を明示する。

- `/healthz` が `200` でない、または `/readyz` が `503` を返す
- 同一事象が複数ユーザ、複数導線、または主要導線で再現する
- `x-request-id` を採取できており、アプリ側ログ確認が必要な段階に入った
- 認証情報、権限逸脱、外部公開設定、秘密情報露出の疑いがある
- `security-audit`、通知送信、定期レポートなどの重要ジョブが連続失敗している

### エスカレーション時に引き継ぐ情報
- 発生時刻と再現手順
- 影響範囲（誰が、どの画面/APIで失敗したか）
- `/healthz` / `/readyz` の結果
- `x-request-id`、エラーメッセージ、スクリーンショット
- 直近の設定変更、デプロイ、secret rotation の有無

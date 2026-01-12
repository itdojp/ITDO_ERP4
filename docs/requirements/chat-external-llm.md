# チャットAI: 外部LLM連携（公式ルームのみ）

本ドキュメントは、チャットの要約などを外部LLMへ送信して実行するための設定・運用メモです。

## 方針（MVP）
- 外部送信は「外部連携」とみなし、**公式ルームのみ**許可する
  - `ChatRoom.isOfficial=true` かつ `ChatRoom.allowExternalIntegrations=true`
- 私的ルーム/private_group/DM は常に送信不可
- 送信対象は **本文のみ**（添付は送信しない）
- 送信範囲は最小化（期間 + 件数上限）
  - UIは「直近120件 / 過去7日間」を既定値として送信する
- 監査ログを必須化（成功/失敗とも）

## 1. 必要な環境変数（Backend）
### Provider（必須）
- `CHAT_EXTERNAL_LLM_PROVIDER`
  - `openai` / `stub` / 未設定（disabled）
- `CHAT_EXTERNAL_LLM_MODEL`（任意）
  - providerが `openai` の場合のモデル名（例: `gpt-4o-mini`）
  - providerが `stub` の場合は表示名（既定: `stub`）

### OpenAI（provider=openai の場合のみ必須）
- `CHAT_EXTERNAL_LLM_OPENAI_API_KEY`
- `CHAT_EXTERNAL_LLM_OPENAI_BASE_URL`（任意、既定: `https://api.openai.com/v1`）
- `CHAT_EXTERNAL_LLM_TIMEOUT_MS`（任意、既定: `15000`）

### レート制限（任意）
- `CHAT_EXTERNAL_LLM_RATE_LIMIT_USER_PER_HOUR`（既定: `10`）
- `CHAT_EXTERNAL_LLM_RATE_LIMIT_ROOM_PER_HOUR`（既定: `30`）

## 2. ルーム側の有効化（admin/mgmt）
1. Settings → 「チャットルーム設定」
2. 対象の公式ルームを選択
3. 「外部連携を許可」をON
4. 保存

## 3. 実行（RoomChat）
1. チャット → 対象ルームを選択
2. 「外部要約」を押す
3. 確認ダイアログで続行

## 4. 監査ログ
外部送信の監査ログは `audit_logs` に保存されます。

- `chat_external_llm_requested`
- `chat_external_llm_succeeded`
- `chat_external_llm_failed`

メタデータ（例）
- roomId / roomType / provider / model / 期間 / 件数上限 / エラー（失敗時）など

## 5. 補足（E2E）
`./scripts/e2e-frontend.sh` は、外部送信を行わないように既定で `CHAT_EXTERNAL_LLM_PROVIDER=stub` を有効化して実行します。
（明示的に環境変数を指定した場合はそちらが優先されます）


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
  - hostnameはWHATWG URL／IDNA正規化前のraw値をASCIIとして検証する。Unicode／IDN表記は拒否するため、必要な場合は運用者がASCII punycodeへ明示変換し、同じcanonical hostをallowlistへ設定する
- `CHAT_EXTERNAL_LLM_ALLOWED_HOSTS`
  - カンマ区切りの接続先allowlist。custom base URLでは必須で、base URL hostを含める。raw値はUnicode case fold前にASCII検証し、IPv6 literalは角括弧なしcanonical表現で指定する
  - 既定の`https://api.openai.com/v1`だけは後方互換のため`api.openai.com`を暗黙allowlistとする
- `CHAT_EXTERNAL_LLM_ALLOW_HTTP` / `CHAT_EXTERNAL_LLM_ALLOW_PRIVATE_IP`
  - repository-sideの明示的なlocal testだけで利用する。productionでは`true`を拒否する
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

## 6. Knowledge Hubとの共有境界

- Knowledge HubはChat要約routeやChat固有promptを直接呼び出さず、provider-neutral text portの`bind`／`prepare`／単一`dispatch`だけを共有します。
- `CHAT_EXTERNAL_LLM_*`はChat専用の後方互換設定です。Knowledge Hubは`KNOWLEDGE_EXTERNAL_LLM_*`とversioned model catalogを使用し、Chat設定へfallbackしません。
- Chatの公式room ACL、user/room rate limit、要約response契約は変更しません。Knowledge側のselected context、exact source ACL、preview/confirm、user/organization budget、idempotency、conversation provenanceはKnowledge bounded contextが所有します。
- repository-side testでは両機能にstub/fakeを使用できますが、Knowledge stubまたはfake HTTP serverの成功を実provider検証として扱いません。KnowledgeのOpenAI-compatible runtimeは同じtransport adapterをstrict UTF-8/JSON/usage、256 KiB上限で使用し、Chatは既存の1 MiB上限、malformed success fallback、usage無視を維持します。いずれも自動retry、provider/model fallback、API keyのlog/audit保存を禁止します。

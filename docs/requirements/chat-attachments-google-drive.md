# チャット添付: Google Drive 連携セットアップ（検証用）

本ドキュメントは、チャット添付を Google Drive に保存する検証用セットアップ手順です。
（実装: `CHAT_ATTACHMENT_PROVIDER=gdrive`）

## 目的/方針
- ユーザに Drive への直接アクセス権を付与しない
- ERP が権限チェックした上で upload/download を行う
- 監査ログ（upload/download）を残す
- Drive は「システムユーザ（専用アカウント）のみが読み書きできる領域」をストレージとして使う

## 必要な環境変数
- `CHAT_ATTACHMENT_PROVIDER=gdrive`
- `CHAT_ATTACHMENT_GDRIVE_CLIENT_ID`
- `CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET`
- `CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN`
- `CHAT_ATTACHMENT_GDRIVE_FOLDER_ID`

任意:
- `CHAT_ATTACHMENT_MAX_BYTES`（デフォルト: 10MB）

## 1. Drive 側: 保存先フォルダID（FOLDER_ID）を取得
### 推奨（最小スコープに寄せる）
`drive.file` スコープで運用するため、**フォルダはアプリ（OAuth）で作成**します。

1. システムユーザで Google Drive にログイン（専用アカウント推奨）
2. 共有設定は「制限付き」を維持（システムユーザ以外が閲覧できないことを確認）
3. `scripts/provision-chat-gdrive-folder.ts` を実行して `FOLDER_ID` を取得

例:
```bash
export CHAT_ATTACHMENT_GDRIVE_CLIENT_ID=...
export CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET=...
export CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN=...
export CHAT_ATTACHMENT_GDRIVE_FOLDER_NAME="ERP4 Chat Attachments"

npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/provision-chat-gdrive-folder.ts
```

出力された `FOLDER_ID` を `CHAT_ATTACHMENT_GDRIVE_FOLDER_ID` に設定します。

### 既存フォルダ/Shared Drive を使う場合（互換性優先）
既存フォルダや Shared Drive 直下を使う場合は、後述のスコープ選定で `drive` が必要になる可能性があります。
その場合でも、**専用アカウント + 専用フォルダ（制限付き）** を前提にします。

Shared Drive を使う場合も同様にフォルダIDを取得できます。

## 2. Google Cloud 側: Drive API を有効化
1. Google Cloud Console でプロジェクトを作成/選択
2. `APIs & Services` → `Library` → **Google Drive API** を有効化

## 3. OAuth 同意画面（Consent Screen）
1. `APIs & Services` → `OAuth consent screen`
2. Workspace であれば `Internal` を推奨（refresh token 失効の運用が楽）
3. 外部扱いになる場合は、テストユーザにシステムユーザを追加

## 4. OAuth Client を作成（CLIENT_ID/CLIENT_SECRET）
1. `APIs & Services` → `Credentials` → `Create Credentials` → `OAuth client ID`
2. アプリ種別は `Web application` を推奨
3. `Authorized redirect URIs` に `https://developers.google.com/oauthplayground` を追加
4. 発行された `Client ID` / `Client Secret` を控える

## 5. Refresh Token を取得（REFRESH_TOKEN）
OAuth 2.0 Playground（`https://developers.google.com/oauthplayground`）を使うのが簡単です。

1. 右上の ⚙ を開き、`Use your own OAuth credentials` を ON
2. `OAuth Client ID` / `OAuth Client secret` に上記の値を入力
3. Scope を選択
   - 推奨（最小権限）: `https://www.googleapis.com/auth/drive.file`
     - アプリが作成した添付（および添付フォルダ）だけにアクセス範囲を限定できる
     - そのため、保存先フォルダは **アプリで作成** する（手順: セクション 1）
   - 互換性優先: `https://www.googleapis.com/auth/drive`
     - 既存フォルダ/Shared Drive を使う場合に必要になることがある
4. `Authorize APIs` → システムユーザでログインして許可
5. `Exchange authorization code for tokens` を実行し、`refresh_token` を控える

refresh token が取得できない場合:
- 一度許可したアプリを Google アカウント側で削除して再実行する
- Playground 側で `approval_prompt=force` 相当の再同意を行う

## 6. 動作確認（ローカルE2Eで検証）
以下のように env を設定して E2E を実行すると、チャットの添付アップロード/表示が通ることを確認できます。

例:
```bash
export CHAT_ATTACHMENT_PROVIDER=gdrive
export CHAT_ATTACHMENT_GDRIVE_CLIENT_ID=...
export CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET=...
export CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN=...
export CHAT_ATTACHMENT_GDRIVE_FOLDER_ID=...

E2E_CAPTURE=0 E2E_SCOPE=extended ./scripts/e2e-frontend.sh
```

## 7. セキュリティ/運用メモ
- `REFRESH_TOKEN` は実質的に長期鍵のため、Secret管理（Vault等）に置く
- 共有フォルダ/共有ドライブの権限設定次第で、添付が意図せず閲覧可能になる可能性があるため、フォルダの共有設定を必ず確認する
- 将来的に「公式ルームのみ添付OK」等のポリシーを導入する場合は #434 と整合させる
- 添付のウイルス対策（スキャン）は `CHAT_ATTACHMENT_AV_PROVIDER` で制御する（MVP: `disabled`/`stub`/`eicar`/`clamav`、詳細: `docs/requirements/chat-attachments-antivirus.md`）

### トークン保管/ローテーション
- 保管先: GitHub Actions Secrets / 実行環境の Secret Manager（平文の `.env` を配布しない）
- ローテーション手順（例）:
  1. Playground で新しい `refresh_token` を発行
  2. Secrets を更新してデプロイ
  3. `scripts/check-chat-gdrive.ts`（read または write）で疎通確認
  4. 旧トークンを失効（下記）

### 失効（revoke）
選択肢:
- Google アカウント側で「アプリのアクセス権」を削除（システムユーザで実施）
- OAuth revoke endpoint（運用手順として採用する場合）:
  - `POST https://oauth2.googleapis.com/revoke` に `token=<refresh_token>` を送る
  - 実施後は必ず疎通確認を行う

### 監視（最小）
- 監査ログ: `chat_attachment_uploaded` / `chat_attachment_downloaded` が `AuditLog` に記録される
- 障害検知: 送受信失敗（`gdrive_*` エラー）が継続する場合は、トークン失効/権限変更/容量枯渇を疑う

### 有効化/無効化の追跡（最小）
- 有効化/無効化は `CHAT_ATTACHMENT_PROVIDER`（`local|gdrive`）で制御する
- 変更は運用Issueに記録し、ローテーション/失効の実施日と紐づける（Team プラン等で監査ログが参照できない場合の代替）

## 8. 補助: Drive疎通チェック（スクリプト）
E2Eを回す前に「フォルダ参照ができるか」「（任意で）書き込み/削除ができるか」を確認するためのスクリプトです。

```bash
# read only（一覧取得まで）
npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/check-chat-gdrive.ts

# write（テストファイルを作成→削除/ゴミ箱）
GDRIVE_CHECK_MODE=write \
  npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/check-chat-gdrive.ts
```

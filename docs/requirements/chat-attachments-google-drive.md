# チャット添付: Google Drive 連携セットアップ（検証用）

本ドキュメントは、チャット添付を Google Drive に保存する検証用セットアップ手順です。
（実装: `CHAT_ATTACHMENT_PROVIDER=gdrive`）

#1976 で有効化する対象は Chat 添付のみで、PDF / Evidence Pack / Report の Google Drive 対応は #1977 で扱います。

## 目的/方針

- ユーザに Drive への直接アクセス権を付与しない
- ERP が権限チェックした上で upload/download を行う
- 監査ログ（upload/download）を残す
- Drive は「システムユーザ（専用アカウント）のみが読み書きできる領域」をストレージとして使う
- API レスポンスに Drive URL や直接共有権限を返さず、添付は ERP4 の認可済み API 経由で配信する
- production の保存先は Shared Drive を推奨し、`domain-wide delegation` は追加しない

## 必要な環境変数

- `CHAT_ATTACHMENT_PROVIDER=gdrive`
- `ERP4_GDRIVE_CLIENT_ID`
- `ERP4_GDRIVE_CLIENT_SECRET`
- `ERP4_GDRIVE_REFRESH_TOKEN`
- `CHAT_ATTACHMENT_GDRIVE_FOLDER_ID`

任意:

- `ERP4_GDRIVE_SHARED_DRIVE_ID`（Shared Drive を使う場合の Drive ID）
- `ERP4_GDRIVE_TIMEOUT_MS`（デフォルト: `30000`、`1..300000`）
- `ERP4_GDRIVE_MAX_RETRIES`（デフォルト: `3`、`0..10`）
- `ERP4_GDRIVE_RETRY_BASE_DELAY_MS`（デフォルト: `250`、`1..60000`。実待機は最大64秒にcap）
- `ERP4_GDRIVE_RESUMABLE_UPLOAD_THRESHOLD_BYTES`（デフォルト: `5242880` / 5MiB）
- `CHAT_ATTACHMENT_MAX_BYTES`（デフォルト: 10MB）

旧 `CHAT_ATTACHMENT_GDRIVE_CLIENT_ID` / `CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET` / `CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN` は後方互換 fallback のみです。共通キーを1つでも設定した場合は3つすべての `ERP4_GDRIVE_*` が必須で、field単位に旧キーと混在させません。共通キーがすべて未設定の場合だけ完全な旧credential setへfallbackし、両方の完全なsetがある場合は共通setを優先します。旧キーは deprecated のため新規設定では使用せず、警告を含むログには credential の値を出しません。旧 alias は少なくとも copy-only migration #1981 の完了までは維持し、削除時期は #1981 完了後に別の breaking-change Issue / release note で決定します（#1976 では削除しません）。保存先の `CHAT_ATTACHMENT_GDRIVE_FOLDER_ID` は Chat 固有キーとして維持します。

## 1. Drive 側: 保存先フォルダID（FOLDER_ID）を取得

### 保存先構成

Drive ID と保存先 folder ID は別の設定として管理します。

- Shared Drive 直下: `ERP4_GDRIVE_SHARED_DRIVE_ID` に Shared Drive ID、`CHAT_ATTACHMENT_GDRIVE_FOLDER_ID` に対象ルートフォルダの ID を設定する
- Shared Drive の専用 subfolder（production 推奨）: Shared Drive ID と、ERP4 専用 subfolder の folder ID をそれぞれ設定する
- My Drive の専用 folder: `ERP4_GDRIVE_SHARED_DRIVE_ID` は未設定とし、`CHAT_ATTACHMENT_GDRIVE_FOLDER_ID` に専用 folder ID を設定する

Shared Drive ID を folder ID の代用として一律に扱わず、対象構成ごとに両者を確認します。

### 専用 subfolder を作成する場合

1. システムユーザで Google Drive にログイン（専用アカウント推奨）
2. 共有設定は「制限付き」を維持（システムユーザ以外が閲覧できないことを確認）
3. credential と必要に応じて Shared Drive ID を、mode `0600` の保護された env file に設定
4. 標準 wrapper `scripts/ops/gcp-drive-check.sh` で専用 subfolder を作成し、folder ID は保護された出力ファイルへ保存

例:

```bash
install -d -m 700 .codex-local/secure
umask 077
touch .codex-local/secure/gdrive.env
chmod 600 .codex-local/secure/gdrive.env
```

`.codex-local/secure/gdrive.env` に credential と必要に応じて Shared Drive ID を editor / secret injection で設定し、値を画面表示しません。その後に provision を実行します。

wrapper は compiled backend CLI を使います。未buildのcheckoutでは、repository標準手順で backend dependencies / Prisma Client を準備した後、先に `npm run build --prefix packages/backend` を実行します。

```bash
./scripts/ops/gcp-drive-check.sh \
  --env-file .codex-local/secure/gdrive.env \
  --provision-folder \
  --folder-id-output-file .codex-local/secure/chat-gdrive-folder.env \
  --mode read
```

`--folder-id-output-file` は `--provision-folder` と同時に必須です。wrapper は出力ファイルを mode `0600` で新規作成し、folder ID を stdout や Markdown 証跡へ表示しません。remote createの結果が不明な場合、出力ファイルには照合用markerと `CREATE_STARTED` 状態が残ります。この場合はファイルを削除して再実行せず、同じmarkerのfolder有無を運用担当者が照合してから再開します。出力ファイル内の `CHAT_ATTACHMENT_GDRIVE_FOLDER_ID` は、画面出力せず承認済みの secret 保管先/runtime env（上記の保護済み env file を含む）へ転記します。単独の read / write を実行する前に、この転記を完了します。

`CREATE_STARTED` が残った場合は、時間を置いて次の read-only reconciliation を実行します。markerとfolder IDは表示せず、一致が1件の場合だけ保護ファイルを `COMPLETE` へ更新します。0件または複数件ではremote createを再実行しません。

```bash
./scripts/ops/gcp-drive-check.sh \
  --env-file .codex-local/secure/gdrive.env \
  --reconcile-provision \
  --folder-id-output-file .codex-local/secure/chat-gdrive-folder.env \
  --mode read
```

### 既存 folder / Shared Drive 直下を使う場合

既存 folder または Shared Drive 直下を使う場合も、**専用アカウント + 制限付きの保存先**を前提にします。実際の ID は stdout、Issue、PR、スクリーンショット、Markdown 証跡に記録せず、保護された env file / secret 保管先へ直接保存します。

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
     - 既存 Shared Drive folder へのアクセス可否は、実ユーザの Shared Drive membership と取得済み scope の組み合わせで read/write preflight する
   - `https://www.googleapis.com/auth/drive` の採用要否は、上記 preflight と組織ポリシーに基づき個別判断する。既存 Shared Drive folder を使うことだけを理由に必須とは断定しない
4. `Authorize APIs` → システムユーザでログインして許可
5. `Exchange authorization code for tokens` を実行し、`refresh_token` を控える

refresh token が取得できない場合:

- 一度許可したアプリを Google アカウント側で削除して再実行する
- Playground 側で `approval_prompt=force` 相当の再同意を行う

## 6. 動作確認

実 Google Drive の検証は、unit test / fake による検証と operator preflight を分けます。

- 自動テスト: fake Google Drive API と unit test で、設定解決、API parameter、再試行、エラー正規化を確認する。実 Google Drive への疎通を示す証跡ではない
- operator preflight: 実ユーザの membership / scope / folder 権限を使い、標準 wrapper の read と write を実行する

```bash
./scripts/ops/gcp-drive-check.sh --env-file .codex-local/secure/gdrive.env --mode read
./scripts/ops/gcp-drive-check.sh --env-file .codex-local/secure/gdrive.env --mode write
```

`--mode write` はテストファイルを作成して trash するため、対象環境と実行者を確認して明示的に実施します。folder ID / Drive ID や credential 値は証跡に記録しません。

ローカル E2E で Chat 添付のアプリ導線を確認する場合は、保護された runtime env を設定した上で実行します。

```bash
E2E_CAPTURE=0 E2E_SCOPE=extended ./scripts/e2e-frontend.sh
```

#1976 の完了時点では実 Google Drive 検証は未実施です。production の `CHAT_ATTACHMENT_PROVIDER=gdrive` への切り替えは、operator preflight の結果を確認した人間の承認対象とします。

## 7. Drive API 呼び出し契約

- `files.create` は結果不明時に重複オブジェクトを作る可能性があるため、fresh create をアプリケーション側で再試行しない
- `get` / `stat` / `trash` は retryable な失敗だけを上限付き exponential backoff で再試行する
- 5MiB（`5242880` bytes）以上の upload は Drive API の resumable session 開始 POST と upload PUT を使い、それ未満は multipart を使う
- Shared Drive と My Drive の両方に対応するため、対象 API 呼び出しに `supportsAllDrives=true` を付ける
- `includeItemsFromAllDrives=true`、`corpora=drive`、`driveId` は list 操作だけで使う。`corpora=drive` と `driveId` は Shared Drive を特定できる場合に限る
- 削除は既定で `trashed=true` に更新し、完全削除しない
- `files.create` は `ignoreDefaultVisibility=true` とし、Drive URL や直接共有権限を返さず、domain-wide delegation を追加しない
- runtime の get / stat / trash は、対象 file の parent folder と Shared Drive ID が設定境界と一致する場合だけ許可する
- operator preflight は folder permissions を全 page 確認する。My Driveでは有効permissionが単一user主体だけでない場合をNo-Goとする。Shared Driveでは0件またはShared Driveから継承されたpermissionだけを許可し、direct permission、domain、anyoneをNo-Goとする
- Chat upload後のDB永続化失敗に対するcompensating cleanupは、failure semanticsを推測で変更せず #1982 で仕様化する。#1976では既存の外部storage→DB順序を維持する
- write probeのcreate結果不明・trash失敗時の保護済みrecovery workflowは #1983 で追加する。#1976のwrite modeを実行する際は途中失敗後に再実行せず運用担当者へエスカレーションする

## 8. セキュリティ/運用メモ

- `REFRESH_TOKEN` は実質的に長期鍵のため、Secret管理（Vault等）に置く
- 共有フォルダ/共有ドライブの権限設定次第で、添付が意図せず閲覧可能になる可能性があるため、フォルダの共有設定を必ず確認する
- 将来的に「公式ルームのみ添付OK」等のポリシーを導入する場合は #434 と整合させる
- 添付のウイルス対策（スキャン）は `CHAT_ATTACHMENT_AV_PROVIDER` で制御する（MVP: `disabled`/`stub`/`eicar`/`clamav`、詳細: `docs/requirements/chat-attachments-antivirus.md`）

### トークン保管/ローテーション

- 保管先: GitHub Actions Secrets / 実行環境の Secret Manager（平文の `.env` を配布しない）
- ローテーション手順（例）:
  1. Playground で新しい `refresh_token` を発行
  2. Secrets を更新してデプロイ
  3. `scripts/ops/gcp-drive-check.sh` で read / write operator preflight
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
- production の変更は人間が承認し、運用Issueに記録してローテーション/失効の実施日と紐づける（Team プラン等で監査ログが参照できない場合の代替）

## 9. 補助: Drive疎通チェック（標準 wrapper）

E2Eを回す前に「フォルダ参照ができるか」「（明示実行で）書き込み/trash ができるか」を確認します。TypeScript スクリプトを直接実行せず、安全性チェックを含む wrapper を標準手順とします。

```bash
# read only（一覧取得まで）
./scripts/ops/gcp-drive-check.sh --env-file .codex-local/secure/gdrive.env --mode read

# write（テストファイルを作成→ゴミ箱）
./scripts/ops/gcp-drive-check.sh --env-file .codex-local/secure/gdrive.env --mode write
```

# Google Cloud 事前設定 Runbook（さくらVPS 導入前）

## 目的

さくらVPS へ ERP4 を導入する前に、Google Cloud / Google Auth Platform / Google Drive で必要な設定を完了し、VPS 側の env に安全に転記できる状態を作る。

この Runbook は「Google Cloud 側で先に決める値」と「VPS 導入時に検証する値」を分離する。Google OIDC ログインの詳細は [google-oidc-google-cloud-console](google-oidc-google-cloud-console.md)、チャット添付の Google Drive 連携詳細は [../requirements/chat-attachments-google-drive](../requirements/chat-attachments-google-drive.md) を参照する。#1976 で Google Drive を有効化する対象は Chat 添付のみで、PDF / Evidence Pack / Report は #1977 で扱う。

## 対象構成

| 項目           | 推奨                                                     | 備考                                                                          |
| -------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| ERP4 hosting   | さくらVPS + Podman + Quadlet                             | 導入手順は [sakura-vps-deployment](sakura-vps-deployment.md)                  |
| Auth           | Google OIDC + `AUTH_MODE=jwt_bff`                        | backend callback は FQDN + HTTPS                                              |
| 添付ストレージ | Google Drive または local                                | Drive は `CHAT_ATTACHMENT_PROVIDER=gdrive`。production は Shared Drive を推奨 |
| secrets        | VPS runtime env / GitHub Secrets / Google Secret Manager | 値そのものはリポジトリへ入れない                                              |
| automation     | gcloud / GitHub Actions                                  | 可能なら keyless auth を採用                                                  |

## 0. 作業前に決める値

| 種別                 | 値の例                                                                 | 使用箇所                                    |
| -------------------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| Google Cloud project | `erp4-prod` / `erp4-stg`                                               | API / OAuth / Secrets の管理単位            |
| frontend origin      | `https://app.example.com`                                              | `ALLOWED_ORIGINS`, `AUTH_FRONTEND_ORIGIN`   |
| backend origin       | `https://api.example.com`                                              | `VITE_API_BASE`, OAuth redirect URI         |
| OIDC redirect URI    | `https://api.example.com/auth/google/callback`                         | Google OAuth client                         |
| Drive folder name    | `ERP4 Chat Attachments`                                                | `CHAT_ATTACHMENT_GDRIVE_FOLDER_ID` の作成元 |
| Drive topology       | Shared Drive 専用 subfolder / Shared Drive 直下 / My Drive 専用 folder | Drive ID と folder ID を分離                |
| support email        | `ops@example.com`                                                      | OAuth Branding / verification               |
| ops owner            | GitHub user / Google group                                             | secret owner / reviewer                     |

判断基準:

- production と trial/staging で Google Cloud project または OAuth client を共有しない。
- raw IP / plain HTTP は Google OIDC の実ログイン確認に使わない。VPS 実機でも FQDN + HTTPS を前提にする。
- OAuth client secret / refresh token / service account key は作成直後に安全な保管先へ移し、ローカルメモや Issue コメントに貼らない。

## 1. Google Cloud project / IAM

### 1-1. project を作成または選択する

1. Google Cloud Console で ERP4 用 project を作成または選択する。
2. billing が必要な API / Secret Manager を使う場合は billing link を確認する。
3. staging / production の分離方針を Issue に記録する。

記録項目:

```text
Google Cloud project id:
Environment: trial | staging | production
Billing linked: yes | no | n/a
Primary owner:
Backup owner:
Created/confirmed at:
```

### 1-2. IAM を最小化する

推奨ロールの考え方:

| 作業                        | 必要な権限の例                                         | 備考                         |
| --------------------------- | ------------------------------------------------------ | ---------------------------- |
| API 有効化                  | Project Editor 相当または Service Usage 管理権限       | 恒久付与せず作業後に見直す   |
| OAuth client 作成           | Google Auth Platform / Cloud Console の管理権限        | 組織ポリシーに依存           |
| Secret Manager 管理         | Secret Manager Admin                                   | 値の閲覧者は分ける           |
| secret 参照                 | Secret Manager Secret Accessor                         | runtime / CI のみ            |
| GitHub Actions keyless auth | Workload Identity Pool / Service Account Token Creator | service account key を避ける |

## 2. API 有効化

最低限確認する API:

| API                 | 使う条件                                                           | 確認              |
| ------------------- | ------------------------------------------------------------------ | ----------------- |
| Google Drive API    | `CHAT_ATTACHMENT_PROVIDER=gdrive` を使う                           | 有効化必須        |
| Secret Manager API  | Google Cloud 側に secrets を置く                                   | 推奨              |
| IAM Credentials API | Workload Identity Federation で service account impersonation する | CI 自動化時に必要 |
| Service Usage API   | gcloud で API 有効化状態を扱う                                     | 自動化時に便利    |

確認例:

```bash
gcloud config get-value project
gcloud services list --enabled --filter='name:drive.googleapis.com OR name:secretmanager.googleapis.com OR name:iamcredentials.googleapis.com OR name:serviceusage.googleapis.com'
```

変更を伴う操作は、対象 project を確認してから実行する。

```bash
gcloud services enable drive.googleapis.com secretmanager.googleapis.com
```

### 2-1. gcloud preflight wrapper

手順漏れを抑えるため、`scripts/ops/gcp-preflight.sh` で account / project / API / billing / secret metadata / WIF を確認できる。詳細は [ops-automation](ops-automation.md) を参照する。

読み取り専用の確認:

```bash
./scripts/ops/gcp-preflight.sh --check \
  --project erp4-prod \
  --secret erp4-google-oidc-client-secret \
  --secret erp4-chat-gdrive-refresh-token \
  --markdown-summary docs/test-results/gcp-preflight-YYYY-MM-DD.md
```

API有効化を自動化する場合は `--apply` と `--confirm-project` を必須にする。

```bash
./scripts/ops/gcp-preflight.sh --apply \
  --project erp4-prod \
  --confirm-project erp4-prod
```

この wrapper は secret値を読み取らず、Secret Manager の secret名と version metadata のみを確認する。

## 3. Google OIDC ログイン設定

詳細手順は [google-oidc-google-cloud-console](google-oidc-google-cloud-console.md) を正とする。この Runbook では導入前の完了条件だけを管理する。

完了条件:

- [ ] Google Auth Platform の Branding が設定済み
- [ ] Audience が `Internal` / `External` のどちらかに決まっている
- [ ] `openid`, `email`, `profile` 以外の scope を追加していない
- [ ] OAuth client 種別は `Web application`
- [ ] `Authorized redirect URIs` に `https://api.example.com/auth/google/callback` 相当を登録済み
- [ ] client ID を `GOOGLE_OIDC_CLIENT_ID` / `JWT_AUDIENCE` へ反映する方針が決まっている
- [ ] client secret の保管先が決まっている
- [ ] secret ローテーション手順が [secrets-and-access](secrets-and-access.md) と矛盾していない

ERP4 側への対応:

| Google 側           | ERP4 env                                  |
| ------------------- | ----------------------------------------- |
| OAuth client ID     | `GOOGLE_OIDC_CLIENT_ID`, `JWT_AUDIENCE`   |
| OAuth client secret | `GOOGLE_OIDC_CLIENT_SECRET`               |
| redirect URI        | `GOOGLE_OIDC_REDIRECT_URI`                |
| frontend origin     | `AUTH_FRONTEND_ORIGIN`, `ALLOWED_ORIGINS` |
| backend origin      | `VITE_API_BASE`                           |

## 4. Google Driveストレージ設定

### 4-1. scope 方針

推奨は `https://www.googleapis.com/auth/drive.file` とする。

- アプリが作成・開いたファイルにアクセス範囲を寄せやすい。
- ERP4 の添付フォルダはアプリで作成する運用にする。
- 既存 Shared Drive folder にアクセスできるかは、実ユーザの Shared Drive membership と取得済み scope で read / write operator preflight する。
- `drive` scope が必要かは preflight と組織ポリシーに基づき個別判断する。既存 Shared Drive folder を使うことだけを理由に必須とは断定しない。
- domain-wide delegation は追加しない。

保存先は次のいずれかとし、Drive ID と folder ID を別の設定として管理する。productionではChat、PDF、Evidence archive、Reportを専用subfolderへ分離する。

| 構成                                        | `ERP4_GDRIVE_SHARED_DRIVE_ID` | context別folder ID  |
| ------------------------------------------- | ----------------------------- | ------------------- |
| Shared Drive専用subfolder（production推奨） | Shared Drive ID               | 専用subfolder ID    |
| Shared Drive直下                            | Shared Drive ID               | 対象ルートfolder ID |
| My Drive専用folder                          | 未設定                        | 専用folder ID       |

context別のfolder env:

| context          | folder env                          |
| ---------------- | ----------------------------------- |
| Chat attachment  | `CHAT_ATTACHMENT_GDRIVE_FOLDER_ID`  |
| PDF              | `PDF_GDRIVE_FOLDER_ID`              |
| Evidence archive | `EVIDENCE_ARCHIVE_GDRIVE_FOLDER_ID` |
| Report output    | `REPORT_GDRIVE_FOLDER_ID`           |

### 4-2. OAuth client / refresh token

チャット添付の Google Drive 連携は refresh token を長期鍵として扱う。

完了条件:

- [ ] Drive API が有効化されている
- [ ] OAuth client が作成済み
- [ ] `https://developers.google.com/oauthplayground` が redirect URI に登録されている（Playground を使う場合）
- [ ] `drive.file` または採用 scope が記録されている
- [ ] refresh token を取得済み
- [ ] refresh token の保管先・閲覧者・ローテーション手順が決まっている
- [ ] token revoke 手順を確認済み
- [ ] Shared Drive を使う場合、実ユーザ membership と採用 scope で read / write operator preflight する計画がある

ERP4 側への対応:

| Google 側           | ERP4 env                                  |
| ------------------- | ----------------------------------------- |
| OAuth client ID     | `ERP4_GDRIVE_CLIENT_ID`                   |
| OAuth client secret | `ERP4_GDRIVE_CLIENT_SECRET`               |
| refresh token       | `ERP4_GDRIVE_REFRESH_TOKEN`               |
| Shared Drive ID     | `ERP4_GDRIVE_SHARED_DRIVE_ID`（任意）     |
| folder ID           | 上記context別`*_GDRIVE_FOLDER_ID`         |
| provider switch     | Chatのみ`CHAT_ATTACHMENT_PROVIDER=gdrive` |

このfoundation PRではPDF、Evidence archive、Reportのfolder preflightとstorage portまでを提供する。これら3 contextのruntime provider切替は#1977の後続runtime integration PRで実装・検証するまで設定しない。未実装の`PDF_PROVIDER=gdrive`、`EVIDENCE_ARCHIVE_PROVIDER=gdrive`、`REPORT_PROVIDER=gdrive`を本番envへ追加してはならない。

旧 `CHAT_ATTACHMENT_GDRIVE_CLIENT_ID` / `CHAT_ATTACHMENT_GDRIVE_CLIENT_SECRET` / `CHAT_ATTACHMENT_GDRIVE_REFRESH_TOKEN` は deprecated な後方互換 fallback とする。共通キーを1つでも設定した場合は完全な `ERP4_GDRIVE_*` 3点setを必須とし、field単位の混在は拒否する。共通setが未設定の場合だけ完全な旧setへfallbackし、両方が完全な場合は共通setを優先する。ログにはcredential値を出さない。

### 4-3. フォルダ作成/疎通確認

credential と、Shared Drive を使う場合は Drive ID を mode `0600` の保護された env file に保存する。値は shell history、stdout、Issue、PR、Markdown 証跡へ出さない。

```bash
install -d -m 700 .codex-local/secure
umask 077
touch .codex-local/secure/gdrive.env
chmod 600 .codex-local/secure/gdrive.env
```

`.codex-local/secure/gdrive.env` に credential と必要に応じて Shared Drive ID を editor / secret injection で設定し、値を画面表示しない。その後に標準 wrapper で provision する。

wrapper は compiled backend CLI を使う。未buildのcheckoutでは、repository標準手順で backend dependencies / Prisma Client を準備した後、先に `npm run build --prefix packages/backend` を実行する。

`--target`は`chat|pdf|evidence|report`を受け付ける。非Chat targetは完全な`ERP4_GDRIVE_*` credentialだけを使用し、旧Chat aliasへfallbackしない。各folderを別のprotected outputへprovisionし、出力されたenv keyを承認済みruntime secretへ画面表示なしで転記する。

```bash
./scripts/ops/gcp-drive-check.sh \
  --env-file .codex-local/secure/gdrive.env \
  --target chat \
  --provision-folder \
  --folder-id-output-file .codex-local/secure/chat-gdrive-folder.env \
  --mode read
```

PDF folderの例（Evidence/Reportも`--target`を変更して同様に実行）:

```bash
./scripts/ops/gcp-drive-check.sh \
  --env-file .codex-local/secure/gdrive.env \
  --target pdf \
  --provision-folder \
  --folder-id-output-file .codex-local/secure/pdf-gdrive-folder.env \
  --mode read
```

`--folder-id-output-file` は provision 時に必須で、既存ファイルを上書きせず mode `0600` で folder ID を保存する。create結果不明時は照合用markerと `CREATE_STARTED` が保護ファイルに残るため、削除・再実行せず同じmarkerのfolderを照合する。保護された出力ファイルから承認済みの secret 保管先/runtime env（上記の保護済み env file を含む）へ画面出力なしで転記する。単独の read / write を実行する前に、この転記を完了する。

`CREATE_STARTED` の照合は次の read-only mode で行う。一致が1件なら保護ファイルを `COMPLETE` に更新し、0件または複数件ならremote createを再実行せず停止する。

```bash
./scripts/ops/gcp-drive-check.sh \
  --env-file .codex-local/secure/gdrive.env \
  --reconcile-provision \
  --folder-id-output-file .codex-local/secure/chat-gdrive-folder.env \
  --mode read
```

保存先を設定した保護済み env file で read / write operator preflight を行う。

```bash
./scripts/ops/gcp-drive-check.sh --env-file .codex-local/secure/gdrive.env --target pdf --mode read
./scripts/ops/gcp-drive-check.sh --env-file .codex-local/secure/gdrive.env --target pdf --mode write
```

`scripts/ops/gcp-drive-check.sh` を標準手順とし、配下の TypeScript スクリプトを直接実行しない。`--mode write` はテストファイルを作成して trash する。証跡には成功/失敗と時刻だけを残し、credential 値、folder ID、Drive ID は残さない。

fake API を使う unit test は設定解決、API parameter、再試行、エラー処理を検証するもので、実 Google Drive の membership / scope / folder 権限を検証しない。各contextのproduction切り替え前に対象folderのoperator preflightを完了する。

### 4-4. API/データ運用方針

- `files.create` は結果不明時の重複を防ぐため fresh create をアプリケーション側で再試行しない。
- `get` / `stat` / `trash` は retryable な失敗だけを上限付きで再試行する。既定は timeout `30000`ms、最大再試行 `3`、base delay `250`ms。
- `5242880` bytes（5MiB）以上は Drive API の resumable session 開始 POST と upload PUT を使う。
- 対象 API 呼び出しは `supportsAllDrives=true` とし、list に限って `includeItemsFromAllDrives=true`、Shared Drive 特定時の `corpora=drive` / `driveId` を使う。
- 削除は既定で trash とし、完全削除しない。
- `files.create` は `ignoreDefaultVisibility=true` とし、Drive URLや直接共有権限を ERP4 利用者へ返さない。
- read / write preflight は folder permissions を全 page 検査し、有効 permission が単一 user だけでない場合（domain / anyone / group / 複数 user）は No-Go とする。Shared Drive membership の変更後は再実行する。

### 4-5. DB backup二次copyの分離

DB backup用Google Driveはapplication file用Driveとは別の障害・権限境界として扱う。

- backup専用OAuth client、専用principal、専用Shared Drive subfolderを使用する。
- `ERP4_GDRIVE_*`、旧`CHAT_ATTACHMENT_GDRIVE_*`、対話利用者の個人My Driveへfallbackしない。
- repository側の標準設定はShared Driveを必須とする。Shared Driveを採用できない例外は自動fallbackせず、組織ポリシー、専用system user、共有制限、退職・失効時の所有権を別途reviewする。
- principalへはbackup folderのread/write/trashに必要な最小権限だけを付与する。domain-wide delegation、公開link、`anyone` / domain-wide共有を追加しない。
- Driveへ送るのは、Sakura primaryへ保存・検証済みのOpenPGP暗号化artifactとmanifestだけとする。平文DB dump、globals、assetsは送らない。

ERP4側への対応:

| Google側                      | ERP4 env                           |
| ----------------------------- | ---------------------------------- |
| backup専用OAuth client ID     | `BACKUP_GDRIVE_CLIENT_ID`          |
| backup専用OAuth client secret | `BACKUP_GDRIVE_CLIENT_SECRET`      |
| backup専用refresh token       | `BACKUP_GDRIVE_REFRESH_TOKEN`      |
| Shared Drive ID               | `BACKUP_GDRIVE_SHARED_DRIVE_ID`    |
| backup専用folder ID           | `BACKUP_GDRIVE_FOLDER_ID`          |
| provider switch               | `BACKUP_SECONDARY_PROVIDER=gdrive` |

設定値はmode `0600`、current owner、non-symlinkのVPS runtime envへsecret injectionする。実値はCLI引数、shell history、process list、Issue、PR、test-results、raw共有logへ記録しない。

初回およびtoken / membership変更後は、private envを読み込んだ管理端末で次の順に確認する。

```bash
npm run build --prefix packages/backend
./scripts/backup-gdrive-secondary.sh check-config
./scripts/backup-gdrive-secondary.sh list
```

`list`はread-onlyの最初のpreflightである。write検証はsyntheticな暗号化bundleをSakura primaryへ保存・検証した後、標準`backup-prod.sh upload`経路で実施し、Drive単独uploadを正常構成として扱わない。folder ID、file ID、token、raw API errorはprivate evidenceだけに保持し、repositoryへは時刻、commit SHA、sanitized resultだけを記録する。

rotation / revoke:

1. 新tokenをbackup専用principal・同一scopeで取得し、承認済みsecret storeへ新versionとして保存する。
2. 新tokenで`check-config`、read-only `list`、承認済みsynthetic encrypted round-tripを確認する。
3. runtime envをatomicに切り替え、timerの次回結果とfreshnessを確認する。
4. 旧tokenをGoogle側でrevokeし、旧versionを無効化する。値やGoogle内部識別子は証跡へ転記しない。
5. auth failure時はSakura primaryを維持してsecondaryを`partial_failure`として監視し、Drive-onlyへ切り替えない。

## 5. Secrets 保管方針

### 5-1. 保管先の使い分け

| 保管先                 | 用途                                 | 注意                               |
| ---------------------- | ------------------------------------ | ---------------------------------- |
| VPS runtime env        | systemd/Quadlet runtime が直接読む値 | file mode を `0600` に寄せる       |
| GitHub Actions Secrets | CI/CD が使う値                       | Environment Secrets を優先         |
| Google Secret Manager  | Google Cloud 側で管理する値          | version disable / destroy を分ける |
| ローカル端末           | 初回作業の一時保持のみ               | 作業後に削除する                   |

### 5-2. リポジトリへ入れてよいもの/いけないもの

入れてよいもの:

- env key 名
- placeholder
- secret の保管場所名
- rotation 手順
- 失効手順

入れてはいけないもの:

- OAuth client secret の実値
- refresh token
- service account key JSON
- private key
- 実DB password
- 本番 URL と紐づく bearer token

## 6. GitHub Actions / 自動化

Google Cloud を GitHub Actions から操作する場合は、原則として service account key JSON を repository secret に保存しない。可能なら Workload Identity Federation を採用する。

判断基準:

| 方式                         | 採用条件                          | 注意                                                  |
| ---------------------------- | --------------------------------- | ----------------------------------------------------- |
| Workload Identity Federation | GitHub Actions から gcloud を使う | provider / audience / repository condition を絞る     |
| service account key          | WIF が使えない例外                | 有効期限、保管先、rotation、失効日を必ず Issue に記録 |
| 手動 gcloud                  | 初期導入や小規模運用              | 実行者と対象 project を証跡に残す                     |

## 7. 導入前 Go/No-Go チェック

VPS 導入へ進む前に、以下を Issue または導入証跡へ記録する。

```text
Date:
Operator:
Google Cloud project id:
Environment:
Frontend origin:
Backend origin:
OIDC client created: yes/no/n/a
OIDC redirect URI verified: yes/no/n/a
Drive API enabled: yes/no/n/a
Drive scope:
Drive folder id stored: yes/no/n/a
Shared Drive selected: yes/no/n/a
Secrets storage:
Refresh token stored: yes/no/n/a
Drive read preflight: pass/fail/n/a
Drive write preflight: pass/fail/n/a
Backup Drive OAuth isolated: yes/no/n/a
Backup Shared Drive selected: yes/no/n/a
Backup Drive read preflight: pass/fail/n/a
Backup encrypted round-trip: pass/fail/n/a
WIF configured: yes/no/n/a
Manual exceptions:
Next action:
```

実際の folder ID / Drive ID はこの証跡へ記載しない。

Go 条件:

- Google OIDC を使う場合、OAuth client と redirect URI が確定している。
- Google Drive 添付を使う場合、Drive API / OAuth client / refresh token / folder ID が揃い、read / write operator preflight が成功している。
- Google Drive backup二次copyを使う場合、backup専用credential / Shared Drive / folderがapplication file用と分離され、read preflightと暗号化bundleのround-tripが成功している。
- secret の保管先と閲覧者が明確である。
- VPS 側へ転記する env key と値の受け渡し方法が決まっている。
- production の `CHAT_ATTACHMENT_PROVIDER=gdrive` 切り替えについて人間の承認がある。

No-Go 条件:

- refresh token や client secret を平文チャット/Issue/PR に貼る必要がある。
- project / environment が曖昧である。
- redirect URI が raw IP / plain HTTP 前提である。
- scope が過大で、承認理由が記録されていない。
- 実 Google Drive の read / write を fake/unit test だけで代替している。
- backup用credentialが`ERP4_GDRIVE_*`またはChat用credentialと共用されている。

## 8. トラブルシュート

### refresh token が取得できない

- 既に同じ client/scope/user で許可済みの場合、再同意が必要なことがある。
- Google アカウント側でアプリのアクセス権を削除してから再実行する。
- OAuth Playground で自前 OAuth credentials を使っているか確認する。

### `redirect_uri_mismatch`

- Google Console の redirect URI と `GOOGLE_OIDC_REDIRECT_URI` が一致していない。
- `http` / `https`、host、path、末尾 slash を確認する。
- 変更直後は反映待ちが必要な場合がある。

### Drive read/write が失敗する

- Drive API が有効か確認する。
- refresh token の scope が不足していないか確認する。
- Shared Drive の場合、`ERP4_GDRIVE_SHARED_DRIVE_ID` と `CHAT_ATTACHMENT_GDRIVE_FOLDER_ID` を取り違えていないか、値を画面表示せず保護済み env file 上で確認する。
- `drive.file` の場合、対象フォルダへの実ユーザ membership / scope が適合するか operator preflight で確認する。
- folder の共有設定が専用アカウントに閉じているか確認する。

## 関連 Runbook

- さくらVPS 導入: [sakura-vps-deployment](sakura-vps-deployment.md)
- さくらVPS Quadlet 手順: [sakura-vps-podman-trial](sakura-vps-podman-trial.md)
- Google OIDC Console 設定: [google-oidc-google-cloud-console](google-oidc-google-cloud-console.md)
- Google OIDC Auth Gateway: [google-oidc-auth-gateway-rollout](google-oidc-auth-gateway-rollout.md)
- Secrets/アクセス権限: [secrets-and-access](secrets-and-access.md)
- Google Drive 添付: [../requirements/chat-attachments-google-drive](../requirements/chat-attachments-google-drive.md)
- Backup / restore: [backup-restore](backup-restore.md)

## 参考（2026-05-10 確認）

- Google Drive API scopes: <https://developers.google.com/drive/api/guides/api-specific-auth>
- Google Drive API enablement: <https://developers.google.com/drive/api/guides/enable-sdk>
- OAuth 2.0 Playground: <https://developers.google.com/oauthplayground>
- Workload Identity Federation: <https://cloud.google.com/iam/docs/workload-identity-federation>
- Secret Manager best practices: <https://cloud.google.com/secret-manager/docs/best-practices>

# バックアップ/リストア Runbook

## 目的と境界

このRunbookは次を分離する。

1. repo-side fake / unit検証
2. providerへのreadiness
3. backup / upload / verified download
4. isolated restoreと整合性検証
5. retention plan / apply

#1978では1と安全なCLI契約までを実装する。実さくらbucket、実credential、実restoreのpass証跡は#544、cutoverは#1981で扱う。

要件:

- docs/requirements/backup-restore.md
- decision: docs/ops/backup-s3-decision-checklist.md
- DR: docs/ops/dr-plan.md

## 禁止事項

明示的人間承認なしに次を行わない。

- production credentialの利用
- RESTORE_CONFIRM=1による実restore
- retention apply
- bucket / policy / lifecycleの変更
- source backupの削除
- GPG private key操作
- production timer有効化

credential、private endpoint、実bucket名、object key、鍵識別子、raw logをGitHubへ記録しない。

## 1. private envの準備

docs/requirements/backup-restore.env.exampleをrepository外へcopyする。owner-onlyのregular fileとし、symlinkは使わない。

```bash
install -m 600 docs/requirements/backup-restore.env.example "$PRIVATE_BACKUP_ENV_FILE"
stat -c '%a %u %F' "$PRIVATE_BACKUP_ENV_FILE"
```

値は承認済みsecret delivery pathから入力する。shell traceを無効にし、読み込んだ値をechoしない。

```bash
set +x
set -a
. "$PRIVATE_BACKUP_ENV_FILE"
set +a
```

S3 credentialはrepository用env templateへ書かない。AWS CLI標準credential chainを使い、Sakura専用・最小権限のprofileをowner-onlyのcredentials fileまたは承認済みsecret injectionから供給する。profile名とcredentials file pathだけをprivate envへ置く場合も、fileをmode 600、non-symlink、current ownerとする。

```bash
chmod 600 "$AWS_SHARED_CREDENTIALS_FILE"
test ! -L "$AWS_SHARED_CREDENTIALS_FILE"
test "$(stat -c %u "$AWS_SHARED_CREDENTIALS_FILE")" = "$(id -u)"
set +x
export AWS_PROFILE
```

backup writerには対象prefixのlist / head / get / putだけを付与する。readinessのsynthetic probeと承認済みretention applyに必要なdelete権限は、日常backup writerから分離したoperator principalで実行する。credential value、AWS CLI debug output、署名付きrequestをlogやevidenceへ転記しない。

Sakura profileで最低限確認する項目:

- S3_PROVIDER=sakura
- AWS_PROFILE / AWS_SHARED_CREDENTIALS_FILEまたは同等の承認済みsecret injection
- credentialを含まないHTTPS originのS3_ENDPOINT_URL
- S3_BUCKET / S3_PREFIX / S3_REGION
- GPG_RECIPIENT / GPG_HOME
- ENVIRONMENT / COMMIT_SHA / DB_VERSION / SCHEMA_VERSION / APP_VERSION
- BACKUP_RETENTION_CLASS
- S3_OPERATOR_EVIDENCE_FILE
- 4 classのRETENTION_MIN_*値

## 2. repo-side profile test

実providerへ接続しないfake test:

```bash
make backup-s3-profile-test
```

検証範囲:

- AWS既存profile
- Sakura endpoint / KMS不要契約
- put / head / get / delete fake round-trip
- OpenPGP packet guard
- manifest / checksum
- immutable upload
- unsafe prefix / filename
- retention plan / minimum generations
- apply guard
- secret-like log拒否

fake結果はtarget-environment successではない。

## 3. readiness

### 3.1 fake preflight

```bash
S3_EXECUTION_MODE=fake \
S3_REAL_RUN_CONFIRM=0 \
CHECK_WRITE=0 \
make backup-s3-readiness-check
```

fakeまたは既存sanitized logから生成したrecordはsummaryStatus: blockedになる。これは期待動作である。

### 3.2 Sakura operator evidence

AWS固有管理APIをSakuraへ推測適用しない。公式S3-compatible APIで確認できるbucket location、versioning、bucket ACLはcheckerが直接確認する。provider console / official control planeの確認結果もprivate fileへ記録する。

```text
versioningStatus=<reviewed-state>
publicAccessStatus=<reviewed-state>
accessControlStatus=<reviewed-state>
retentionStatus=<reviewed-state>
```

```bash
chmod 600 "$S3_OPERATOR_EVIDENCE_FILE"
test ! -L "$S3_OPERATOR_EVIDENCE_FILE"
test "$(stat -c %u "$S3_OPERATOR_EVIDENCE_FILE")" = "$(id -u)"
```

fileにはcredential、endpoint、bucket名を含めない。

### 3.3 real readiness（#544）

実credentialと対象が承認済みの場合のみ実行する。

```bash
S3_EXECUTION_MODE=real \
S3_REAL_RUN_CONFIRM=1 \
CHECK_WRITE=1 \
RUN_CHECK=1 \
FAIL_ON_CHECK=1 \
make backup-s3-readiness-record
```

pass条件:

- evidenceBasis: direct-check
- executionMode: real
- realRunConfirmed: 1
- writeProbe: 1
- summaryStatus: pass
- Sakura operator evidence提出済み
- put / head / get / delete probe成功
- versioning有効時はPUT応答のversion IDを指定してsynthetic probe versionを削除済み

checkerはendpoint、bucket、object key、KMS識別子をlogへ出さず、AWS CLIのraw errorを再出力しない。version IDが得られない場合はdelete markerを作るcleanupを推測実行せず停止する。failure時はprivate operator inventoryで調査し、sanitized原因だけをIssueへ記録する。

## 4. backup / upload / download / check

### 4.1 backup

```bash
make backup-s3-backup
```

Sakura profileはDB、globals、metadata、任意assetsを同一backup IDで生成し、OpenPGPで暗号化してuploadする。DB / schema / app versionとcommit SHAが欠ける場合は停止する。

GPG_REMOVE_PLAINTEXT:

- 0: 失敗調査・recovery用にplaintextを保持
- 1: verified copy後に生成元plaintextを削除

最初の実証では0とし、#544のcleanup手順と証跡を確認した後にproduction値を決める。

### 4.2 既存bundleのupload

```bash
BACKUP_FILE="$PRIVATE_BACKUP_DIR/<bundle>-db.dump" \
BACKUP_GLOBALS_FILE="$PRIVATE_BACKUP_DIR/<bundle>-globals.sql" \
BACKUP_ASSETS_FILE="$PRIVATE_BACKUP_DIR/<bundle>-assets.tar.gz" \
make backup-s3-upload
```

Sakuraではdatabase、globals、metadataが同じbundleに属する必要がある。pre-encrypted artifactは既存manifest sidecarを要求する。同一remote keyが存在すれば上書きせず停止する。remote existence checkとPUTはS3 API上の単一atomic操作ではないため、production backup runnerは1環境1 writerとし、複数hostから同じbackup IDを同時uploadしない。

S3_VERIFY_DOWNLOAD=1の場合、upload後にartifactとremote manifestの両方をprivate scratchへ再downloadする。remote manifestが送信元manifestとbyte一致し、artifactのSHA-256とOpenPGP packetが一致する場合だけ成功とする。`BACKUP_SECONDARY_PROVIDER=gdrive`では`S3_VERIFY_DOWNLOAD=0`でも各remote manifestを再downloadしてbyte一致を必須とし、1件でも欠落・不一致ならprimary failureとしてDriveを呼ばない。

### 4.3 download

```bash
make backup-s3-download
```

Sakura downloadは最新database keyからbundleを決定し、同じbundleのglobals、必須metadata、任意assetsを取得する。artifactとmanifestのSHA-256だけでなく、remote keyに含まれるenvironment / retention class / UTC date / bundle / artifact type / commit SHAとmanifest context、およびOpenPGP packetを照合する。検証成功後にだけBACKUP_DIRへ公開し、既存fileは上書きしない。

### 4.4 local manifest check

```bash
BACKUP_FILE="$PRIVATE_BACKUP_DIR/<artifact>" \
BACKUP_MANIFEST_FILE="$PRIVATE_BACKUP_DIR/<artifact>.manifest.json" \
make backup-s3-check
```

### 4.5 既存remote-host経路

`REMOTE_HOST` / `REMOTE_DIR`を指定した移行・検証用経路でも、database、globals、必須metadata、任意assetsをそれぞれのmanifest sidecarと対で転送する。downloadは最新artifactのbundle ID一致、manifestのenvironment / retention class / artifact type、SHA-256をprivate scratchで検証し、`.gpg`ではOpenPGP packetも確認してから`BACKUP_DIR`へ公開する。manifest欠落、世代混在、既存destinationがある場合はfail closedとし、旧来のmanifestなしremote backupは自動復元しない。

remote-host経路はSakura移行中のcopy-only sourceであり、Sakura object storeの実証を代替しない。廃止判断は#1981で行い、それまではsourceを削除しない。

### 4.6 Google Drive secondary copy

責任分界:

- Sakura S3-compatible object storageがprimaryであり、Driveだけのbackup成功状態は作らない。
- `backup-prod.sh backup|upload`はprimary artifactのHEAD検証と、全remote manifestの再download・byte一致を完了した後だけsecondary CLIを呼ぶ。`S3_VERIFY_DOWNLOAD=1`ではartifact本体も再downloadする。
- hourlyはVPS localとSakuraだけに保持し、Driveへ送らない。
- Driveへ送るのはOpenPGP暗号化済み`.gpg` artifactと対応manifestだけである。
- secondary failureはsanitized `partial_failure`をstderrへ残してnon-zero終了する。primary objectは自動削除しない。

Google側ではapplication file用とは別のOAuth client / refresh tokenと、backup専用Shared Drive folderを用意する。writer principalは専用folderに必要な最小権限だけを持ち、個人My Drive、domain-wide delegation、公開linkを使用しない。値はowner-only private envへ入力し、CLI引数、shell history、Issue、PRへ記載しない。

```bash
npm run build --prefix packages/backend
./scripts/backup-gdrive-secondary.sh check-config
```

標準backup/uploadは既存commandを使う。`BACKUP_SECONDARY_PROVIDER=gdrive`の場合、primary成功後に自動copyされる。

```bash
make backup-s3-backup
# または既存bundle
make backup-s3-upload
```

read-only inventory / freshness:

```bash
make backup-gdrive-list
make backup-gdrive-freshness
BACKUP_DIGEST='<sanitized SHA-256 selector>' make backup-gdrive-stat
```

summaryは世代数、最新時刻、fresh/stale/unknown、anomaly件数、object件数だけを返す。Drive quotaを取得できない場合は`unknown`とし、値を推測しない。file IDは`BACKUP_GDRIVE_STATE_DIR`（未指定時`BACKUP_DIR/.gdrive-state`）のmode 600 JSONだけへ記録する。

secondary uploadは1 writer hostに限定し、同一host上のtimer・手動実行を含む全processで同じ永続`BACKUP_GDRIVE_STATE_DIR`を使用する。hash化backup ID単位のexclusive lockを取得できない場合は、Driveへwriteせず`backup_google_drive_upload_in_progress`で停止する。複数hostまたは異なるstate directoryから同じbackup folderへuploadしてはならない。

異常終了後に`backup_google_drive_upload_in_progress`が継続する場合、lockを自動期限切れにしない。運用担当者はprivate host上で次を確認する。

1. 同一世代のsecondary CLI / backup timerが実行中でない。
2. primary bundleとmanifestが保持されている。
3. read-only inventoryで同一世代のcomplete / incomplete / duplicate状態を確認した。
4. 実行中processがないことを別担当者と確認後、`BACKUP_GDRIVE_STATE_DIR`内の該当hash lockだけを解除する。
5. incomplete / duplicateがある場合は再uploadせず、後述のpartial upload手順へ進む。objectが存在しない場合だけ同じbundleを再実行する。

lock名、backup digest、state JSON、Drive identifierはprivate evidenceとして扱い、Issue・PR・公開logへ転記しない。

Driveからの復元入力取得は、hash化backup selectorとowner-only出力先を使う。既存fileを上書きせず、全objectのSHA-256 / MD5 / size、manifest、OpenPGP packet、bundle整合を再検証してからhandoff JSONを作る。

```bash
install -d -m 700 "$PRIVATE_GDRIVE_DOWNLOAD_DIR"
BACKUP_DIGEST='<reviewed SHA-256 selector>' \
BACKUP_GDRIVE_DOWNLOAD_DIR="$PRIVATE_GDRIVE_DOWNLOAD_DIR" \
BACKUP_GDRIVE_HANDOFF_FILE="$PRIVATE_GDRIVE_DOWNLOAD_DIR/restore-handoff.json" \
make backup-gdrive-download
```

handoffの`BACKUP_FILE` / `BACKUP_GLOBALS_FILE` / `BACKUP_ASSETS_FILE`を確認し、実restoreは#544の隔離DB、人間承認、`RESTORE_CONFIRM=1`が揃った別工程で行う。download command自体はrestoreを実行しない。

retentionはdaily 30日、weekly 12週、monthly 13か月で、各classの最新1世代を必ず保護する。inventoryにduplicate、orphan manifest、0-byte、checksum mismatch、incomplete generationがあればapply不可となる。

```bash
make backup-gdrive-prune-plan
```

通常pruneはtrash-onlyであり、完全削除しない。apply/trash機能はrepo-sideで実装・fake検証するが、本作業では実行しない。実行には対象inventoryのprivate reviewと明示的人間承認に加え、`--apply` + `BACKUP_GDRIVE_PRUNE_CONFIRM=1`または`BACKUP_GDRIVE_TRASH_CONFIRM=1`が必要である。

token rotation / revoke:

1. backup専用principalとfolder membershipを確認する。
2. 新refresh tokenを承認済みsecret storeへ登録し、旧値を表示しない。
3. `check-config`、read-only list、syntheticな暗号化bundleのupload/downloadを対象環境で実証する。
4. timer/envをatomicに新tokenへ切り替える。
5. 旧tokenをGoogle側でrevokeし、旧tokenでauth failureになることをprivate logで確認する。
6. sanitizedな時刻、結果、commit SHAだけをevidenceへ記録する。

実Drive preflightの再開commandは、private env読込後の`./scripts/backup-gdrive-secondary.sh list`である。folder ID、file ID、OAuth token、raw API errorは証跡へ転記しない。

## 5. partial uploadの処理

artifact upload後、manifest upload前等で失敗するとorphanが残り得る。自動削除・上書きretryは行わない。

1. 実行を停止する。
2. private inventoryを取得する。
3. retention dry-runでincomplete bundleを確認する。
4. write権限者とは別のreviewerが対象とkey範囲を確認する。
5. 承認済みprovider手順でorphanを隔離または削除する。
6. 同じbackup IDを再利用せず、新しいUTC timestampでbundleを作り直す。

cleanup未承認の場合はblockedとして記録し、source backupを残す。

## 6. retention

### 6.1 dry-run plan

4 classのminimum generationsは必ず明示する。時間windowはhourly=48h、daily=30d、weekly=12週、monthly=13か月である。

```bash
mkdir -p -m 700 "$PRIVATE_PLAN_DIR"

PLAN_JSON="$PRIVATE_PLAN_DIR/retention-plan.json" \
PLAN_MARKDOWN="$PRIVATE_PLAN_DIR/retention-plan.md" \
make backup-s3-prune-plan

chmod 600 "$PRIVATE_PLAN_DIR/retention-plan.json" \
  "$PRIVATE_PLAN_DIR/retention-plan.md"
sha256sum "$PRIVATE_PLAN_DIR/retention-plan.json"
```

plan / resultにはobject keyとtarget fingerprintが含まれるため、scriptは`docs/`配下への出力を拒否する。`PRIVATE_PLAN_DIR`はrepositoryへcommitされないowner-only領域を指定する。

次の場合はapplyAllowed=falseになる。

- invalid / unsafe key
- incomplete upload
- orphan manifest
- required artifact pairの重複・欠落
- timestampとpath dateの不一致

### 6.2 apply（本repo-side作業では実行しない）

人間承認、排他的保守時間帯、reviewed SHAが揃った場合だけ別 invocationで実行する。

```bash
PRUNE_CONFIRM=1 \
RETENTION_EXCLUSIVE_LOCK_CONFIRM=1 \
RETENTION_PLAN_SHA256="<reviewed-plan-sha256>" \
PLAN_JSON="$PRIVATE_PLAN_DIR/retention-plan.json" \
RESULT_JSON="$PRIVATE_PLAN_DIR/retention-result.json" \
make backup-s3-prune-apply
```

remote inventoryがplan生成時から変化していれば拒否する。partial delete時はprotected result JSONを残して停止する。repository pruneはversioned objectの旧versionを物理削除しないため、provider lifecycleを別途確認する。

## 7. isolated restore（#544）

### 7.1 前提

- real readiness pass
- immutable commit SHA / app version / schema version固定
- isolated restore DBとscratch
- productionへ接続しないcredential
- restore approverとexecutor
- rollbackとcleanup手順
- RESTORE_CONFIRM=1の明示承認

### 7.2 実行順

1. backup
2. encrypted upload
3. verified download
4. OpenPGP decrypt
5. isolated DBへrestore
6. health / readiness
7. row counts / monetary totals / referential integrity / required files
8. sanitized evidence
9. decrypted scratch / plaintext cleanup

```bash
RESTORE_CONFIRM=1 ./scripts/backup-prod.sh restore
```

未指定時は`BACKUP_DIR`から最新の`*-db.dump[.gpg]`と
`*-globals.sql[.gpg]`を選択し、manifest sidecarは対象外にする。`.gpg` artifactの
復号先plaintextが既に存在する場合は上書きせず停止する。

このコマンドをproductionまたは用途不明DBへ実行しない。assets restore先がnon-emptyの場合はoverwrite riskを評価する。

### 7.3 evidence

templates:

- docs/test-results/backup-s3-readiness-template.md
- docs/test-results/backup-s3-restore-template.md

passにはdirect real readiness、write probe、backup/upload/download/restore log、整合性JSONが必要である。raw logとtarget identifierをrepositoryへcommitせず、private evidenceへのreferenceとsanitized summaryだけを残す。

## 8. Quadlet local backup

rootless Podman / Quadletのlocal DB backup:

```bash
./scripts/quadlet/backup-db.sh --print-prefix
./scripts/quadlet/check-db-backup.sh --max-age-hours 24 --print-prefix
./scripts/quadlet/list-db-backups.sh --limit 5 --print-prefix
```

local retention dry-run:

```bash
./scripts/quadlet/prune-db-backups.sh --keep-count 14 --keep-days 30 --dry-run
```

isolated restore:

```bash
RESTORE_CONFIRM=1 \
./scripts/quadlet/restore-db.sh \
  --backup-prefix "$PRIVATE_BACKUP_PREFIX"
```

共有WSL2 hostではservice restart、systemd有効化、Podman volume削除を行わない。live Sakura rehearsalは専用VPSまたはdedicated disposable WSL2で行う。

## 9. 停止条件と再開

停止:

- credential / target / operator approval不足
- isolated restore DB不足
- provider capabilityを推測する必要がある
- client-side encryptionを外す必要がある
- retention inventoryにunsafe / incomplete bundleがある
- source削除やprovider policy変更が必要

Issueへ記録する内容:

- 完了したrepo-side検証
- 未実施のreal operation
- 不足入力・承認
- secretを公開しない受渡方法
- exact resume command
- 再開時の最初のread-only確認
- closeできない理由

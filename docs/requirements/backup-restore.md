# バックアップ/リストア要件

## 対象範囲

- PostgreSQL database dump（必須）
- PostgreSQL globals（role / permission、必須）
- backup metadata（必須）
- local providerで保持するPDF・添付等のassets（存在する場合）
- 復元に必要な設定とsecretの参照情報（secret本体は別管理）

## 採用構成

Epic #1975では次を本番候補とする。

- 主DB backup: さくらのS3-compatible object storage
- client-side encryption: OpenPGP（Sakura profileでは必須）
- database backupの二次copy: Google Drive（#1979）
- application file: Google Drive（#1976 / #1977）
- 実bucket、credential、restore DBを用いる実証: #544
- copy-only migration / cutover / rollback rehearsal: #1981

AWS S3 / SSE-KMS profileは既存利用者の互換経路として維持する。provider差分はS3_PROVIDER=aws|sakuraで明示し、endpointやAPI応答から暗黙判定しない。custom endpointを指定する場合はprovider共通でcredentialを含まないHTTPS originを要求する。

S3 credentialはrepository sampleへ保存しない。AWS CLI標準credential chainを使い、Sakura専用の最小権限profileをowner-onlyのcredentials fileまたは承認済みprocess-level secret injectionから供給する。日常backup writerのput / get / list / head権限と、readiness probe / retention applyのdelete権限を分離する。AWS CLI debug output、署名付きrequest、credential valueをrepository evidenceへ含めない。

2026-07-22時点の公式仕様では、さくらのAmazon S3-compatible APIはList Objects、bucket location / versioning / ACL、HEAD / GET / PUT / DELETE Object等を列挙している。一方、全Amazon S3 APIの互換性は保証されない。実装は列挙済みAPIだけを共通checkに使用し、AWS Public Access Block / KMS等はSakuraへ推測適用しない。

- [さくらのオブジェクトストレージ API](https://manual.sakura.ad.jp/cloud/objectstorage/api.html)
- [さくらのオブジェクトストレージ FAQ](https://manual.sakura.ad.jp/cloud/objectstorage/faq.html)
- [さくらのオブジェクト暗号化](https://manual.sakura.ad.jp/cloud/objectstorage/encryption.html)

## 復旧目標

- 通常RPO: 最大24時間
- 重要データRPO: 最大1時間（取得scheduleで担保する）
- 通常RTO: 4時間以内
- 重要データRTO: 2時間以内
- 検知・対応開始: 30分以内を目標（RTO外）

実scheduleは#544の本番値決定で確定し、backup freshness監視は#1980で扱う。

## backup artifact契約

### bundle

1回のbackupは同一backup IDを持つbundleとして扱う。

必須:

- database: pg_dump -Fc
- globals: pg_dumpall --globals-only
- metadata: environment、timestamp、version情報

任意:

- assets: ASSET_DIRが設定され、対象が存在する場合

Sakura profileのbackup IDは次の情報を含む。

```text
<safe-prefix>-<YYYYMMDD>-<HHMMSS>-<commit-sha>
```

timestampはUTC、commit SHAは7〜64桁の16進数とする。archiveはimmutableとし、同じobject keyが存在する場合は上書きしない。

### object key

```text
<S3_PREFIX>/<retention-class>/<UTC date path>/<backup-id>/<artifact-kind>/<artifact-name>
<S3_PREFIX>/<retention-class>/<UTC date path>/<backup-id>/<artifact-kind>/<artifact-name>.manifest.json
```

date path:

- hourly: YYYY/MM/DD
- daily: YYYY/MM
- weekly: YYYY
- monthly: YYYY

artifact kind:

- database
- globals
- metadata
- assets（任意）

AWS profileは既存のdb / globals / assets key layoutを維持する。

### manifest

各artifactに一意のJSON manifestを生成する。schemaはerp4.backup.manifest.v1とし、最低限次を持つ。

- backup ID
- generatedAt（UTC）
- environment
- retention class
- artifact type / filename / source filename
- original size / encrypted artifact size
- encrypted artifact SHA-256
- encryption algorithm
- database name / DB version / schema version
- application version / commit SHA

downloadとcheckではartifact size、SHA-256、filename、必要に応じてbundle contextを検証する。manifestは独立署名していないため、bucket write権限者からのmetadata改ざん耐性はprovider側の権限分離・versioning・監査logで補う。

## 暗号化要件

### Sakura profile

- S3送信前にOpenPGP public-key encryptionを必須とする。
- .gpg拡張子だけを信用せず、GnuPG packet解析でpublic-key encrypted packetとencrypted data packetを確認する。
- GPG_RECIPIENTがない場合はuploadを拒否する。
- 復号private key、passphrase、recipientの実識別子をrepository、Issue、PR、logへ記載しない。
- server-side encryptionの有無だけに機密性を依存しない。

GPG_REMOVE_PLAINTEXT=1はverified upload完了後にだけlocal plaintextを削除する。失敗調査・再実行時は0として保持し、operatorがcleanup時点を判断する。復号済みrestore scratchも#544のisolated rehearsal後に明示的にcleanupする。

### AWS profile

既存のSSE-KMS / SSE-S3設定を維持する。SSE_KMS_KEY_ID、SSE_S3、KMS_ENDPOINT_URLはAWS profile専用であり、Sakura profileでは必須にしない。

## 設定契約

テンプレートはdocs/requirements/backup-restore.env.exampleを使用する。

共通必須:

- S3_PROVIDER=aws|sakura
- S3_BUCKET
- S3_PREFIX
- BACKUP_RETENTION_CLASS=hourly|daily|weekly|monthly
- ENVIRONMENT
- COMMIT_SHA

Sakura追加必須:

- credentialを含まないHTTPS originのS3_ENDPOINT_URL
- GPG_RECIPIENT
- DB_VERSION
- SCHEMA_VERSION
- APP_VERSION

endpointはuserinfo、query、fragment、非HTTPSを拒否する。prefix、backup ID、filenameはpath traversalとunsafe segmentを拒否する。

## 標準コマンド

private env fileはrepository外、current owner、mode 600、non-symlinkで作成し、shellへ値を表示しない。

```bash
set -a
. "$PRIVATE_BACKUP_ENV_FILE"
set +a
```

repo-side profile test:

```bash
make backup-s3-profile-test
```

backup / upload / verified download / manifest check:

```bash
make backup-s3-backup
make backup-s3-upload
make backup-s3-download
BACKUP_FILE="$PRIVATE_BACKUP_DIR/<artifact>" \
BACKUP_MANIFEST_FILE="$PRIVATE_BACKUP_DIR/<artifact>.manifest.json" \
make backup-s3-check
```

S3_VERIFY_DOWNLOAD=1ではupload直後にremote objectをprivate scratchへdownloadし、同じmanifestでSHA-256を再検証する。

さくら公式仕様ではwrite時のprovider側整合性checkはMD5とそれ以外で挙動が異なるため、#544のSakura実証ではS3_VERIFY_DOWNLOAD=1を必須とし、download後のmanifest SHA-256を最終判定にする。

## readiness

checkerは共通検査とprovider固有検査を分離する。

共通:

- endpoint / profile validation
- bucket access
- list
- optional write / head / get / delete round-trip
- size / checksum
- secretを含まないsummary

AWS:

- region
- versioning
- bucket encryption
- lifecycle
- Public Access Block
- KMS

Sakura:

- bucket location、versioning、bucket ACLは公式に列挙されたS3-compatible APIで確認する。
- AWS固有管理APIを呼ばない。
- provider管理APIを確認できない検査はnot_applicableと理由を出す。
- versioningのcontrol-plane表示、public access、access control、provider retentionはowner-onlyのS3_OPERATOR_EVIDENCE_FILEを要求する。
- real evidenceではCHECK_WRITE=1、S3_EXECUTION_MODE=real、S3_REAL_RUN_CONFIRM=1を必須とする。

```bash
S3_EXECUTION_MODE=real \
S3_REAL_RUN_CONFIRM=1 \
CHECK_WRITE=1 \
RUN_CHECK=1 \
FAIL_ON_CHECK=1 \
make backup-s3-readiness-record
```

fake runまたは既存logの取込みはrepo-side検証に限り、summaryStatus: blockedとして記録する。#544の実環境passにはdirect-check、real、writeProbe=1、realRunConfirmed=1が必要である。

## retention

保持window:

- hourly: 48時間
- daily: 30日
- weekly: 12週
- monthly: 13か月

4 classの最低保持世代数は環境ごとのoperator decisionであり、暗黙defaultを持たない。RETENTION_MIN_HOURLY / DAILY / WEEKLY / MONTHLYをすべてpositive integerで明示する。

dry-run planはremote inventoryを解析し、次をJSONとMarkdownへ出す。

- complete bundle
- incomplete upload / orphan manifest
- invalid / unsafe key
- cutoffより古いbundle
- minimum generationsで保護されるbundle
- delete bundle / object list
- inventory SHA-256
- provider / target fingerprint
- applyAllowed

invalid keyまたはincomplete bundleがあればapplyAllowed=falseとし、削除を拒否する。

```bash
PLAN_JSON="$PRIVATE_PLAN_DIR/retention-plan.json" \
PLAN_MARKDOWN="$PRIVATE_PLAN_DIR/retention-plan.md" \
make backup-s3-prune-plan
```

applyは自動では実行しない。別 invocationで次をすべて要求する。

- reviewed planのSHA-256
- PRUNE_CONFIRM=1
- RETENTION_EXCLUSIVE_LOCK_CONFIRM=1
- current ownerかつmode 600以下のplan
- remote inventory不変
- provider / target / prefix / minimums一致

provider側versioningで残るold object versionはrepository pruneでは物理削除しない。provider lifecycleと復旧要件をoperator evidenceで確認する。

readiness write probeはPUT応答のversion IDを取得し、versioning有効時はそのsynthetic versionだけを削除する。version IDを取得できない場合は自動でdelete markerを追加せず停止し、private inventoryでoperator cleanupを要求する。

## partial failureと再開

uploadはartifact、manifestの順にimmutable objectとして送る。remote existence checkとPUTは単一atomic操作ではないため、1環境1 writerを運用前提とし、同じbackup IDの並行uploadを禁止する。途中失敗時はorphanが残る可能性があり、自動削除や上書きretryは行わない。

再開前:

1. sanitized inventoryでartifact / manifest pairを確認する。
2. retention planでincomplete bundleとして検知されることを確認する。
3. credential、key、raw endpointを公開せず、operator承認のprivate手順でorphanを隔離または削除する。
4. 新しいUTC timestamp / backup IDでbundleを再生成する。

downloadはprivate scratchへartifactとmanifestを取得し、SHA-256、OpenPGP packet、remote keyとmanifestのenvironment / retention class / UTC date / bundle / artifact type / commit SHA contextを検証する。必須metadataが欠けたbundleを拒否し、検証成功後にのみBACKUP_DIRへ公開する。既存destinationは上書きしない。

## restore

restoreは破壊的操作であり、明示的人間承認、isolated DB、RESTORE_CONFIRM=1が必要である。本Issueのrepo-side作業では実restoreを行わない。

PoC:

```bash
./scripts/podman-poc.sh backup
RESTORE_CONFIRM=1 ./scripts/podman-poc.sh restore
./scripts/podman-poc.sh check
```

本番候補の#544では次を実証する。

1. real provider readinessとwrite/delete probe
2. backup
3. encrypted upload
4. verified download
5. isolated DBへのrestore
6. 件数、金額、参照整合性、必要file一致
7. plaintext / decrypted scratch cleanup
8. rollback経路

pass証跡は対象commit SHAとversionを固定し、private target identifierとraw logをGitHubへ載せない。未実施または入力不足はblockedとして#544をopenのままにする。

## 既存remote-host経路

REMOTE_HOST / REMOTE_DIRによる別host退避は移行・検証用の既存経路として維持する。Sakura cutover後の廃止時期は#1981で決め、copy-only期間を経ずにsourceを削除しない。

## セキュリティ上の禁止事項

- production credentialをfixtureへ含めない。
- access key、secret key、private endpoint、bucket実識別子、GPG private keyをlogやGitHubへ出さない。
- real prune apply、restore、provider policy変更を自動実行しない。
- fake upload/download/restoreを実環境成功として記録しない。
- backup sourceやsource fileを人間承認なしに削除しない。

## 関連文書

- operator Runbook: docs/ops/backup-restore.md
- decision checklist: docs/ops/backup-s3-decision-checklist.md
- readiness template: docs/test-results/backup-s3-readiness-template.md
- restore template: docs/test-results/backup-s3-restore-template.md
- DR plan: docs/ops/dr-plan.md
- Sakura deployment: docs/ops/sakura-vps-deployment.md

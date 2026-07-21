# Backup S3-compatible storage 設定決定シート

目的:

- #544 で確定する本番値、責任分界、復元条件を1枚で確認する。
- S3_PROVIDER=sakura|aws の差分を明示し、AWS固有APIをSakuraへ推測適用しない。
- 実バケット名、private endpoint、credential、鍵識別子はこのリポジトリへ記載しない。確定値を含む版はアクセス制御された運用記録として保管し、GitHubにはsanitized summaryとfingerprintだけを残す。

## 基本情報

- decisionDate: YYYY-MM-DD
- environment: prod|staging
- owner: <role-or-team>
- reviewers: <role-or-team>
- relatedIssue: #544
- provider: sakura|aws
- evidenceClassification: private-operator-record|sanitized-repository-summary

## 保存先とbundle契約

- bucketName: <private operator record only>
- endpointSource: <approved secret/config resource reference; Sakura only>
- region: <provider value or n/a>
- s3Prefix: <environment-specific prefix>
- targetFingerprint: <SHA-256 of provider/endpoint/region/bucket; sanitized summary only>
- bundleLayout: <prefix>/<environment>/<retention-class>/<UTC path>/<backup-id>/<artifact-kind>/
- overwritePolicy: immutable
- requiredArtifactKinds: database,globals,metadata
- optionalArtifactKinds: assets
- manifestSchema: erp4.backup.manifest.v1
- postUploadDownloadVerification: required-for-sakura

## 暗号化と鍵管理

- encryptionMode: GPG|SSE-KMS|SSE-S3
- clientSideEncryption: OpenPGP|required-for-sakura
- gpgRecipientReference: <secret-manager or controlled key-catalog reference>
- gpgDecryptCustodian: <role-or-team>
- gpgRecoveryApprover: <role-or-team>
- kmsKeyIdOrAlias: <private reference or n/a>
- plaintextLocalPolicy: <remove-after-verified-copy|controlled-recovery-retention>
- manifestAuthenticityControl: <bucket-writer trust and audit control; manifest is not independently signed>

Sakura profileではencryptionMode: GPGとし、AWS KMSを必須にしない。AWS profileの既存SSE-KMS/SSE-S3契約は維持する。

## 保持・公開遮断・provider側設定

- versioning: <reviewed state>
- publicAccessBlock: <reviewed state>
- accessControl: <reviewed state>
- providerRetention: <reviewed state>
- retentionHourlyHours: 48
- retentionDailyDays: 30
- retentionWeeklyWeeks: 12
- retentionMonthlyMonths: 13
- minimumHourlyGenerations: <positive integer>
- minimumDailyGenerations: <positive integer>
- minimumWeeklyGenerations: <positive integer>
- minimumMonthlyGenerations: <positive integer>
- lifecycleDailyDays: 30
- lifecycleWeeklyWeeks: 12
- lifecycleMonthlyMonths: 13
- oldVersionDisposition: <provider lifecycle/operator procedure; repository prune does not delete old versions>
- operatorEvidenceFile: <private mode-600 file outside repository>

Sakuraでは公式に列挙されたS3-compatible APIでbucket location、versioning、bucket ACLを直接確認する。AWS Public Access Block / KMS / lifecycle等を推測適用せず、確認できない項目はnot_applicableと理由を記録する。provider console等で確認した次の4項目をoperator evidenceへ記録する。

```text
versioningStatus=<reviewed-state>
publicAccessStatus=<reviewed-state>
accessControlStatus=<reviewed-state>
retentionStatus=<reviewed-state>
```

## 権限・監査・責任分界

- writeRoleArn: <role/principal reference or n/a>
- readRoleArn: <role/principal reference or n/a>
- restoreRoleArn: <role/principal reference or n/a>
- automationPrincipal: <private principal reference>
- allowedNetworkBoundary: <approved restriction or n/a>
- auditLogLocation: <controlled evidence resource reference>
- restoreApprover: <role-or-team>
- restoreExecutor: <role-or-team>
- incidentEscalation: <role-or-team>
- evidenceRecordPath: <private evidence path and sanitized repository summary path>

## 事前検証コマンド

private env fileはリポジトリ外、current owner、mode 600、non-symlinkで用意する。

```bash
set -a
. "$PRIVATE_BACKUP_ENV_FILE"
set +a

make backup-s3-profile-test

S3_EXECUTION_MODE=real \
S3_REAL_RUN_CONFIRM=1 \
CHECK_WRITE=1 \
RUN_CHECK=1 \
FAIL_ON_CHECK=1 \
make backup-s3-readiness-record
```

passに必要な条件:

- checkerを同一プロセスで直接実行したevidenceBasis: direct-check
- executionMode: real
- realRunConfirmed: 1
- writeProbe: 1
- summaryStatus: pass
- Sakuraではowner-onlyのS3_OPERATOR_EVIDENCE_FILE
- raw logにcredential、endpoint、bucket、object key、鍵識別子を残さないこと

fake実行または外部sanitized logの取込みはblocked記録にしかならず、#544の成功証跡に使わない。

## retention計画と適用

計画は常に先に生成し、privateな場所で内容とSHA-256を確認する。

```bash
PLAN_JSON="$PRIVATE_PLAN_DIR/retention-plan.json" \
PLAN_MARKDOWN="$PRIVATE_PLAN_DIR/retention-plan.md" \
make backup-s3-prune-plan
```

applyは、remote inventoryが不変、planがmode 600以下、4 classの最低世代数が一致、排他的な保守時間帯が確保済みの場合に限る。

```bash
PRUNE_CONFIRM=1 \
RETENTION_EXCLUSIVE_LOCK_CONFIRM=1 \
RETENTION_PLAN_SHA256="<reviewed-plan-sha256>" \
PLAN_JSON="$PRIVATE_PLAN_DIR/retention-plan.json" \
RESULT_JSON="$PRIVATE_PLAN_DIR/retention-result.json" \
make backup-s3-prune-apply
```

本リポジトリ作業ではapplyを実行しない。実適用には別途人間承認が必要であり、versioningされた旧世代の物理削除はprovider側保持設定として確認する。

## #544で確認する実証跡

- summaryStatus: pass|blocked|failed
- executionMode: real
- writeProbe: 1
- realRunConfirmed: 1
- evidenceBasis: direct-check
- backup / upload / verified download / isolated restore の各sanitized log
- artifactとmanifestのSHA-256一致
- restore後の件数、金額、参照整合性、必要ファイル一致
- 対象commit SHA、app/schema/DB version
- rollback手順と実施責任者
- plaintextと復号済みscratchのcleanup確認
- 実環境入力が不足する場合のblocker、再開コマンド、最初の確認

## 未解決メモ

-

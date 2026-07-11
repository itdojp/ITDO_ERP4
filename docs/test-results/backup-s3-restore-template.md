# S3 backup/restore 実証跡テンプレート

- 実施日: YYYY-MM-DD
- 実施者:
- 対象Issue: #544, #1875
- 対象環境:
- restoreStatus: `blocked|failed|pass`
- s3Bucket:
- s3Region:
- s3Prefix:
- encryptionMode: `SSE-KMS|SSE-S3`
- kmsKeyId:
- decisionRecordFile:
- readinessRecordFile:
- backupLogFile:
- uploadLogFile:
- downloadLogFile:
- restoreLogFile:
- integrityReportJson:

## 生成コマンド

S3設定決定シートと readiness 記録を確定したあと、実際の `backup -> upload -> download -> restore` と復元後整合性の証跡ファイルを指定して実行する。

```bash
TARGET_ENVIRONMENT=prod \
OPERATOR=alice \
RESTORE_STATUS=pass \
S3_BUCKET=erp4-backups \
S3_REGION=ap-northeast-1 \
S3_PREFIX=erp4/prod \
ENCRYPTION_MODE=SSE-KMS \
KMS_KEY_ID=alias/erp4-backup \
DECISION_RECORD_FILE=docs/ops/backup-s3-decision-checklist.md \
READINESS_RECORD_FILE=docs/test-results/YYYY-MM-DD-backup-s3-readiness-rN.md \
BACKUP_LOG_FILE=tmp/backup-prod/backup.log \
UPLOAD_LOG_FILE=tmp/backup-prod/upload.log \
DOWNLOAD_LOG_FILE=tmp/backup-prod/download.log \
RESTORE_LOG_FILE=tmp/backup-prod/restore.log \
INTEGRITY_REPORT_JSON=tmp/backup-prod/post-restore-integrity.json \
make backup-s3-restore-record
```

## pass 記録の必須条件

`RESTORE_STATUS=pass` の record は、script 側で以下を強制する。

- `TARGET_ENVIRONMENT` と `OPERATOR` が空ではない
- `S3_BUCKET` / `S3_REGION` / `S3_PREFIX` / `ENCRYPTION_MODE` が設定されている
- `ENCRYPTION_MODE=SSE-KMS` の場合は `KMS_KEY_ID` が設定されている
- `ENCRYPTION_MODE=SSE-S3` の場合は decision record の `kmsKeyIdOrAlias` が明示的に `n/a` である
- `DECISION_RECORD_FILE` に bucket / region / prefix / encryption / lifecycle / IAM / restore責任者 / 証跡パスの必須フィールドが確定値で記録されている
- `DECISION_RECORD_FILE` の environment / bucket / region / prefix / encryption / KMS key（SSE-KMS時）が、実行時に指定した値と一致している
- `READINESS_RECORD_FILE` が `summaryStatus: pass` で、`CHECK_WRITE=1` の write/delete probe を含む
- `BACKUP_LOG_FILE` / `UPLOAD_LOG_FILE` / `DOWNLOAD_LOG_FILE` / `RESTORE_LOG_FILE` が存在し空ではない
- `INTEGRITY_REPORT_JSON` で以下がすべて true または pass である
  - `countsMatch`
  - `amountsMatch`
  - `referencesMatch`
  - `filesMatch`

## 復元後整合性 JSON 例

```json
{
  "countsMatch": true,
  "amountsMatch": true,
  "referencesMatch": true,
  "filesMatch": true
}
```

## 判定

- `pass`: S3確定値、write probe、backup/upload/download/restore、復元後整合性がすべて揃った状態。
- `failed`: 実施したが、S3設定、転送、restore、整合性のいずれかが失敗した状態。
- `blocked`: AWS権限、bucket/KMS確定値、検証DB、復元承認、データ準備などが不足し、実施未完了の状態。

`blocked` または `failed` の場合は #544 を close しない。

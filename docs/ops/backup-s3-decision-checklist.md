# Backup S3 設定決定シート

目的:

- `#544` の未確定項目を 1 枚で埋め、`docs/requirements/backup-restore.md` の暫定値を確定値へ置き換える。
- S3 readiness 検証 (`make backup-s3-readiness-check` / `make backup-s3-readiness-record`) の前提値を明確にする。

## 基本情報

- decisionDate: YYYY-MM-DD
- environment: prod|staging
- owner: `<name>`
- reviewers: `<name1>, <name2>`
- relatedIssue: `#544`

## 確定値

- AWS account / project:
- bucketName:
- region:
- s3Prefix:
- encryptionMode: SSE-KMS|SSE-S3
- kmsKeyIdOrAlias:
- kmsKeyAdmin:
- kmsKeyUsagePrincipals:
- versioning: Enabled|Suspended
- lifecycleDailyDays:
- lifecycleWeeklyWeeks:
- lifecycleMonthlyMonths:
- replication / secondary copy:
- publicAccessBlock: enabled|disabled

## IAM / バケットポリシー

- writeRoleArn:
- readRoleArn:
- restoreRoleArn:
- CI / automation principal:
- allowedNetworkBoundary: VPC endpoint|IP allowlist|none
- bucketPolicyNotes:

## 監査 / 責任分界

- restoreApprover:
- restoreExecutor:
- auditLogLocation:
- evidenceRecordPath: `docs/test-results/YYYY-MM-DD-backup-s3-readiness-rN.md`
- incidentEscalation:

## 検証コマンド

```bash
S3_BUCKET=... S3_REGION=... EXPECT_SSE=aws:kms SSE_KMS_KEY_ID=... \
  make backup-s3-readiness-check
```

```bash
RUN_CHECK=1 FAIL_ON_CHECK=1 \
S3_BUCKET=... S3_REGION=... EXPECT_SSE=aws:kms SSE_KMS_KEY_ID=... \
  make backup-s3-readiness-record
```

## 確認結果

- summaryStatus: pass|warn|fail
- summarySource: summary-line|legacy-log-scan
- warningCount:
- errorCount:
- checkExitCode:
- followUpRequired: yes|no

## 未解決メモ

-

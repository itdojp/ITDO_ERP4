# S3バックアップ Readiness 記録テンプレート

- executedAt: YYYY-MM-DDTHH:MM:SSZ
- environment: prod|staging|poc
- branch: `<branch>`
- commit: `<short-sha>`
- operator: `<name>`

## 入力値
- S3_BUCKET:
- S3_REGION:
- EXPECT_SSE: aws:kms|AES256|any
- SSE_KMS_KEY_ID:
- CHECK_WRITE: 0|1
- STRICT: 0|1
- DATE_STAMP: YYYY-MM-DD
- RUN_LABEL: r1|r2|...（任意。未指定時は r1, r2, ... を自動採番）

## 実行コマンド
```bash
S3_BUCKET=... S3_REGION=... EXPECT_SSE=... SSE_KMS_KEY_ID=... CHECK_WRITE=... \
  make backup-s3-readiness-check
```

```bash
# 検証実行 + 記録を一度に実施
RUN_CHECK=1 FAIL_ON_CHECK=1 \
S3_BUCKET=... S3_REGION=... EXPECT_SSE=... SSE_KMS_KEY_ID=... CHECK_WRITE=... \
  make backup-s3-readiness-record
```

## 判定
- result: pass|warn|fail
- summarySource: summary-line|legacy-log-scan
- warningCount:
- errorCount:
- checkExitCode:

## ログ（抜粋）
```text
<check-backup-s3-readiness output>
# 末尾の機械可読行（実装）
# [backup-s3-preflight] SUMMARY status=... warning_count=... error_count=... strict=... check_write=...
```

## 対応メモ
- 

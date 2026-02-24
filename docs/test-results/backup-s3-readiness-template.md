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

## 実行コマンド
```bash
S3_BUCKET=... S3_REGION=... EXPECT_SSE=... SSE_KMS_KEY_ID=... CHECK_WRITE=... \
  make backup-s3-readiness-check
```

## 判定
- result: pass|warn|fail
- warningCount:
- errorCount:

## ログ（抜粋）
```text
<check-backup-s3-readiness output>
```

## 対応メモ
- 

# Production Readiness external evidence runbook

関連Issue: `#1875`, `#1426`, `#544`, `#1432`

## 目的

`#1875` の repo-side readiness は `make release-readiness-record` で確認する。一方、Go 判定には対象環境・外部サービス・外部製品 artifact に依存する以下の証跡が必要であり、repo-side runner の成功だけでは完了扱いにしない。

- `#1426`: ActionPolicy `phase3_strict` の対象環境 trial / cutover / rollback
- `#544`: S3 の確定値と実 backup → upload → download → restore / 復元後整合性
- `#1432`: 給与らくだ・経理上手くんαの現物CSVテンプレート、サンプル、取込条件資料

この runbook は、3 つの外部証跡を `docs/test-results/` に集約し、`#1875` を閉じられる状態かを機械判定するための手順を定義する。

## 実行順

### 1. repo-side readiness の対象 commit を固定する

```bash
git fetch origin main
# clean checkout / worktree で実施する
RELEASE_E2E_SCOPE=full make release-readiness-record
```

生成された `docs/test-results/YYYY-MM-DD-release-readiness-rN.md` の `Repo-side readiness` が `PASS` であることを確認する。ただし、この時点の `Overall Go/No-Go` は外部証跡が揃うまで `NO-GO` のままとする。

### 2. #1426 ActionPolicy target trial 証跡を生成する

対象環境で readiness / cutover / rollback を実施し、主要操作結果と fallback report を保存したうえで実行する。

```bash
TARGET_ENVIRONMENT=prod \
OPERATOR=<operator> \
TRIAL_STATUS=pass \
CUTOVER_AT=<YYYY-MM-DDTHH:MM:SSZ> \
READINESS_RECORD_FILE=docs/test-results/<date>-action-policy-phase3-readiness-rN.md \
CUTOVER_RECORD_FILE=docs/test-results/<date>-action-policy-phase3-cutover-rN.md \
OPERATION_RESULTS_FILE=docs/test-results/<date>-action-policy-phase3-target-ops-rN.md \
POST_FALLBACK_REPORT_JSON=tmp/action-policy-phase3-target/post-fallback.json \
ROLLBACK_STATUS=verified \
ROLLBACK_AT=<YYYY-MM-DDTHH:MM:SSZ> \
ROLLBACK_FALLBACK_REPORT_JSON=tmp/action-policy-phase3-target/rollback-fallback.json \
make action-policy-phase3-target-trial-record
```

完了条件:

- 生成ファイル名が `docs/test-results/YYYY-MM-DD-action-policy-phase3-target-trial-rN.md` または `...-<RUN_LABEL>.md`
- `trialStatus: pass`
- `## #1426 completion gate` の全項目が checked

### 3. #544 S3 backup/restore 証跡を生成する

S3 decision record と readiness record を確定し、実際の backup / upload / download / restore と復元後整合性チェックを実行したうえで記録する。

```bash
TARGET_ENVIRONMENT=prod \
OPERATOR=<operator> \
RESTORE_STATUS=pass \
S3_BUCKET=<bucket> \
S3_REGION=<region> \
S3_PREFIX=<prefix> \
ENCRYPTION_MODE=SSE-KMS \
KMS_KEY_ID=<kms-key-or-alias> \
DECISION_RECORD_FILE=docs/ops/backup-s3-decision-checklist.md \
READINESS_RECORD_FILE=docs/test-results/<date>-backup-s3-readiness-rN.md \
BACKUP_LOG_FILE=tmp/backup-prod/backup.log \
UPLOAD_LOG_FILE=tmp/backup-prod/upload.log \
DOWNLOAD_LOG_FILE=tmp/backup-prod/download.log \
RESTORE_LOG_FILE=tmp/backup-prod/restore.log \
INTEGRITY_REPORT_JSON=tmp/backup-prod/post-restore-integrity.json \
make backup-s3-restore-record
```

完了条件:

- 生成ファイル名が `docs/test-results/YYYY-MM-DD-backup-s3-restore-rN.md` または `...-<RUN_LABEL>.md`
- `restoreStatus: pass`
- `## #544 / #1875 completion gate` の全項目が checked

### 4. #1432 外部CSV artifact intake 証跡を生成する

現物 artifact を受領し、必要な sample はマスキングして repo に追加する。raw 原本は repo 外の安全な保管先に置き、sha256 と保管参照を manifest に記録する。

```bash
cp docs/requirements/external-csv-artifact-intake-manifest.template.json \
  docs/requirements/external-csv-artifact-intake-manifest.json
# manifest を実受領内容で更新する
INTAKE_STATUS=pass \
OPERATOR=<operator> \
MANIFEST_FILE=docs/requirements/external-csv-artifact-intake-manifest.json \
make external-csv-artifact-intake-record
```

完了条件:

- 生成ファイル名が `docs/test-results/YYYY-MM-DD-external-csv-artifact-intake-rN.md` または `...-<RUN_LABEL>.md`
- `intakeStatus: pass`
- `## #1432 completion gate` の全項目が checked
- `canonical_sample` / header-only だけを完了証跡として扱っていない

### 5. #1875 external Go evidence を機械判定する

3 証跡が揃ったあとに実行する。

```bash
make production-readiness-external-evidence-check
# JSON が必要な場合
node scripts/check-production-readiness-external-evidence.mjs --json
```

`overallStatus: PASS` になった場合のみ、`#1875` の外部依存が証跡上は完了したと判断できる。`MISSING` または `INCOMPLETE` が残る場合、該当 Issue は close しない。

## #1875 を close する前の確認

- [ ] `docs/test-results/YYYY-MM-DD-release-readiness-rN.md` が `Repo-side readiness: PASS`
- [ ] `make production-readiness-external-evidence-check` が exit code `0`
- [ ] #1426 / #544 / #1432 の各 Issue に生成証跡へのリンクがある
- [ ] GitHub Actions required checks / Link Check / CodeQL が対象 commit で成功している
- [ ] Go/No-Go 判定コメントに release readiness 証跡と external evidence check 結果を集約している

## No-Go 条件

以下のいずれかが残る場合は、`#1875` を close しない。

- target environment、AWS/S3、または外部CSV artifact が未提供
- `pass` 以外の status の証跡しかない
- completion gate に unchecked 項目がある
- 証跡が `docs/test-results/` に存在しない、または PR から参照できない
- GitHub Actions required checks が失敗、未実行、または対象 commit と異なる

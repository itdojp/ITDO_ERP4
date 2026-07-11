# バックアップ/リストア（Runbook）

## 入口

詳細は `docs/requirements/backup-restore.md` を参照。
DR計画（RTO/RPO/復元演習）は `docs/ops/dr-plan.md` を参照。
S3 の確定値は `docs/ops/backup-s3-decision-checklist.md` に記録する。
S3 の実 backup / upload / download / restore を #544 / #1875 の Go 判定証跡として残す場合は `make backup-s3-restore-record` を使用する。
release 判定へ流用する backup/restore 証跡を新規作成する場合は `docs/test-results/release-backup-evidence-template.md` を利用する。

## PoC/検証（Podman DB）

`scripts/podman-poc.sh` にバックアップ/リストア手順が実装済み。

```bash
./scripts/podman-poc.sh backup
RESTORE_CONFIRM=1 ./scripts/podman-poc.sh restore
```

注意:

- リストアは破壊的操作になり得るため `RESTORE_CONFIRM=1` が必要
- 必要に応じて `RESTORE_CLEAN=1` でスキーマの作り直しを行う

### 復元後の最小確認

1. backend の `/healthz` と `/readyz` を確認する
2. `./scripts/podman-poc.sh check` を実行し、主要件数と整合性を確認する
3. 主要 API / 主要導線のスモークを実施する
4. 実行ログ、バックアップファイル名、確認結果を `docs/test-results/` に記録する

### 記録先

- DR/復元演習の記録は `docs/test-results/dr-restore-template.md` を起点に残す
- release 判定の証跡に流用する場合は `docs/test-results/release-backup-evidence-template.md` も併記する
- S3 の実 backup / upload / download / restore と復元後整合性を 1 件の証跡へ束ねる場合は `docs/test-results/backup-s3-restore-template.md` を起点にし、`make backup-s3-restore-record` で生成する

## Quadlet PostgreSQL backup/restore

手動 DB backup:

```bash
./scripts/quadlet/backup-db.sh --print-prefix
```

生成物:

- `erp4-postgres-<timestamp>.dump`
- `erp4-postgres-<timestamp>-globals.sql`

成功条件:

- `OK: db backup created: ...` が出力される
- globals を有効化している場合は `OK: globals backup created: ...` も出力される

証跡は `docs/test-results/db-backup-health-template.md` を利用して記録する。

最新 backup の確認:

```bash
./scripts/quadlet/restore-db-latest.sh --print-prefix
```

指定 prefix から restore:

```bash
RESTORE_CONFIRM=1 ./scripts/quadlet/restore-db.sh --backup-prefix /path/to/erp4-postgres-<timestamp>
```

最新 backup から restore:

```bash
RESTORE_CONFIRM=1 ./scripts/quadlet/restore-db-latest.sh --clean-public-schema
```

補足:

- 最新 backup の選択基準は `.dump` ファイルの mtime 降順
- globals を復元しない場合は `--skip-globals` を付与
- `restore-db.sh` / `restore-db-latest.sh` は `erp4-postgres.env` を参照し、既定では `erp4-postgres` コンテナへ `pg_restore` / `psql` を実行する

## S3 backup/restore のGo判定証跡

#544 / #1875 の Go 判定では、readiness だけでなく、実際の `backup -> upload -> download -> restore` と復元後整合性まで確認した証跡が必要です。

前提:

- `docs/ops/backup-s3-decision-checklist.md` に bucket / region / prefix / encryption / lifecycle / IAM / restore 承認者・実行者 / 証跡パスが確定値で記録されている。`ENCRYPTION_MODE=SSE-S3` の場合も `kmsKeyIdOrAlias: n/a` を明示する
- `make backup-s3-readiness-record` の結果が `summaryStatus: pass` で、`CHECK_WRITE=1` の write/delete probe を含む
- backup / upload / download / restore の実行ログが保存されている
- 復元後の件数、金額、参照整合性、必要ファイルの一致を JSON で記録している

証跡生成:

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

`RESTORE_STATUS=pass` では script が未確定 decision field、指定値と decision record の不一致、readiness 不足、write probe 不足、ログ不足、復元後整合性不一致を拒否する。対象環境・AWS権限・復元承認・検証DBなどが不足する場合は `blocked` として記録し、#544 は close しない。

### 日次運用で使う補助コマンド

この Runbook では日次運用で使う代表コマンドだけを示し、詳細 option は各 helper の `--help` を優先する。

最新 backup を作成して直後に検証する場合:

```bash
./scripts/quadlet/backup-db-and-check.sh --max-age-hours 24 --print-prefix
```

最新 backup の鮮度確認だけ行う場合:

```bash
./scripts/quadlet/check-db-backup.sh --max-age-hours 24 --print-prefix
```

直近の backup 一覧を確認する場合:

```bash
./scripts/quadlet/list-db-backups.sh --limit 5 --print-prefix
```

古い backup を整理する場合（まず dry-run）:

```bash
./scripts/quadlet/prune-db-backups.sh --keep-count 14 --keep-days 30 --dry-run
```

世代整理時の注意:

- `prune-db-backups.sh` は対象の `.dump` と対応する `-globals.sql` を同時に削除する
- `--keep-count` と `--keep-days` はどちらか一方でも使えるが、併用して保持条件を広めに取る方が安全

## さくらVPS / Quadlet（PostgreSQL container）

`erp4-postgres` を rootless Podman + Quadlet で運用している場合は、manual backup helper を使います。

```bash
./scripts/quadlet/backup-db.sh --print-prefix
```

前提:

- `~/.config/containers/systemd/erp4-postgres.env` に `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` があること
- `erp4-postgres` container が起動済みであること

既定の出力先:

- `~/.local/share/erp4/db-backups/erp4-postgres-<UTC timestamp>.dump`
- `~/.local/share/erp4/db-backups/erp4-postgres-<UTC timestamp>-globals.sql`

主な option:

- `--target-dir DIR`: Quadlet env 配置先を切り替える
- `--env-file PATH`: PostgreSQL env file を直接指定する
- `--backup-dir DIR`: 出力先を切り替える
- `--container NAME`: PostgreSQL container 名を切り替える
- `--skip-globals`: `pg_dumpall --globals-only` を省略する
- `--print-prefix`: 生成した backup prefix を標準出力へ返す

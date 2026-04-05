# バックアップ/リストア（Runbook）

## 入口

詳細は `docs/requirements/backup-restore.md` を参照。
DR計画（RTO/RPO/復元演習）は `docs/ops/dr-plan.md` を参照。
S3 の確定値は `docs/ops/backup-s3-decision-checklist.md` に記録する。
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

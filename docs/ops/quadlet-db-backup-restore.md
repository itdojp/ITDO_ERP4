# Quadlet DB バックアップ/リストア（補助 Runbook）

`scripts/quadlet/backup-db.sh` / `restore-db.sh` / `list-db-backups.sh` は、Quadlet で運用している PostgreSQL コンテナ向けの manual helper です。ここでは日次運用で使う最小手順だけを整理します。

## 対象
- PostgreSQL container: `erp4-postgres`
- env file: `~/.config/containers/systemd/erp4-postgres.env`
- backup dir: `~/.local/share/erp4/db-backups`

## 一覧確認
最新 dump を含む backup 一覧は次で確認します。

```bash
./scripts/quadlet/list-db-backups.sh
```

出力列:
- mtime
- dump size
- globals dump 同梱有無 (`yes` / `no`)
- dump path

主な option:
- `--latest`: 最新 dump だけ出力
- `--limit N`: 新しい N 件だけ表示
- `--print-prefix`: `.dump` を除いた backup prefix を表示

## 手動 backup
```bash
./scripts/quadlet/backup-db.sh --print-prefix
```

## 最新 backup の健全性確認
最新 DB backup と globals dump の組を確認する場合は次を使います。

```bash
./scripts/quadlet/check-db-backup.sh --max-age-hours 24 --print-prefix
```

latest dump のみ確認し、globals dump を必須にしない場合:

```bash
./scripts/quadlet/check-db-backup.sh --skip-globals --max-age-hours 24
```

globals dump を作らない場合:
```bash
./scripts/quadlet/backup-db.sh --skip-globals --print-prefix
```

## 古い DB backup の整理
手動で古い DB backup を整理する場合は次を使います。

```bash
./scripts/quadlet/prune-db-backups.sh --keep-count 14 --keep-days 30 --dry-run
```

確認後に実削除する場合:

```bash
./scripts/quadlet/prune-db-backups.sh --keep-count 14 --keep-days 30
```

`*.dump` を削除する場合は、対応する `-globals.sql` も一緒に削除します。

## 最新 backup からの restore
```bash
latest_prefix="$(./scripts/quadlet/list-db-backups.sh --latest --print-prefix)"
RESTORE_CONFIRM=1 ./scripts/quadlet/restore-db.sh --backup-prefix "$latest_prefix"
```

public schema を作り直してから restore する場合:
```bash
latest_prefix="$(./scripts/quadlet/list-db-backups.sh --latest --print-prefix)"
RESTORE_CONFIRM=1 ./scripts/quadlet/restore-db.sh --backup-prefix "$latest_prefix" --clean-public-schema
```

## 注意
- restore は破壊的操作になり得るため `RESTORE_CONFIRM=1` が必須です。
- globals dump にはロール/権限や機微情報が含まれる可能性があるため、backup dir は `0700` などの厳しい権限で扱います。
- 詳細なバックアップ/リストア方針は `docs/ops/backup-restore.md` と `docs/ops/dr-plan.md` を参照してください。

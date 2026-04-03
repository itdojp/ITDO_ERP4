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

globals dump を作らない場合:
```bash
./scripts/quadlet/backup-db.sh --skip-globals --print-prefix
```

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

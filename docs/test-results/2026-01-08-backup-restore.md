# テスト結果 2026-01-08 バックアップ/リストア

## 実行日時
- 2026-01-08

## 実行方法
- 対象コンテナ: `erp4-pg-backup-20260108`（`HOST_PORT=55434`）
- バックアップ先: `tmp/erp4-backups-20260108`
- 実行コマンド:
  - `CONTAINER_NAME=erp4-pg-backup-20260108 HOST_PORT=55434 scripts/podman-poc.sh db-push`
  - `CONTAINER_NAME=erp4-pg-backup-20260108 HOST_PORT=55434 scripts/podman-poc.sh seed`
  - `CONTAINER_NAME=erp4-pg-backup-20260108 HOST_PORT=55434 scripts/podman-poc.sh check`
  - `CONTAINER_NAME=erp4-pg-backup-20260108 HOST_PORT=55434 BACKUP_DIR=tmp/erp4-backups-20260108 scripts/podman-poc.sh backup`
  - `CONTAINER_NAME=erp4-pg-backup-20260108 HOST_PORT=55434 BACKUP_DIR=tmp/erp4-backups-20260108 BACKUP_GLOBALS_FILE=/dev/null RESTORE_CONFIRM=1 scripts/podman-poc.sh restore`
  - `CONTAINER_NAME=erp4-pg-backup-20260108 HOST_PORT=55434 scripts/podman-poc.sh check`

## 結果
- バックアップ: 成功
- リストア: 成功（fresh container + globalsスキップで実施）
- 整合チェック: 成功

## 補足
- globals には `postgres` ロール作成が含まれるため、既存ロールがある環境では restore が失敗する。
- 既存スキーマがある状態で restore すると型の重複で失敗するため、クリーンなDBで実施する。

## ログ
- `tmp/backup-restore-2026-01-08.txt`

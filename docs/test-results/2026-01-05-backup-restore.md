# バックアップ/リストア検証（2026-01-05）

## 目的
- 検証環境で backup-prod.sh のバックアップ/リストアが動作することを確認する。
- 既存ロールがある環境で globals 復元が失敗するケースを回避する。

## 実施環境
- Podman: erp4-pg-poc
- スクリプト: scripts/backup-prod.sh

## 手順
1. 検証用DBを作成し、テストデータを投入
2. `backup-prod.sh backup` を実行してバックアップ取得
3. データを追加し、差分を作る
4. `backup-prod.sh restore` を実行（`SKIP_GLOBALS=1`）
5. 追加データが消えていることを確認

## 実行コマンド（抜粋）
```bash
podman exec -e PGPASSWORD=postgres erp4-pg-poc createdb -U postgres backup_restore_test
podman exec -e PGPASSWORD=postgres erp4-pg-poc psql -U postgres -d backup_restore_test \
  -c "CREATE TABLE backup_test(id serial primary key, note text); INSERT INTO backup_test(note) VALUES ('before-backup');"

podman run --rm --network container:erp4-pg-poc -v "$PWD":/workspace -w /workspace \
  -e DB_HOST=localhost -e DB_PORT=5432 -e DB_USER=postgres -e DB_PASSWORD=postgres -e DB_NAME=backup_restore_test \
  -e BACKUP_DIR=/workspace/tmp/erp4-backups-test -e BACKUP_PREFIX=erp4test \
  docker.io/library/postgres:15 bash -c "./scripts/backup-prod.sh backup"

podman exec -e PGPASSWORD=postgres erp4-pg-poc psql -U postgres -d backup_restore_test \
  -c "INSERT INTO backup_test(note) VALUES ('after-backup');"

podman run --rm --network container:erp4-pg-poc -v "$PWD":/workspace -w /workspace \
  -e DB_HOST=localhost -e DB_PORT=5432 -e DB_USER=postgres -e DB_PASSWORD=postgres -e DB_NAME=backup_restore_test \
  -e BACKUP_DIR=/workspace/tmp/erp4-backups-test -e BACKUP_PREFIX=erp4test \
  -e RESTORE_CONFIRM=1 -e SKIP_GLOBALS=1 \
  docker.io/library/postgres:15 bash -c "./scripts/backup-prod.sh restore"
```

## 結果
- `backup-prod.sh backup` は成功
- `backup-prod.sh restore` は `SKIP_GLOBALS=1` で成功
- リストア後の行数は 1 件（バックアップ時点に戻ることを確認）

## 補足
- globals の restore は既存ロールがある環境では失敗するため、検証環境では `SKIP_GLOBALS=1` を推奨

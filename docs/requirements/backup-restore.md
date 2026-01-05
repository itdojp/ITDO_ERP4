# バックアップ/リストア手順（草案）

## 対象範囲
- PostgreSQL データベース（必須）
- PDF ファイル（PDF_PROVIDER=local の場合）
- 環境設定/シークレット（別管理）

## バックアップ方針（案）
- DB: 日次の論理バックアップ（`pg_dump`）
- 重要テーブルは週次でフルバックアップ
- ロール/権限は `pg_dumpall --globals-only`

## バックアップ手順（例）
1. `pg_dump` でスキーマ + データを取得
2. 世代管理（例: 7日分）で保存
3. リストア検証用に別DBへ復元

### Podman（PoC）での例
- バックアップ（SQL）
  - `podman exec -e PGPASSWORD=postgres erp4-pg-poc sh -c "pg_dump -U postgres -d postgres" > /tmp/erp4-backup.sql`
- バックアップ（globals）
  - `podman exec -e PGPASSWORD=postgres erp4-pg-poc sh -c "pg_dumpall --globals-only -U postgres" > /tmp/erp4-globals.sql`
- リストア（SQL）
  - `cat /tmp/erp4-backup.sql | podman exec -e PGPASSWORD=postgres -i erp4-pg-poc psql -U postgres -d postgres`
- スクリプト（推奨）
  - `./scripts/podman-poc.sh backup`
  - `RESTORE_CONFIRM=1 ./scripts/podman-poc.sh restore`
  - オプション: `BACKUP_DIR`, `BACKUP_FILE`, `BACKUP_GLOBALS_FILE`, `BACKUP_PREFIX`
  - 備考: `BACKUP_FILE`/`BACKUP_GLOBALS_FILE` は任意パス指定なので、信頼できる入力のみ使用する

## リストア手順（例）
1. 空の DB を作成
2. `psql` でバックアップを投入
3. 接続/主要 API のスモーク確認

### Podman（PoC）での例
- 必要に応じて `./scripts/podman-poc.sh start` でDBを起動
- リストア後は `./scripts/podman-poc.sh check` で件数/金額の整合を確認
- `RESTORE_CONFIRM=1` を付けた場合のみ restore が実行される

### 本番向けスクリプト（AWS/S3 例）
- バックアップ（DB/グローバル/メタデータ/任意で添付）
  - `./scripts/backup-prod.sh backup`
- S3 へアップロード（既存ローカルバックアップを転送）
  - `S3_BUCKET=erp4-backups SSE_KMS_KEY_ID=alias/erp4-backup ./scripts/backup-prod.sh upload`
- S3 から取得してリストア
  - `S3_BUCKET=erp4-backups ./scripts/backup-prod.sh download`
  - `RESTORE_CONFIRM=1 ./scripts/backup-prod.sh restore`

### 検証環境（ローカル + 別ホスト退避 + 暗号化）
- GPG で暗号化し、別ホストへ転送
  - `GPG_RECIPIENT=backup@example.com REMOTE_HOST=backup-host REMOTE_DIR=/var/backups/erp4 ./scripts/backup-prod.sh backup`
- 別ホストから最新を取得してリストア
  - `REMOTE_HOST=backup-host REMOTE_DIR=/var/backups/erp4 ./scripts/backup-prod.sh download`
  - `RESTORE_CONFIRM=1 ASSET_DIR=/var/erp4-assets ./scripts/backup-prod.sh restore`

注意:
- `REMOTE_HOST` を指定した場合は `REMOTE_DIR` が必須
- `REMOTE_KEEP_DAYS` を指定すると別ホスト側も世代削除を実行

必要な環境変数（抜粋）
- `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`
- `S3_BUCKET`/`S3_PREFIX`/`S3_REGION`/`S3_ENDPOINT_URL`
- `SSE_KMS_KEY_ID` または `SSE_S3`（例: `AES256`）
- `ASSET_DIR`（PDF/添付をローカル保存している場合のルート）
- `GPG_RECIPIENT`（二重暗号化が必要な場合）
- `BACKUP_FILE`/`BACKUP_GLOBALS_FILE`/`BACKUP_ASSETS_FILE`（特定バックアップを upload/restore する場合）
- `REMOTE_HOST`/`REMOTE_DIR`/`REMOTE_PORT`/`REMOTE_SSH_KEY`（別ホスト退避）

## 保持期間/世代管理（案）
- 日次: 14日分
- 週次: 8週分
- 月次: 12か月分
- 重要リリース前後は手動スナップショットを追加
- 保管先は本番とは別リージョン/別アカウントに1世代以上保持

### RPO/RTO 目標
- RPO: 通常データは最大24時間分の損失を許容（原則: 日次バックアップ）
- RPO: 重要データは最大6時間分の損失を許容（暫定。運用で6時間ごとのバックアップを前提）
- RTO: 通常データは4時間以内に復旧（DB + PDF/添付 + 主要設定）
- RTO: 重要データは2時間以内に復旧（暫定）
  - 検知と対応開始の目標は30分以内（RTOには含めない）

## 暗号化/保管先（案）
- 保管先: オブジェクトストレージ（S3互換など）
- 暗号化: KMSによるサーバーサイド暗号化を必須
- 追加保護が必要な場合は `pg_dump` 生成物をGPGで二重暗号化
- 復号キーの権限は管理部/経営の二重管理

## 本番運用（案）
- 実行タイミング: 深夜帯の日次（例: 02:00 JST）
- 取得形式: `pg_dump -Fc`（DB）+ `pg_dumpall --globals-only`（ロール/権限）
- 保存先: `s3://<bucket>/erp4/<env>/{db,globals,assets,meta}/`
- 暗号化: SSE-KMS（例: `alias/erp4-backup`）+ 必要に応じてGPG
- アップロード: メタデータに `env`, `generated_at`, `schema_version` を付与
- 権限: 書き込み専用ロールと読み取り専用ロールを分離
- 保持期間は S3 Lifecycle で管理（ローカル削除とは別）

## 暫定運用（S3未整備の間）
- ローカル保存 + 別ホスト退避 + GPG 暗号化
- 退避先は rsync/scp で同期（`REMOTE_HOST`/`REMOTE_DIR`）
- 別ホスト側の保持期間は `REMOTE_KEEP_DAYS` で管理（未指定の場合は手動）

## リストア検証（案）
- 月次で別環境にリストアし、`/health` と主要APIのスモーク確認
- DB件数/合計金額の整合（`./scripts/podman-poc.sh check`。内部的に `scripts/checks/poc-integrity.sql` を利用）を実行
- 失敗時は原因と対応を記録し、次回の手順を更新

## PDF/添付の扱い（案）
- `PDF_PROVIDER=local` の場合は保存ディレクトリをバックアップ対象に含める
- ストレージに移行する場合はオブジェクトストレージのライフサイクルポリシーを併用
- 復元時は DB と PDF の世代を揃える（復元時刻の一致を記録）

## 検証チェックリスト
- 主要テーブルの件数が一致
- 最新データが復元されている
- バッチ実行が再開できる

## TODO
- 本番環境の保持期間/暗号化方針の確定（叩き台は追記済み）
- PDF/添付のバックアップ方式を決定（叩き台は追記済み）
- S3 バケット名/リージョン/KMS の確定値を反映

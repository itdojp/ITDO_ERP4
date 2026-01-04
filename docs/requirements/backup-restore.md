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

## 保持期間/世代管理/RPO/RTO（案）
- 日次: 14日分
- 週次: 8週分
- 月次: 12か月分
- 重要リリース前後は手動スナップショットを追加
- 保管先は本番とは別リージョン/別アカウントに1世代以上保持
- RPO: 24時間以内（原則: 日次バックアップ）
- RTO: 4時間以内（DB + PDF/添付 + 主要設定の復旧完了まで）

## 暗号化/保管先（案）
- 保管先: オブジェクトストレージ（S3互換など）
- 暗号化: KMSによるサーバーサイド暗号化を必須
- 追加保護が必要な場合は `pg_dump` 生成物をGPGで二重暗号化
- 復号キーの権限は管理部/経営の二重管理

## 本番運用（案）
- 実行タイミング: 深夜帯の日次（例: 02:00 JST）
- 取得形式: `pg_dump -Fc`（DB）+ `pg_dumpall --globals-only`（ロール/権限）
- 保存先: `s3://<bucket>/erp4/<env>/{db,globals,assets}/YYYY/MM/DD/`
- 暗号化: SSE-KMS（例: `alias/erp4-backup`）+ 必要に応じてGPG
- アップロード: メタデータに `env`, `generated_at`, `schema_version` を付与
- 権限: 書き込み専用ロールと読み取り専用ロールを分離

## リストア検証（案）
- 月次で別環境にリストアし、`/health` と主要APIのスモーク確認
- DB件数/合計金額の整合（`scripts/checks/poc-integrity.sql` 相当）を実行
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

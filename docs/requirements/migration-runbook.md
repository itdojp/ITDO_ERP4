# PO→ERP4 データ移行 Runbook（PoC/検証）

目的: Project-Open（PO）のデータを ERP4 に一方向移行する際に、**繰り返し・安全に実行**できる手順（リハーサル/本番手順の叩き台/ロールバック方針）を残す。

関連ドキュメント
- 入力仕様/実行オプション: `docs/requirements/migration-tool.md`
- マッピング（ドラフト）: `docs/requirements/migration-mapping.md`
- PoC（seed/check）: `docs/requirements/migration-poc.md`
- バックアップ/リストア: `docs/requirements/backup-restore.md`

## 0. 前提（重要）
- このRunbookは **PoC/検証環境** を想定（Podman + Postgres）。
- **実行前に必ずバックアップ** を取る（ロールバックは基本的に「バックアップから復元」）。
- 移行ツールは `--apply` 時に簡易整合チェックを実行し、問題がある場合は終了コードが非0になる。
- 移行ツールは「決定的ID（legacyId→uuidv5相当）」＋ upsert なので、同じ入力で再実行しても重複しない。

## 1. 入力の準備
入力ディレクトリは例として `tmp/migration/po/` を使用する。

- JSON: `*.json`（配列）
- CSV: `*.csv`（ヘッダ付きCSV、UTF-8）

詳細は `docs/requirements/migration-tool.md` を参照。

## 2. DB（Podman）の準備
`scripts/podman-poc.sh` を利用する。

例: 専用コンテナで起動（ポートは適宜）
```bash
CONTAINER_NAME=erp4-pg-po-migration HOST_PORT=55440 bash scripts/podman-poc.sh start
CONTAINER_NAME=erp4-pg-po-migration HOST_PORT=55440 bash scripts/podman-poc.sh db-push
```

接続先を設定:
```bash
export DATABASE_URL='postgresql://postgres:postgres@localhost:55440/postgres?schema=public'
```

## 3. リハーサル手順（推奨）
### 3.1 dry-run（DBへ書き込まない）
```bash
npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts \
  --input-dir=tmp/migration/po \
  --input-format=json
```

- `errors` が出る場合は入力データ/マッピングを修正し、再実行する。
- `--only=projects,tasks,...` で対象を絞り、原因の切り分けを行う。

### 3.2 apply（DBへ書き込む）
```bash
export MIGRATION_CONFIRM=1
npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json scripts/migrate-po.ts \
  --input-dir=tmp/migration/po \
  --input-format=json \
  --apply
```

### 3.3 取込後チェック（DB側）
移行後、SQLチェックを実行して参照整合/金額整合を確認する。

```bash
podman exec -e PGPASSWORD=postgres erp4-pg-po-migration \
  psql -U postgres -d postgres -f /workspace/scripts/checks/migration-po-integrity.sql
```

## 4. 本実行（たたき台）
前提: 本実行時は「書き込み停止（メンテナンスウィンドウ）」を設ける。

1) バックアップを取得（復元可能な形で保管）  
2) `db-push`/migrations の適用  
3) `dry-run` → 入力/マッピングの最終確認  
4) `--apply` 実行  
5) `migration-po-integrity.sql` 等で検証  
6) UI/APIでの確認（主要な一覧・集計）  

## 5. ロールバック方針（検証/本番共通の原則）
原則: **DBバックアップからの復元** をロールバックとする。

- 検証環境: DBを作り直して再実行する（例: コンテナをstop→start→db-push）。
- 本番相当: バックアップ（+ 可能ならglobals）を復元し、移行前状態に戻す。

`scripts/podman-poc.sh` の例:
```bash
CONTAINER_NAME=erp4-pg-po-migration HOST_PORT=55440 bash scripts/podman-poc.sh backup
RESTORE_CONFIRM=1 CONTAINER_NAME=erp4-pg-po-migration HOST_PORT=55440 bash scripts/podman-poc.sh restore
```

## 6. よくある失敗パターン（チェックポイント）
- 参照切れ（project/task/milestone/estimate/vendor/expense の未投入）
  - `--only` で依存順に投入する（users → customers/vendors → projects → tasks/milestones → documents → time/expense）
- ユーザID（`time_entries.userId` 等）の突合せが未確定
  - PoC段階では「文字列IDのまま」取り込み、後で運用/ID連携設計で確定させる（必要なら変換ジョブを作る）
- 金額整合（header total と lines 合計の不一致）
  - 入力側の `totalAmount` と `lines` の内容を合わせる（または `lines` を省略して自動生成にする）

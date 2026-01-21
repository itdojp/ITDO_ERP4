# ProjectOpen SQL ダンプからの移行テスト手順

## 目的
ProjectOpen の `pg_dump` から抽出したデータを ERP4 の移行ツールで投入し、移行手順と品質を検証する。

## 対象ダンプ
- `pg_dump.www4292uf.sakura.ne.jp.projop.20260119.010001.sql`
- `pg_dump.www4292uf.sakura.ne.jp.projop.20260121.010001.sql`（最新）

差分が追加データのみであれば最新のみを使用する。

## 前提
- Podman が利用可能
- `scripts/podman-poc.sh` が動作する
- `packages/backend` を `npm run build` 済み（`scripts/migrate-po.ts` は `dist` を参照）

## 1. ProjectOpen DB の復元（最新ダンプ）
```bash
# 専用コンテナを起動
CONTAINER_NAME=erp4-pg-projop HOST_PORT=55435 ./scripts/podman-poc.sh start

# GRANT 失敗を避けるためロールを作成
podman exec -e PGPASSWORD=postgres erp4-pg-projop \
  psql -U postgres -d postgres -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='projop') THEN CREATE ROLE projop; END IF; END \$\$;"

# public を初期化
podman exec -e PGPASSWORD=postgres erp4-pg-projop \
  psql -U postgres -d postgres -c "DROP SCHEMA public CASCADE" -c "CREATE SCHEMA public"

# 復元（エラーは続行される）
podman exec -e PGPASSWORD=postgres -i erp4-pg-projop \
  psql -U postgres -d postgres < pg_dump.www4292uf.sakura.ne.jp.projop.20260121.010001.sql
```

### 既知の復元エラーと対処
- `DROP CONSTRAINT ... does not exist` などは空DBでは発生するが致命ではない
- `tsearch2` 関連関数（`dex_*` / `prsd_*`）が無い → `pg_ts_dict` / `pg_ts_parser` の COPY が失敗
  - 移行テストには不要なため、以下の「サニタイズ」で回避可能

#### サニタイズ（任意）
```
python - <<'PY'
import re
src = "pg_dump.www4292uf.sakura.ne.jp.projop.20260121.010001.sql"
dst = "tmp/projop-sanitized.sql"
skip_patterns = [
    re.compile(r"^-- Name: (dex_|prsd_)"),
    re.compile(r"^CREATE FUNCTION (dex_|prsd_)"),
    re.compile(r"^ALTER FUNCTION (dex_|prsd_)"),
    re.compile(r"^DROP FUNCTION public\\.(dex_|prsd_)"),
    re.compile(r"^-- Name: pg_ts_dict"),
    re.compile(r"^-- Name: pg_ts_parser"),
    re.compile(r"^CREATE TABLE pg_ts_dict"),
    re.compile(r"^CREATE TABLE pg_ts_parser"),
    re.compile(r"^COPY pg_ts_dict"),
    re.compile(r"^COPY pg_ts_parser"),
]
skip_copy = None
with open(src, "r", encoding="utf-8", errors="ignore") as f, open(dst, "w", encoding="utf-8") as out:
    for line in f:
        if skip_copy:
            if line.strip() == "\\.":
                skip_copy = None
            continue
        if line.startswith("COPY pg_ts_dict") or line.startswith("COPY pg_ts_parser"):
            skip_copy = True
            continue
        if any(p.search(line) for p in skip_patterns):
            continue
        out.write(line)
print("written:", dst)
PY
```

## 2. 2つのダンプ差分チェック（追加データのみか確認）
```bash
# 旧ダンプを別コンテナへ復元
CONTAINER_NAME=erp4-pg-projop-20260119 HOST_PORT=55436 ./scripts/podman-poc.sh start
podman exec -e PGPASSWORD=postgres erp4-pg-projop-20260119 \
  psql -U postgres -d postgres -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='projop') THEN CREATE ROLE projop; END IF; END \$\$;"
podman exec -e PGPASSWORD=postgres erp4-pg-projop-20260119 \
  psql -U postgres -d postgres -c "DROP SCHEMA public CASCADE" -c "CREATE SCHEMA public"
podman exec -e PGPASSWORD=postgres -i erp4-pg-projop-20260119 \
  psql -U postgres -d postgres < pg_dump.www4292uf.sakura.ne.jp.projop.20260119.010001.sql

# 主要テーブルの件数比較
podman exec -e PGPASSWORD=postgres erp4-pg-projop \
  psql -U postgres -d postgres -tA -c "select 'im_projects' as tbl, count(*) from im_projects union all select 'im_companies', count(*) from im_companies union all select 'im_hours', count(*) from im_hours union all select 'im_costs', count(*) from im_costs union all select 'im_invoices', count(*) from im_invoices union all select 'im_expenses', count(*) from im_expenses order by tbl;"
podman exec -e PGPASSWORD=postgres erp4-pg-projop-20260119 \
  psql -U postgres -d postgres -tA -c "select 'im_projects' as tbl, count(*) from im_projects union all select 'im_companies', count(*) from im_companies union all select 'im_hours', count(*) from im_hours union all select 'im_costs', count(*) from im_costs union all select 'im_invoices', count(*) from im_invoices union all select 'im_expenses', count(*) from im_expenses order by tbl;"
```
最新ダンプで件数が同等以上なら最新のみ利用する。

## 3. 移行入力CSVの作成（最新ダンプ）
出力先: `tmp/migration/po-projop-20260121/`

```bash
mkdir -p tmp/migration/po-projop-20260121

# customers
podman exec -e PGPASSWORD=postgres erp4-pg-projop psql -U postgres -d postgres -c \
"COPY (SELECT DISTINCT
  'im_companies:'||c.company_id AS \"legacyId\",
  COALESCE(NULLIF(c.company_path,''),'C'||c.company_id::text) AS \"code\",
  c.company_name AS \"name\",
  'active' AS \"status\",
  c.vat_number AS \"invoiceRegistrationId\",
  NULL::text AS \"taxRegion\",
  NULL::text AS \"billingAddress\"
FROM im_companies c
WHERE c.company_id IN (SELECT DISTINCT company_id FROM im_projects)
) TO STDOUT WITH CSV HEADER" \
> tmp/migration/po-projop-20260121/customers.csv

# vendors（カテゴリに Provider が含まれるもの）
podman exec -e PGPASSWORD=postgres erp4-pg-projop psql -U postgres -d postgres -c \
"COPY (SELECT
  'im_companies:'||c.company_id AS \"legacyId\",
  COALESCE(NULLIF(c.company_path,''),'V'||c.company_id::text) AS \"code\",
  c.company_name AS \"name\",
  'active' AS \"status\",
  NULL::text AS \"bankInfo\",
  NULL::text AS \"taxRegion\"
FROM im_companies c
JOIN im_categories cat ON cat.category_id = c.company_type_id
WHERE cat.category ILIKE '%Provider%'
) TO STDOUT WITH CSV HEADER" \
> tmp/migration/po-projop-20260121/vendors.csv

# projects（重複コードは project_id を付与、日付順を補正）
podman exec -e PGPASSWORD=postgres erp4-pg-projop psql -U postgres -d postgres -c \
"COPY (SELECT
  'im_projects:'||p.project_id AS \"legacyId\",
  CASE
    WHEN p.project_nr IS NULL OR p.project_nr = '' THEN 'P'||p.project_id::text
    WHEN count(*) OVER (PARTITION BY p.project_nr) > 1 THEN p.project_nr || '-' || p.project_id::text
    ELSE p.project_nr
  END AS \"code\",
  p.project_name AS \"name\",
  'active' AS \"status\",
  CASE WHEN p.parent_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM im_projects parent WHERE parent.project_id = p.parent_id)
       THEN 'im_projects:'||p.parent_id ELSE NULL END AS \"parentLegacyId\",
  'im_companies:'||p.company_id AS \"customerLegacyId\",
  CASE WHEN p.start_date IS NOT NULL AND p.end_date IS NOT NULL
       THEN LEAST(p.start_date, p.end_date)::date ELSE p.start_date::date END AS \"startDate\",
  CASE WHEN p.start_date IS NOT NULL AND p.end_date IS NOT NULL
       THEN GREATEST(p.start_date, p.end_date)::date ELSE p.end_date::date END AS \"endDate\",
  COALESCE(p.project_budget_currency,'JPY') AS \"currency\",
  p.project_budget_hours AS \"planHours\",
  p.project_budget AS \"budgetCost\"
FROM im_projects p
) TO STDOUT WITH CSV HEADER" \
> tmp/migration/po-projop-20260121/projects.csv

# time_entries（hours<=0/BC日付は除外）
podman exec -e PGPASSWORD=postgres erp4-pg-projop psql -U postgres -d postgres -c \
"COPY (SELECT
  'im_hours:'||hour_id AS \"legacyId\",
  'im_projects:'||project_id AS \"projectLegacyId\",
  user_id::text AS \"userId\",
  day::date AS \"workDate\",
  ROUND(hours * 60)::int AS \"minutes\",
  NULL::text AS \"taskLegacyId\",
  NULL::text AS \"workType\",
  NULL::text AS \"location\",
  note AS \"notes\",
  NULL::text AS \"status\"
FROM im_hours
WHERE hours > 0 AND day IS NOT NULL AND day >= '1900-01-01'
) TO STDOUT WITH CSV HEADER" \
> tmp/migration/po-projop-20260121/time_entries.csv

# expenses（project_id ありのみ）
podman exec -e PGPASSWORD=postgres erp4-pg-projop psql -U postgres -d postgres -c \
"COPY (SELECT
  'im_expenses:'||e.expense_id AS \"legacyId\",
  'im_projects:'||c.project_id AS \"projectLegacyId\",
  COALESCE(c.last_modifying_user, c.customer_id)::text AS \"userId\",
  COALESCE(cat.category,'expense') AS \"category\",
  COALESCE(c.amount,0) AS \"amount\",
  COALESCE(c.currency,'JPY') AS \"currency\",
  COALESCE(c.effective_date, c.start_block)::date AS \"incurredOn\",
  CASE WHEN c.needs_redistribution_p='t' THEN 'true' ELSE 'false' END AS \"isShared\",
  NULL::text AS \"receiptUrl\",
  NULL::text AS \"status\"
FROM im_expenses e
JOIN im_costs c ON c.cost_id = e.expense_id
LEFT JOIN im_categories cat ON cat.category_id = e.expense_type_id
WHERE c.project_id IS NOT NULL
) TO STDOUT WITH CSV HEADER" \
> tmp/migration/po-projop-20260121/expenses.csv

# invoices（負の金額は除外）
podman exec -e PGPASSWORD=postgres erp4-pg-projop psql -U postgres -d postgres -c \
"COPY (SELECT
  'im_invoices:'||i.invoice_id AS \"legacyId\",
  'im_projects:'||c.project_id AS \"projectLegacyId\",
  COALESCE(i.invoice_nr, c.cost_nr) AS \"invoiceNo\",
  c.effective_date::date AS \"issueDate\",
  (c.effective_date + (COALESCE(c.payment_days,0) || ' days')::interval)::date AS \"dueDate\",
  COALESCE(c.currency,'JPY') AS \"currency\",
  COALESCE(c.amount,0) AS \"totalAmount\",
  'approved' AS \"status\",
  NULL::text AS \"estimateLegacyId\",
  NULL::text AS \"milestoneLegacyId\"
FROM im_invoices i
JOIN im_costs c ON c.cost_id = i.invoice_id
WHERE c.project_id IS NOT NULL AND COALESCE(c.amount,0) >= 0
) TO STDOUT WITH CSV HEADER" \
> tmp/migration/po-projop-20260121/invoices.csv
```

## 4. ERP4 への移行テスト
```bash
# ERP4 DB
CONTAINER_NAME=erp4-pg-erp4-mig HOST_PORT=55440 ./scripts/podman-poc.sh start
CONTAINER_NAME=erp4-pg-erp4-mig HOST_PORT=55440 ./scripts/podman-poc.sh db-push

# backend build
npm run build --prefix packages/backend

# dry-run
DATABASE_URL=postgresql://postgres:postgres@localhost:55440/postgres?schema=public \
  npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json \
  scripts/migrate-po.ts --input-dir=tmp/migration/po-projop-20260121 --input-format=csv \
  --only=customers,vendors,projects,invoices,time_entries,expenses

# apply
MIGRATION_CONFIRM=1 MIGRATION_VERIFY_CHUNK_SIZE=1000 \
DATABASE_URL=postgresql://postgres:postgres@localhost:55440/postgres?schema=public \
  npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json \
  scripts/migrate-po.ts --input-dir=tmp/migration/po-projop-20260121 --input-format=csv \
  --only=customers,vendors,projects,invoices,time_entries,expenses --apply
```

## 5. 検証
```bash
podman exec -e PGPASSWORD=postgres erp4-pg-erp4-mig \
  psql -U postgres -d postgres -f /workspace/scripts/checks/migration-po-integrity.sql
```

## 備考
- ProjectOpen の `tsearch2` 系関数は Postgres 15 では利用できないため、復元時に無視またはサニタイズする。
- ProjectOpen データの一部に `project_nr` 重複 / 日付逆転 / 時間=0 / BC日付 / 負の請求額が存在するため、CSV抽出時に正規化・除外する。

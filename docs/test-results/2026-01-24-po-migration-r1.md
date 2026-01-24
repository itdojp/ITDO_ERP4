# PO移行リハーサル（SQLダンプ）結果 2026-01-24

## 実施内容
- 2つのダンプ（2026-01-19 / 2026-01-21）を稼働中のPodman DBへ復元済みの前提で件数比較を実施
- ERP4 移行スクリプト（dry-run）で CSV 入力の読み込み検証を実施

## 使用コンテナ
- `erp4-pg-projop`（最新ダンプ: 2026-01-21）
- `erp4-pg-projop-20260119`（旧ダンプ: 2026-01-19）
- `erp4-pg-erp4-mig`（ERP4 移行先DB）

## 件数比較（旧→最新）
```
im_companies|159  -> 159
im_projects |1734 -> 1734
im_hours    |54202 -> 54240
im_costs    |76350 -> 76389
im_invoices |2914  -> 2915
im_expenses |15288 -> 15288
```
- 最新ダンプは `im_hours / im_costs / im_invoices` が増加
- 主要テーブルで減少は見られず、追加データ中心と判断

## 移行ドライラン
コマンド:
```
DATABASE_URL="postgresql://postgres:postgres@localhost:55440/postgres?schema=public" \
  npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json \
  scripts/migrate-po.ts --input-format=csv --input-dir=tmp/migration/po-projop-20260121
```
結果（summary）:
```
customers:      created 0 / updated 87
vendors:        created 0 / updated 26
projects:       created 0 / updated 1734
tasks:          created 0 / updated 0
milestones:     created 0 / updated 0
estimates:      created 0 / updated 0
invoices:       created 0 / updated 2897
purchase_orders created 0 / updated 0
vendor_quotes   created 0 / updated 0
vendor_invoices created 0 / updated 0
time_entries:   created 0 / updated 54216
expenses:       created 0 / updated 15288
```

## 所見
- dry-run が「全件 updated」になっているため、移行先DBに既存データが入っている状態。
- 本番相当の移行リハーサルは **空のERP4 DB** を用意した上で `--apply` を実行する必要がある。

## 移行 apply（空DB）
前提:
- 新規の空DBコンテナ `erp4-pg-erp4-mig-r1`（host port: 55441）
- `prisma migrate deploy` 実行済み
- `WorklogSetting` の重複マイグレーション対策が必要（PR #688）

コマンド:
```
MIGRATION_CONFIRM=1 DATABASE_URL="postgresql://postgres:postgres@localhost:55441/postgres?schema=public" \
  npx --prefix packages/backend ts-node --project packages/backend/tsconfig.json \
  scripts/migrate-po.ts --input-format=csv --input-dir=tmp/migration/po-projop-20260121 --apply
```

結果（summary）:
```
customers:      created 87 / updated 0
vendors:        created 26 / updated 0
projects:       created 1734 / updated 0
tasks:          created 0 / updated 0
milestones:     created 0 / updated 0
estimates:      created 0 / updated 0
invoices:       created 2897 / updated 0
purchase_orders created 0 / updated 0
vendor_quotes   created 0 / updated 0
vendor_invoices created 0 / updated 0
time_entries:   created 54216 / updated 0
expenses:       created 15288 / updated 0
```

その他:
- `migration-po` の integrity check は `ok`

## 移行後の件数確認
コマンド:
```
podman exec -e PGPASSWORD=postgres erp4-pg-erp4-mig-r1 \
  psql -U postgres -d postgres -tA -c "
  select 'Customer' as tbl, count(*) from \"Customer\"
  union all select 'Vendor', count(*) from \"Vendor\"
  union all select 'Project', count(*) from \"Project\"
  union all select 'Invoice', count(*) from \"Invoice\"
  union all select 'TimeEntry', count(*) from \"TimeEntry\"
  union all select 'Expense', count(*) from \"Expense\"
  order by tbl;"
```

結果:
```
Customer|87
Expense|15288
Invoice|2897
Project|1734
TimeEntry|54216
Vendor|26
```

## 参照整合の簡易チェック（UserAccount未投入時）
※ 初回チェック時点では `UserAccount` を投入しておらず、ユーザ参照は未整合のまま（想定通り）。

コマンド:
```
podman exec -e PGPASSWORD=postgres erp4-pg-erp4-mig-r1 \
  psql -U postgres -d postgres -tA -c "
  select 'time_entries_without_user' as check, count(*) from \"TimeEntry\" t
    left join \"UserAccount\" u on u.id = t.\"userId\"
    where u.id is null;
  select 'expenses_without_user' as check, count(*) from \"Expense\" e
    left join \"UserAccount\" u on u.id = e.\"userId\"
    where u.id is null;
  select 'projects_without_customer' as check, count(*) from \"Project\" p
    left join \"Customer\" c on c.id = p.\"customerId\"
    where p.\"customerId\" is not null and c.id is null;
  select 'projects_without_parent' as check, count(*) from \"Project\" p
    left join \"Project\" parent on parent.id = p.\"parentId\"
    where p.\"parentId\" is not null and parent.id is null;
  select 'invoices_without_project' as check, count(*) from \"Invoice\" i
    left join \"Project\" p on p.id = i.\"projectId\"
    where i.\"projectId\" is not null and p.id is null;"
```

結果:
```
time_entries_without_user|54216
expenses_without_user|15288
projects_without_customer|0
projects_without_parent|0
invoices_without_project|0
```

所見:
- UserAccount を移行していないため、TimeEntry/Expense の userId は全件未解決（想定通り）。
- Project → Customer / 親子 Project / Invoice → Project は参照欠損なし。

## 参照整合の簡易チェック（UserAccount投入後）
実施:
- `users.csv` を作成し、`scripts/migrate-po.ts --only=users --apply` を実行

結果:
```
time_entries_without_user|0
expenses_without_user|15288
```

所見:
- TimeEntry の userId は `users.csv` の投入で解決。
- Expense は元データにユーザ情報が無く、全件未解決のまま。

## 次のアクション
- `--apply` 後のデータ検証（件数/ランダムサンプル/不整合確認）
- 失敗行/検証不一致があれば差分整理
- Expense の userId マッピング方針（placeholder/プロジェクト責任者/手動補完）を決定

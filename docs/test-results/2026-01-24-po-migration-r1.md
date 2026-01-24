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

## 次のアクション
- `--apply` 後のデータ検証（件数/ランダムサンプル/不整合確認）
- 失敗行/検証不一致があれば差分整理
- `WorklogSetting` 重複マイグレーション修正（PR #688）をマージ

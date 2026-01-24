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

## 次のアクション
- ERP4 移行先DBの初期化（新規コンテナ or schema reset）
- `MIGRATION_CONFIRM=1` で `--apply` 実行し、import 結果を記録
- 失敗行/検証不一致があれば差分整理

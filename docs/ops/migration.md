# 移行（Runbook）

## 入口
移行手順の詳細は `docs/requirements/migration-runbook.md` を参照。

## 主な資材
- 移行スクリプト: `scripts/migrate-po.ts`
- 整合性チェック: `scripts/checks/migration-po-integrity.sql`

## 最小の実施手順（概念）
1. dry-run（可能な範囲で）
2. 移行実行
3. 整合性チェック
4. 結果を `docs/test-results/` に記録（再現可能性のため）


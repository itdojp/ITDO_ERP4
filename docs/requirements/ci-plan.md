# CI 計画（PoC）

## 目的
12/10 ステージングに向け、最小限のビルド・チェックスクリプトを自動化する。

## 現状
- .github/workflows/ci.yml: backend build, frontend build のみ

## 追加したい項目
- lint/format: prettier/eslint（backend/frontend）
- prisma: `prisma format`, `prisma validate`
- frontend: `npm run build`（既存）、将来的にE2E（Playwright/Cypress）
- backend: 単純な smoke test (ts-node で supertest 相当) を検討
- data-quality: SQL/Node スクリプトで基本チェッカーを走らせ、警告として出す

## ブランチ/PR
- PRテンプレート: 主要ユースケースが通る/CIパスをチェックリストに含める
- ブランチ: docs/bootstrap → main へのマージ運用を整備（人手レビュー）

## 実行例
```yaml
- run: npm run format --prefix packages/backend
- run: npm run format --prefix packages/frontend
- run: npx prisma format
- run: npx prisma validate
```

## 留意
- DB接続が必要なテストは PoC ではスキップ/モック
- セキュリティスキャンは後続フェーズ

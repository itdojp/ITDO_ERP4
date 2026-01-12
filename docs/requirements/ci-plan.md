# CI 計画（PoC）

## 目的
12/10 ステージングに向け、最小限のビルド・チェックスクリプトを自動化する。

## 現状
- .github/workflows/ci.yml: backend build, frontend build, lint/format

## 実施項目（PoC用CI）
- lint/format: prettier/eslint（追加済み）
- prisma: `prisma format`, `prisma validate`（追加済み）
- frontend: `npm run build`
- backend: `npm run build`
- data-quality: Nodeスクリプトを optional で実行（失敗しても job は継続）

## ブランチ/PR
- PRテンプレート: 主要ユースケースが通る/CIパスをチェックリストに含める
- ブランチ: `main` をデフォルトとし、PR は `main` にマージする

## 実行例
```yaml
- run: npm run format:check --prefix packages/backend
- run: npm run format:check --prefix packages/frontend
- run: npx prisma format
- run: npx prisma validate
```

## 留意
- DB接続が必要なテストは PoC ではスキップ/モック
- セキュリティスキャンは後続フェーズ

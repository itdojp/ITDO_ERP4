# リリース戦略（タグ→成果物→デプロイ）

## 目的
- リリース手順の再現性を確保し、属人性とリリース事故を低減する
- **デプロイ（配布）** と **機能有効化（Feature Flag）** を分離できる前提を作る
- ロールバック（アプリ/DB）を運用手順として成立させる

## 対象範囲
- backend（`packages/backend`）
- frontend（`packages/frontend`）
- DB（PostgreSQL / Prisma migration）

## 成果物（ビルドアーティファクト）
現時点の最小成果物は以下です。
- frontend: `packages/frontend/dist/`（静的アセット）
- backend: `packages/backend/dist/`（Node 実行物）+ `packages/backend/prisma/`（migration/schema）

## バージョニング規約（暫定）
- Git tag: `vX.Y.Z`（SemVer）
  - `X=0` の間は破壊的変更が入り得る（`Y` を増やす）
  - 破壊的変更が無い改善/機能追加は `Z` を増やす

## リリース前チェック（必須）
- CI が green（`CI` / `Link Check`）
- 依存脆弱性チェックが許容範囲（`security-audit`）
- DB マイグレーション有無の確認（`packages/backend/prisma/migrations/`）
- バックアップ手順が実施可能であることの確認（`docs/ops/backup-restore.md`）

## リリース実施（推奨手順）
### 1) リリース候補を確定
- `main` の対象コミット SHA を確定する
- 必要なら手動確認（PoC導線）: `docs/requirements/manual-test-checklist.md`

### 2) タグ付け
```bash
git checkout main
git pull
git tag -a vX.Y.Z -m "release vX.Y.Z"
git push origin vX.Y.Z
```

### 3) 成果物を作る（CI/CD: 手動トリガー）
- GitHub Actions の手動ジョブで成果物を作成し、Actions artifacts として保存する
  - workflow: `.github/workflows/release.yml`
  - 生成物に `tag` と `commit SHA` が含まれる（追跡性）

### 4) デプロイ
デプロイ方式（VM/コンテナ/静的ホスティング等）は環境依存です。最低限以下を満たすこと。
- backend: 対象コミット SHA の成果物で起動できる（`/healthz` / `/readyz` が通る）
- frontend: 対象コミット SHA の静的アセットが配信される
- DB migration を伴う場合、適用順序と切り戻し方針を事前に確定している

## リリース後チェック（必須）
- `/healthz` と `/readyz` を確認（`503` の場合は依存障害）
- 主要導線の確認（最小）: `docs/requirements/manual-test-checklist.md`
- 監視/一次切り分け: `docs/ops/observability.md`

## ロールバック方針（暫定）
### アプリ（frontend/backend）
- **直前の安定版（tag/commit）へ成果物を戻す**（原則）
- 変更を段階的に無効化できる場合は Feature Flag で切り戻す（`docs/ops/feature-flags.md`）

### DB（migration を含む場合）
- 原則: **DB を戻さずに前方互換（expand/contract）** を目指す
- 破壊的変更やデータ補正を伴う場合は、バックアップからのリストアを含めて判断する
  - バックアップ/リストア: `docs/ops/backup-restore.md`
  - DR計画（RTO/RPO/復元演習）: `docs/ops/dr-plan.md`

## 関連
- チェックリスト（短縮版）: `docs/ops/release-checklist.md`
- 入口（Runbook）: `docs/ops/index.md`

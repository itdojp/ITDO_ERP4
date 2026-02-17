# 品質ゲート（CI / ローカル）

## 目的
CIで何を検査しているか、どれを「必須ゲート（ブロック）」とするかを明文化する。

## CIの全体像
ワークフロー
- `CI`（`.github/workflows/ci.yml`）
- `Link Check`（`.github/workflows/link-check.yml`）
- `CodeQL`（`.github/workflows/codeql.yml`）

ジョブ名（ブランチ保護に使う前提で、原則として変更しない）
- `CI / backend`
- `CI / frontend`
- `CI / lint`
- `CI / e2e-frontend`
- `CI / security-audit`
- `CI / data-quality`（非ブロッキング）
- `Link Check / lychee`
- `CodeQL / analyze`
- `CI / secret-scan`（非ブロッキング）

## ゲート定義（必須/任意）
### Pull Request で必須（ブロック）
- `CI / backend`
- `CI / frontend`
- `CI / lint`
- `CI / e2e-frontend`（PRでは `E2E_SCOPE=core`）
- `CI / security-audit`
- `Link Check / lychee`

### main（デフォルトブランチ）で必須（ブロック）
- `CI / backend`
- `CI / frontend`
- `CI / lint`
- `CI / e2e-frontend`（main では `E2E_SCOPE=full`）
- `CI / security-audit`
- `Link Check / lychee`

### 任意（非ブロッキング）
- `CI / data-quality`（`continue-on-error: true` かつ `|| true` で常に成功扱い）
  - 目的: リグレッション検知の「参考情報」（ゲート化は別Issueで検討）
- `CI / secret-scan`（`continue-on-error: true`）
  - 目的: 既知パターンの秘密情報を検出（検知時は通知して対応）
- `CodeQL / analyze`（段階導入）
  - 目的: 静的解析による脆弱性の早期検出

## 各ゲートが見ていること（現状）
### CI / backend
- `packages/backend` の依存解決（`npm install`）
- Prisma:
  - `prisma generate`
  - `prisma format`
  - `prisma validate`
- TypeScript build: `npm run build`
- unit test: `npm run test:ci`

### CI / frontend
- `packages/frontend` の依存解決（`npm install`）
- TypeScript typecheck: `npm run typecheck`
- Vite build: `npm run build`

### CI / lint
- `packages/backend`
  - `npm run lint`
  - `npm run format:check`
- `packages/frontend`
  - `npm run lint`
  - `npm run format:check`

### CI / security-audit
- backend/frontend の依存関係監査（`npm audit --audit-level=high`）
- SBOM 生成（CycloneDX）

### CI / e2e-frontend
- Playwright の E2E を `scripts/e2e-frontend.sh` で実行
- DB: GitHub Actions の `postgres:15` service（`E2E_DB_MODE=direct`）
- 証跡: CIでは `E2E_CAPTURE=0`（キャプチャ出力なし）
- 失敗時のみ診断artifactを保存
  - `tmp/e2e-backend.log`
  - `tmp/e2e-frontend.log`
  - `packages/frontend/test-results/**/*`（Playwright trace を含む）
- 実行条件:
  - PR: 実行（`E2E_SCOPE=core`）
  - schedule: 実行（`E2E_SCOPE=full`）
  - push: デフォルトブランチのみ実行（`E2E_SCOPE=full`）
- UI/UX 最低ライン（a11y/入力体験/エラー一貫性）: `docs/ui/ux-quality.md`

### Link Check / lychee
- `./**/*.md` のリンク切れをチェック

### CodeQL / analyze
- TypeScript/JavaScript の静的解析（CodeQL）

## ローカルでの実行（例）
### 統一コマンド（Makefile）
- `make lint`
- `make format-check`
- `make typecheck`
- `make test`
- `make e2e`
- `make ui-evidence`（UI証跡の再取得。任意）

### Lint/Format
- backend: `npm run lint --prefix packages/backend && npm run format:check --prefix packages/backend`
- frontend: `npm run lint --prefix packages/frontend && npm run format:check --prefix packages/frontend`

### Build
- backend: `npm run build --prefix packages/backend`
- frontend: `npm run build --prefix packages/frontend`

### Typecheck
- backend: `npm run typecheck --prefix packages/backend`
- frontend: `npm run typecheck --prefix packages/frontend`

### Test
- backend: `npm run test --prefix packages/backend`

### E2E（検証環境はPodman前提）
- `scripts/e2e-frontend.sh`（既定で Podman DB を利用）
  - 例: `E2E_SCOPE=core E2E_CAPTURE=0 scripts/e2e-frontend.sh`

### スモーク/整合チェック（任意だが推奨）
- backendスモーク: `scripts/smoke-backend.sh`
- DB整合: `CONTAINER_NAME=erp4-pg-poc HOST_PORT=55432 scripts/podman-poc.sh check`
- チャット添付AV（ClamAV/clamd）:
  - `bash scripts/podman-clamav.sh check`
  - `bash scripts/smoke-chat-attachments-av.sh`

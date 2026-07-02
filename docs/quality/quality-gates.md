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
- `CI / coverage-auth`
- `CI / lint`
- `CI / e2e-frontend`
- `CI / security-audit`
- `CI / data-quality`（非ブロッキング）
- `Link Check / lychee`
- `CodeQL / analyze`
- `CI / secret-scan`

## ゲート定義（必須/任意）

### Pull Request で必須（ブロック）

- `CI / backend`
- `CI / frontend`
- `CI / coverage-auth`
- `CI / lint`
- `CI / e2e-frontend`（PRでは `E2E_SCOPE=core`）
- `CI / security-audit`
- `CI / secret-scan`
- `Link Check / lychee`

### main（デフォルトブランチ）で必須（ブロック）

- `CI / backend`
- `CI / frontend`
- `CI / coverage-auth`
- `CI / lint`
- `CI / e2e-frontend`（main では `E2E_SCOPE=full`）
- `CI / security-audit`
- `CI / secret-scan`
- `Link Check / lychee`

### 任意（非ブロッキング）

- `CI / data-quality`（`continue-on-error: true` かつ `|| true` で常に成功扱い）
  - 目的: リグレッション検知の「参考情報」（ゲート化は別Issueで検討）
- `CodeQL / analyze`（段階導入）
  - 目的: 静的解析による脆弱性の早期検出

## 各ゲートが見ていること（現状）

### CI / backend

- `packages/backend` の依存解決（`npm ci`）
- Prisma:
  - `prisma generate`
  - `prisma format`
  - `prisma validate`
- TypeScript build: `npm run build`
- unit test: `npm run test:ci`

### CI / frontend

- `packages/frontend` の依存解決（`npm ci`）
- TypeScript typecheck: `npm run typecheck`
- Vite build: `npm run build`

### CI / coverage-auth

- `packages/backend` の依存解決（`npm ci`）
- auth 関連 subset の coverage 計測と json-summary 閾値チェック: `npm run coverage:auth:check --prefix packages/backend`
  - `coverage:auth:check` は内部で `coverage:auth` を呼び出す
  - 閾値判定は `packages/backend/coverage-thresholds.json` の `auth.files` に列挙した認証関連ソースを `coverage-summary.json` から再集計する
  - auth 以外の backend ファイル追加は `coverage-auth` gate の分母に含めない
- 初期閾値（2026-07-02）:
  - statements: 25%
  - lines: 25%
  - branches: 60%
  - functions: 18%
- 目的: 全体一律閾値ではなく、重要モジュール単位で coverage 低下を PR で検知する
- 拡大方針: hotspots の Priority A 対象（projects、integrations、workflow 等）の service 抽出に合わせて scope と閾値を追加する

### CI / lint

- `packages/backend`
  - `npm run lint`
  - `npm run format:check`
  - `npm run arch:bounded-context`
  - `max-lines` gate: backend ESLint で route 肥大を error 1500 行として検知し、既存超過 route は `docs/quality/refactoring-hotspots.md` の allowlist cap で段階削減する
- `packages/frontend`
  - `npm run lint`
  - `npm run format:check`
  - `max-lines` gate: frontend ESLint で UI component/module 肥大を error 2500 行として検知し、段階的に 2000/1500 行へ下げる

### CI / arch:bounded-context

- backend の import 方向を `dependency-cruiser` で検査する。
- 正本:
  - ルール: `packages/backend/dependency-cruiser.config.cjs`
  - 既存違反 baseline: `packages/backend/dependency-cruiser-known-violations.json`
  - 既存違反一覧と削減方針: `docs/quality/bounded-context-imports.md`
- `docs/architecture/greenfield-ideal-design.md` の「1.1 バウンデッドコンテキスト（モジュール分割）」に対応し、baseline 未登録の新規違反は CI で fail する。

### CI / security-audit

- backend/frontend の依存関係監査（`npm audit --audit-level=high`）
- SBOM 生成（CycloneDX）

### CI / e2e-frontend

- Playwright の E2E を `scripts/e2e-frontend.sh` で実行
- DB: GitHub Actions の `postgres:15` service（`E2E_DB_MODE=direct`）
- 証跡: CIでは `E2E_CAPTURE=0`（キャプチャ出力なし）
- 失敗/キャンセル時のみ診断artifactを保存
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

## カバレッジ閾値ゲートの段階導入

coverage gate は `coverage-summary.json` を入力にする段階導入方式とする。初期対象は auth subset のみで、全体 coverage を一律 gate 化しない。

| scope | CI job               | summary                                                | threshold source                            | 初期閾値                                          |
| ----- | -------------------- | ------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------- |
| auth  | `CI / coverage-auth` | `packages/backend/coverage/auth/coverage-summary.json` | `packages/backend/coverage-thresholds.json` | statements/lines 25%、branches 60%、functions 18% |

auth scope の初期対象ファイルは `packages/backend/coverage-thresholds.json` の `auth.files` を正とし、`src/plugins/auth.ts`、`src/routes/auth.ts`、`src/services/authContext.ts`、`src/services/authGateway.ts`、`src/services/envValidation.ts`、`src/services/localCredentials.ts`、`src/utils/authGroupToRoleMap.ts` を対象にする。

拡大時は以下を同一 PR で更新する。

1. 対象 subset の coverage script
2. `packages/backend/coverage-thresholds.json` の scope と閾値
3. `.github/workflows/ci.yml` の coverage job または既存 job の対象
4. 本ドキュメントと `docs/quality/test-gaps.md`

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

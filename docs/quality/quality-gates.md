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
- `CI / data-quality`
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
- `CI / data-quality`
- `CI / secret-scan`
- `Link Check / lychee`

### main（デフォルトブランチ）で必須（ブロック）

- `CI / backend`
- `CI / frontend`
- `CI / coverage-auth`
- `CI / lint`
- `CI / e2e-frontend`（main では `E2E_SCOPE=full`）
- `CI / security-audit`
- `CI / data-quality`
- `CI / secret-scan`
- `Link Check / lychee`

### 任意（非ブロッキング）

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
- integrations subset coverage 計測と json-summary 閾値チェック: `npm run coverage:integrations:check`
  - branch protection の job 名を増やさず、既存必須 `CI / backend` の中で失敗させる
  - 閾値判定は `packages/backend/coverage-thresholds.json` の `integrations.files` に列挙した integrations route / service を `coverage-summary.json` から再集計する
- chat subset coverage 計測と json-summary 閾値チェック: `npm run coverage:chat:check`
  - branch protection の job 名を増やさず、既存必須 `CI / backend` の中で失敗させる
  - 閾値判定は `packages/backend/coverage-thresholds.json` の `chat.files` に列挙した chat route / route module / service / application / adapter を `coverage-summary.json` から再集計する

### CI / frontend

- `packages/frontend` の依存解決（`npm ci`）
- TypeScript typecheck: `npm run typecheck`
- Vitest unit tests: `npm run test`
- frontend UI core subset coverage 計測と json-summary 閾値チェック: `npm run coverage:ui-core:check`
  - branch protection の job 名を増やさず、既存必須 `CI / frontend` の中で失敗させる
  - 閾値判定は `packages/frontend/coverage-thresholds.json` の `ui-core.files` に列挙した core UI / server-state hook / component を `coverage-summary.json` から再集計する
  - `packages/frontend/scripts/frontend-quality-gates.test.mjs` は、AdminSettings / RoomChat server-state 境界の対象漏れ、stale entry、閾値低下、2000行 max-lines gate を検出する
- Vite build: `npm run build`

### CI / coverage-auth

- `packages/backend` の依存解決（`npm ci`）
- auth 関連 subset の coverage 計測と json-summary 閾値チェック: `npm run coverage:auth:check --prefix packages/backend`
  - `coverage:auth:check` は内部で `coverage:auth` を呼び出す
  - 閾値判定は `packages/backend/coverage-thresholds.json` の `auth.files` に列挙した認証関連ソースを `coverage-summary.json` から再集計する
  - auth 以外の backend ファイル追加は `coverage-auth` gate の分母に含めない
- auth scope の対象漏れと stale entry は `packages/backend/test/coverageThresholds.test.js` で検出する
  - `src/routes/auth/*.ts` と `src/application/auth/*.ts` の追加・削除に追従して `auth.files` を更新しない場合、completeness test または stale file test が失敗する
- 引上げ後閾値（2026-07-13、#1908 baseline）:
  - statements: 89.7%
  - lines: 89.7%
  - branches: 70.5%
  - functions: 97.9%
- 目的: 全体一律閾値ではなく、重要モジュール単位で coverage 低下を PR で検知する
- 拡大方針: hotspots の Priority A 対象（workflow 等）の service 抽出に合わせて scope と閾値を追加する。projects は #1915 で focused coverage gate を追加済み。

### CI / backend integrations coverage

- integrations 関連 subset の coverage 計測と json-summary 閾値チェック: `npm run coverage:integrations:check --prefix packages/backend`
  - `coverage:integrations:check` は内部で `coverage:integrations` を呼び出す
  - 対象は `packages/backend/coverage-thresholds.json` の `integrations.files` を正本とする
  - `packages/backend/test/coverageThresholds.test.js` は、現在の integrations route と関連 service ファイルが `integrations.files` から漏れていないことを検査する
  - integrations 以外の backend ファイル追加は `integrations` scope の分母に含めない
- 初期閾値（2026-07-12、#1882 baseline）:
  - statements: 91.1%
  - lines: 91.1%
  - branches: 72.7%
  - functions: 97.0%
- 目的: #1880/#1881 で service 化した外部連携 route / service の coverage 低下を、既存必須 `CI / backend` job で検知する

### CI / backend chat coverage

- chat 関連 subset の coverage 計測と json-summary 閾値チェック: `npm run coverage:chat:check --prefix packages/backend`
  - `coverage:chat:check` は内部で `coverage:chat` を呼び出す
  - 対象は `packages/backend/coverage-thresholds.json` の `chat.files` を正本とする
  - `packages/backend/test/coverageThresholds.test.js` は、現在の chat route、`src/routes/chat/**` / `src/routes/chatRooms/**` route module、`chat*.ts` / `personalGaChatRoom.ts` service、`src/application/chat/**`、既定通知 adapter が `chat.files` から漏れていないことを検査する
  - chat 以外の backend ファイル追加は `chat` scope の分母に含めない
- 初期閾値（2026-07-13、#1911 baseline）:
  - statements: 53.4%
  - lines: 53.4%
  - branches: 59.4%
  - functions: 70.1%
- 目的: #1909〜#1911 で service / application / route module 化した chat 境界の coverage 低下を、既存必須 `CI / backend` job で検知する

### CI / backend projects coverage

- projects 関連 subset の coverage 計測と json-summary 閾値チェック: `npm run coverage:projects:check --prefix packages/backend`
  - `coverage:projects:check` は内部で `coverage:projects` を呼び出す
  - 対象は `packages/backend/coverage-thresholds.json` の `projects.files` を正本とする
  - scope は `bounded-context-registry.cjs` の `org-project` context（`src/routes/projects.ts`、`src/routes/projects/**`、`src/services/entityChecks.ts`、`src/services/taskDependencyGraph.ts`）に、`src/application/projects/**` と project recurring due-date helper（`src/services/dueDateRule.ts`）を加えたもの
  - `packages/backend/test/coverageThresholds.test.js` は、Org & Project context registry と projects coverage scope の差分、stale entry、閾値の意図しない低下、`projects.ts` の temporary max-lines allowance 再追加を検出する
  - projects 以外の backend ファイル追加は `projects` scope の分母に含めない
- 初期閾値（2026-07-13、#1915 baseline）:
  - statements: 66.2%
  - lines: 66.2%
  - branches: 59.5%
  - functions: 77.8%
- 目的: #1912〜#1914 で route / application / service に分割した project lifecycle、hierarchy、membership、task/WBS/dependency、milestone、recurring template の coverage 低下を、既存必須 `CI / backend` job で検知する

### CI / lint

- `packages/backend`
  - `npm run lint`
  - `npm run format:check`
  - `npm run arch:bounded-context`
  - `max-lines` gate: backend ESLint で route 肥大を error 1500 行として検知し、既存超過 route は `docs/quality/refactoring-hotspots.md` の allowlist cap で段階削減する
- `packages/frontend`
  - `npm run lint`
  - `npm run format:check`
  - `max-lines` gate: frontend ESLint で UI component/module 肥大を error 2000 行として検知し、次段階で 1500 行へ下げる
- ドキュメント証跡
  - `node scripts/check-doc-image-links.mjs`
  - `make docs-test-results-index-check`
  - `docs/test-results/README.md` が日付付き証跡Markdown、関連証跡ディレクトリ、template、performance証跡を漏れなく・重複なく・決定的な順序で索引化していることを検査する

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

### CI / data-quality

- `packages/backend` の依存解決（`npm ci`）
- runner self-test: `npm run data-quality:test --prefix packages/backend`
  - 正常 fixture、blocking 負例 fixture、advisory 警告 fixture を node:test で検査する
  - blocking 負例 fixture は終了コード 1 を期待値として確認する
- blocking runner: `npm run data-quality:blocking --prefix packages/backend`
  - 正常 fixture `scripts/fixtures/data-quality-valid.json` に対し、決定的な不整合がないことを検査する
  - blocking finding がある場合、runner は非0終了し、CI job は失敗する
  - job-level `continue-on-error` と blocking step の `|| true` は使用しない
- advisory runner: `npm run data-quality:advisory --prefix packages/backend`
  - 同じ正常 fixture で業務判断・閾値依存の警告がないことを記録する
  - advisory finding は report/summary に残すが、runner の終了コードは 0 とする
- 証跡:
  - GitHub Step Summary: `tmp/data-quality-*.md` の内容を追記
  - Artifact: `tmp/data-quality-*.json` と `tmp/data-quality-*.md` を14日保持

#### blocking/advisory分類

| check                                                                                           | 区分     | ゲート理由                                                                           |
| ----------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `required_id_missing`                                                                           | blocking | import・連携・差分照合の主キーが欠落すると修復不能な不整合になる                     |
| `required_code_missing`                                                                         | blocking | project/customer/vendor code は業務キー・外部連携キーとして必須                      |
| `duplicate_project_code` / `duplicate_customer_code` / `duplicate_vendor_code`                  | blocking | 一意であるべき業務コードの重複は参照先を一意に決定できない                           |
| `orphan_time_entry_project` / `orphan_billing_line_invoice` / `orphan_accounting_journal_event` | blocking | 参照切れは画面・集計・会計出力で一意に異常と判定できる                               |
| `invoice_currency_missing` / `billing_tax_rate_missing`                                         | blocking | 請求・税務/会計出力に必要なコード欠落であり、下流処理の前提を満たさない              |
| `invoice_header_line_total_mismatch`                                                            | blocking | header合計とline合計の差分は請求金額の決定的な不整合                                 |
| `accounting_event_source_key_duplicate`                                                         | blocking | `AccountingEvent` の `sourceTable/sourceId/eventKind` 一意制約に対応する重複連携キー |
| `accounting_journal_ready_missing_side`                                                         | blocking | `ready` 仕訳行が借方/貸方のいずれも持たない状態はCSV出力不能                         |
| `accounting_journal_ready_export_field_missing`                                                 | blocking | ICS export が必須とする `taxCode` と正の `amount` を欠く `ready` 行は出力不能        |
| `accounting_journal_debit_credit_mismatch`                                                      | blocking | 通貨別の単側 `ready` 仕訳行の借方合計と貸方合計が一致しない状態は会計出力不能        |
| `statutory_accounting_import_count_mismatch`                                                    | blocking | import batch の期待件数と実件数が一致しない migration/import integrity 異常          |
| `time_entries_daily_over_1440`                                                                  | advisory | 閾値超過は業務確認対象だが、例外勤務や入力補正の判断を含む                           |
| `invoice_number_format_invalid` / `purchase_order_number_format_invalid`                        | advisory | 番号規約の逸脱は改善候補だが、既存データ・運用移行期の許容判断を含む                 |

現行モデルでは `AccountingJournalStaging` が借方金額・貸方金額を別フィールドでは持たず、`amount` と借方/貸方科目コードの有無で片側明細を表現する。借方・貸方の両コードを持つ行は行内で自己均衡しているものとして扱い、複合仕訳の単側 `ready` 行について、通貨別に借方科目を持つ行の `amount` 合計と貸方科目を持つ行の `amount` 合計を比較する。`status=ready` 行は ICS export の `validateReadyRow()` と同様に `taxCode` と正の `amount` も必須とする。

### Release Candidate readiness runner

- 標準入口: `RELEASE_E2E_SCOPE=core make release-readiness` / `RELEASE_E2E_SCOPE=full make release-readiness`
- 正式repo-side証跡: `RELEASE_E2E_SCOPE=full make release-readiness-record`
  - `full` E2E以外では `docs/test-results/` の正式release readiness証跡を作成しない
  - clean checkout 以外では正式証跡を作成しない。`--allow-dirty` / `RELEASE_ALLOW_DIRTY=1` は調査用であり、`--record` と併用しない
  - `tmp/release-readiness/*/summary.md` は限定・調査用証跡であり、release Go の正式 repo-side 証跡は `docs/test-results/YYYY-MM-DD-release-readiness-rN.md` のみとする
  - 既定の日付は `RELEASE_TIMEZONE=Asia/Tokyo` のJST基準。必要な場合だけ `DATE_STAMP=YYYY-MM-DD` で明示する
  - raw log は `tmp/release-readiness/` に置き、コミット対象のMarkdownにはsecret値・private pathを含めない
- runner は required check の `PASS` / `FAIL` / `SKIP`、command、exit code、duration、raw log参照を記録する
- release readiness runner は CI / backend の prisma generate / format / validate も明示的に実行する
- runner の `CI job` 欄は GitHub Actions required checks との対応先を示す参照情報であり、workflow を完全再実行するものではない。GitHub Actions の CI / Link Check / CodeQL は引き続きPR上の正本として扱う
- repo-side readiness と target-environment readiness は分離する。#1426 / #544 / #1432 が未完了の場合、runner成功だけでは総合Goにしない

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

coverage gate は `coverage-summary.json` を入力にする段階導入方式とする。全体 coverage を一律 gate 化せず、重要 subset ごとに対象ファイルを明示する。

| scope        | CI job               | summary                                                        | threshold source                             | 現行閾値                                                       |
| ------------ | -------------------- | -------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| auth         | `CI / coverage-auth` | `packages/backend/coverage/auth/coverage-summary.json`         | `packages/backend/coverage-thresholds.json`  | statements/lines 89.7%、branches 70.5%、functions 97.9%        |
| integrations | `CI / backend`       | `packages/backend/coverage/integrations/coverage-summary.json` | `packages/backend/coverage-thresholds.json`  | statements/lines 91.1%、branches 72.7%、functions 97.0%        |
| chat         | `CI / backend`       | `packages/backend/coverage/chat/coverage-summary.json`         | `packages/backend/coverage-thresholds.json`  | statements/lines 53.4%、branches 59.4%、functions 70.1%        |
| projects     | `CI / backend`       | `packages/backend/coverage/projects/coverage-summary.json`     | `packages/backend/coverage-thresholds.json`  | statements/lines 66.2%、branches 59.5%、functions 77.8%        |
| ui-core      | `CI / frontend`      | `packages/frontend/coverage/ui-core/coverage-summary.json`     | `packages/frontend/coverage-thresholds.json` | statements 68.2%、lines 70.6%、branches 61.1%、functions 67.3% |

auth scope の対象ファイルは `packages/backend/coverage-thresholds.json` の `auth.files` を正とし、`src/plugins/auth.ts`、`src/application/auth/localIdentityShared.ts`、`src/application/auth/localIdentityUseCases.ts`、`src/routes/auth.ts`、`src/routes/auth/googleSessionRoutes.ts`、`src/routes/auth/http.ts`、`src/routes/auth/localAuthRoutes.ts`、`src/routes/auth/localCredentialAdminRoutes.ts`、`src/routes/auth/localIdentityHttp.ts`、`src/routes/auth/localIdentitySchemas.ts`、`src/routes/auth/userIdentityAdminRoutes.ts`、`src/services/authContext.ts`、`src/services/authGateway.ts`、`src/services/envValidation.ts`、`src/services/localCredentials.ts`、`src/utils/authGroupToRoleMap.ts` を対象にする。

`auth.files` の completeness は `coverageThresholds.test.js` が `src/routes/auth/*.ts`、`src/application/auth/*.ts`、および必須 auth service / plugin / utility を実ファイル一覧から再構成して検査する。設定済みファイルが削除・リネームされている場合は、coverage checker が coverage summary 読み込み前に `coverage configured file does not exist` として失敗させる。

integrations scope の初期対象ファイルは `packages/backend/coverage-thresholds.json` の `integrations.files` を正とし、`src/routes/integrations.ts` と #1880/#1881 で抽出済みの integrations 関連 service を対象にする。新しい `integration*.ts` service または既存命名規約の関連 service を追加した場合、`coverageThresholds.test.js` が `integrations.files` の更新漏れを検知する。

chat scope の初期対象ファイルは `packages/backend/coverage-thresholds.json` の `chat.files` を正とし、`src/routes/chat.ts`、`src/routes/chatRooms.ts`、`src/routes/chat/**`、`src/routes/chatRooms/**`、chat関連service、`src/application/chat/**`、`src/adapters/notifications/chatNotificationAdapter.ts` を対象にする。新しい chat route module / service / application file を追加した場合、`coverageThresholds.test.js` が `chat.files` の更新漏れを検知する。設定済みファイルの削除・リネームは coverage checker の stale file 検査で失敗する。

ui-core scope の対象ファイルは `packages/frontend/coverage-thresholds.json` の `ui-core.files` を正とし、共通 utility / UI、主要画面、AdminSettings / RoomChat の component・model・server-state hook を対象にする。AdminSettings / RoomChat 配下の production file を追加・削除した場合、`frontend-quality-gates.test.mjs` の completeness / stale file test が更新漏れを検知する。`coverage:ui-core:check` は summary から設定ファイルだけを再集計し、対象外 UI 追加で分母が恣意的に変わらないようにする。

拡大時は以下を同一 PR で更新する。

1. 対象 subset の coverage script
2. `packages/backend/coverage-thresholds.json` または `packages/frontend/coverage-thresholds.json` の scope と閾値
3. `.github/workflows/ci.yml` の coverage job または既存 job の対象
4. 本ドキュメントと `docs/quality/test-gaps.md`

## ローカルでの実行（例）

### 統一コマンド（Makefile）

- `make lint`
- `make format-check`
- `make docs-test-results-index-check`
- `make data-quality-test`
- `make data-quality-blocking`
- `make data-quality-advisory`
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
- frontend: `npm run test --prefix packages/frontend`

### Data Quality

- test: `npm run data-quality:test --prefix packages/backend`
- blocking: `npm run data-quality:blocking --prefix packages/backend`
- advisory: `npm run data-quality:advisory --prefix packages/backend`
- 意図的な失敗確認（PR本文に必要な場合）:
  - `node scripts/data-quality-check.mjs --mode=blocking --fixture scripts/fixtures/data-quality-invalid.json --output tmp/data-quality-invalid.json --summary tmp/data-quality-invalid.md`
  - 上記は blocking finding を検出して終了コード 1 になることが期待値

### E2E（検証環境はPodman前提）

- `scripts/e2e-frontend.sh`（既定で Podman DB を利用）
  - 例: `E2E_SCOPE=core E2E_CAPTURE=0 scripts/e2e-frontend.sh`

### スモーク/整合チェック（任意だが推奨）

- backendスモーク: `scripts/smoke-backend.sh`
- DB整合: `CONTAINER_NAME=erp4-pg-poc HOST_PORT=55432 scripts/podman-poc.sh check`
- チャット添付AV（ClamAV/clamd）:
  - `bash scripts/podman-clamav.sh check`
  - `bash scripts/smoke-chat-attachments-av.sh`

# テスト結果インデックス

## 方針

- 日付単位で `docs/test-results/YYYY-MM-DD-*.md` を作成する。
- 画面キャプチャなどの証跡は `docs/test-results/YYYY-MM-DD-*/` に保存する。
- 同日複数回の再取得は `YYYY-MM-DD-frontend-e2e-rN`（r1/r2...）を使用し、上書きしない。
- UI証跡の取得は `./scripts/e2e-ui-evidence.sh` の利用を推奨する。
- 運用判定の事前テンプレートは `docs/test-results/*-template.md` を利用する。

## 一覧

### Performance

- 入口: docs/test-results/perf/README.md

### Template

- PO移行リハーサル記録テンプレート: docs/test-results/po-migration-rehearsal-template.md
- S3バックアップ readiness 記録テンプレート: docs/test-results/backup-s3-readiness-template.md
- ESLint10 readiness 記録テンプレート: docs/test-results/eslint10-readiness-template.md
- Dependabot alerts 監視記録テンプレート: docs/test-results/dependabot-alerts-template.md
- ActionPolicy phase3 readiness 記録テンプレート: docs/test-results/action-policy-phase3-readiness-template.md
- ActionPolicy phase3 cutover 記録テンプレート: docs/test-results/action-policy-phase3-cutover-template.md
- チャット添付AV（Staging）検証テンプレート: docs/test-results/chat-attachments-av-staging-template.md
- DRリストア運用検証テンプレート: docs/test-results/dr-restore-template.md
- モバイル回帰証跡テンプレート: docs/test-results/mobile-regression-template.md

### 2026-03-02

- ISSUE #1293 品質強化証跡: docs/test-results/2026-03-02-issue-1293-leave-quality.md

### 2026-03-03

- ISSUE #1299 初回実行証跡（Phase 1-3）: docs/test-results/2026-03-03-issue-1299-phase1.md

### 2026-03-08

- ActionPolicy phase3 readiness 記録 r1: docs/test-results/2026-03-08-action-policy-phase3-readiness-r1.md
- ActionPolicy phase3 cutover 記録 r1: docs/test-results/2026-03-08-action-policy-phase3-cutover-r1.md
- S3バックアップ readiness 記録 r1: docs/test-results/2026-03-08-backup-s3-readiness-r1.md
- Dependabot alerts 監視記録 r1: docs/test-results/2026-03-08-dependabot-alerts-r1.md
- ESLint10 readiness 記録 r1: docs/test-results/2026-03-08-eslint10-readiness-r1.md

### 2026-02-06

- チャット添付AV（ClamAV/clamd）再検証 r2: docs/test-results/2026-02-06-chat-attachments-av-r2.md

### 2026-02-05

- フロントE2E(UIエビデンス r1): docs/test-results/2026-02-05-frontend-e2e-r1.md
- 証跡: docs/test-results/2026-02-05-frontend-e2e-r1/

### 2026-01-19

- フロントE2E(フル + UIエビデンス r1): docs/test-results/2026-01-19-frontend-e2e-r1.md
- 証跡: docs/test-results/2026-01-19-frontend-e2e-r1/
- PWA/Push運用検証: docs/test-results/2026-01-19-pwa-push-ops.md
- 証跡: docs/test-results/2026-01-19-frontend-e2e-pwa-push/

### 2026-01-24

- PO移行リハーサルr1: docs/test-results/2026-01-24-po-migration-r1.md

### 2026-01-17

- 性能ベースライン: docs/test-results/perf-2026-01-17.md

### 2026-01-16

- チャット添付AV（ClamAV/clamd）: docs/test-results/2026-01-16-chat-attachments-av.md

### 2026-01-15

- フロントE2E(フル + UIエビデンス): docs/test-results/2026-01-15-frontend-e2e.md
- 証跡: docs/test-results/2026-01-15-frontend-e2e/
- フロントE2E(フル + UIエビデンス r2): docs/test-results/2026-01-15-frontend-e2e-r2.md
- 証跡: docs/test-results/2026-01-15-frontend-e2e-r2/

### 2026-01-12

- フロントE2E(extended): docs/test-results/2026-01-12-frontend-e2e.md

### 2026-01-08

- バックアップ/リストア: docs/test-results/2026-01-08-backup-restore.md
- バックエンドスモーク: docs/test-results/2026-01-08-backend-smoke.md
- フロントE2E(フルスコープ): docs/test-results/2026-01-08-frontend-e2e.md
- 証跡: docs/test-results/2026-01-08-frontend-e2e/

### 2026-01-07

- Phase 3 PoC評価: docs/test-results/2026-01-07-phase3-poc-eval.md
- 証跡: docs/test-results/2026-01-07-phase3-poc-eval/

### 2026-01-06

- フロントE2E: docs/test-results/2026-01-06-frontend-e2e.md
- フロント手動チェック: docs/test-results/2026-01-06-frontend-check.md
- バックエンドスモーク: docs/test-results/2026-01-06-backend-smoke.md
- HR/CRM運用検証: docs/test-results/2026-01-06-hr-crm-ops.md
- Lint/Format: docs/test-results/2026-01-06-lint-format.md
- PWA/Push運用検証: docs/test-results/2026-01-06-pwa-push-ops.md
- レポート配信運用検証: docs/test-results/2026-01-06-report-delivery-ops.md
- 証跡: docs/test-results/2026-01-06-frontend-e2e/

### 2026-01-05

- バックアップ/リストア: docs/test-results/2026-01-05-backup-restore.md

### 2026-01-04

- バックエンドスモーク: docs/test-results/2026-01-04-backend-smoke.md

# テスト結果インデックス

## 方針

- 日付単位で `docs/test-results/YYYY-MM-DD-*.md` を作成する。
- 画面キャプチャなどの証跡は `docs/test-results/YYYY-MM-DD-*/` に保存する。
- 同日複数回の再取得は `YYYY-MM-DD-frontend-e2e-rN`（r1/r2...）を使用し、上書きしない。
- UI証跡の取得は `./scripts/e2e-ui-evidence.sh` の利用を推奨する。
- 運用判定の事前テンプレートは `docs/test-results/*-template.md` を利用する。

## 一覧

<!-- test-results-index:start -->

> この一覧は `node scripts/check-test-results-index.mjs --write` で生成します。手編集した場合は `make docs-test-results-index-check` で差分を確認してください。

### Performance

- [Performance results (2026-01-17)](perf-2026-01-17.md)
- [Performance evidence index](perf/README.md)

### Template

- [ActionPolicy phase3 cutover 記録テンプレート](action-policy-phase3-cutover-template.md)
- [ActionPolicy phase3 readiness 記録テンプレート](action-policy-phase3-readiness-template.md)
- [ActionPolicy phase3 target-environment trial 記録テンプレート](action-policy-phase3-target-trial-template.md)
- [S3-compatible backup readiness 記録テンプレート](backup-s3-readiness-template.md)
- [S3-compatible backup/restore 実証跡テンプレート](backup-s3-restore-template.md)
- [チャット添付AV（Staging）検証テンプレート](chat-attachments-av-staging-template.md)
- [DBバックアップ健全性確認 記録テンプレート](db-backup-health-template.md)
- [Dependabot alerts 監視記録テンプレート](dependabot-alerts-template.md)
- [DR復元演習 結果テンプレート](dr-restore-template.md)
- [ESLint10 readiness 記録テンプレート](eslint10-readiness-template.md)
- [External CSV artifact intake 記録テンプレート](external-csv-artifact-intake-template.md)
- [モバイル回帰証跡テンプレート（design-system適用後）](mobile-regression-template.md)
- [PO移行リハーサル結果テンプレート](po-migration-rehearsal-template.md)
- [Release Backup Evidence Template](release-backup-evidence-template.md)
- [Release Candidate Readiness Evidence Template](release-readiness-template.md)
- [さくらVPS 試験稼働記録テンプレート](sakura-vps-trial-template.md)
- [Storage artifact migration evidence template](storage-artifact-migration-template.md)

### 2026-07-22

- [Issue #1977 Storage artifact foundation verification](2026-07-22-issue1977-storage-artifact-foundation.md)
- [Issue #1977 Storage context runtime integration verification](2026-07-22-issue1977-storage-context-integration.md)

### 2026-07-14

- [Issue #1958 Chat route split verification](2026-07-14-issue1958-chat-route-split.md)
- [Issue #1959 Report Subscriptions Application Boundary Verification](2026-07-14-issue1959-report-subscriptions-service.md)
- [Issue #1961 migrate-po parser / encoding / ID pure module verification](2026-07-14-issue1961-migrate-po-parser-id.md)
- [Issue #1962 migrate-po domain mapping / validation / report verification](2026-07-14-issue1962-migrate-po-domain.md)
- [Issue #1963 migrate-po CLI orchestration / fixture gate verification](2026-07-14-issue1963-migrate-po-cli-fixtures.md)
- [Issue #1964 Workflow focused coverage gate 検証記録](2026-07-14-issue1964-workflow-coverage-gate.md)

### 2026-07-13

- [Architecture debt baseline r1 (Issue #1928 repo-side)](2026-07-13-architecture-debt-baseline-r1.md)
- [Issue #1908 Auth Quality Gates Verification](2026-07-13-issue1908-auth-quality-gates.md)
- [Issue #1909 Chat room provisioning / lifecycle / membership extraction verification](2026-07-13-issue1909-chat-room-services.md)
- [Issue #1910 Chat notification port / application effects verification](2026-07-13-issue1910-chat-notification-boundary.md)
- [Issue #1911 Chat route split and quality gate verification](2026-07-13-issue1911-chat-quality-gate.md)
- [Issue #1912 Projects application boundary verification](2026-07-13-issue1912-projects-application-boundary.md)
- [Issue #1913 Projects task / WBS / dependency extraction verification](2026-07-13-issue1913-project-task-boundary.md)
- [Issue #1914 Projects milestone / recurring template extraction verification](2026-07-13-issue1914-project-milestone-recurring-boundary.md)
- [Issue #1915 Projects coverage gate verification](2026-07-13-issue1915-projects-coverage-gate.md)
- [Issue #1916 TimeEntries application boundary verification](2026-07-13-issue1916-timeentries-application-boundary.md)
- [Issue #1917 Invoice application boundary verification](2026-07-13-issue1917-invoice-application-boundary.md)
- [Issue #1918 Estimate application boundary verification](2026-07-13-issue1918-estimate-application-boundary.md)
- [Issue #1919 Purchase order application boundary verification](2026-07-13-issue1919-purchase-order-application-boundary.md)
- [Issue #1920 VendorDocs application boundary verification](2026-07-13-issue1920-vendor-docs-application-boundary.md)
- [Issue #1921 Leave application boundary verification](2026-07-13-issue1921-leave-application-boundary.md)
- [Issue #1922 Send application boundary verification](2026-07-13-issue1922-send-application-boundary.md)
- [Issue #1923 RoomChat server-state boundary verification](2026-07-13-issue1923-roomchat-server-state.md)
- [Issue #1924 AdminSettings resource hook / form-state boundary verification](2026-07-13-issue1924-adminsettings-resource-hooks.md)
- [Issue #1925 frontend max-lines / UI core coverage gate verification](2026-07-13-issue1925-frontend-quality-gates.md)
- [Issue #1926 Identity side-effect adapter verification](2026-07-13-issue1926-identity-side-effects.md)
- [Issue #1927 Workflow outbound ports/adapters verification](2026-07-13-issue1927-workflow-outbound-ports.md)

### 2026-07-12

- [Issue #1906 Auth Boundary Refactor Verification](2026-07-12-issue1906-auth-boundary.md)
- [Issue #1907 Local Identity Application Service Verification](2026-07-12-issue1907-auth-local-identity.md)

### 2026-07-02

- [Issue #1857 frontend split verification](2026-07-02-frontend-split-1857.md)
- [UX/UI follow-up #1847: accessibility, keyboard, and screen-reader audit](2026-07-02-uiux-followup-a11y-audit.md)
  - 証跡: [docs/test-results/2026-07-02-uiux-followup-a11y-audit/](2026-07-02-uiux-followup-a11y-audit/)
- [UX/UI follow-up #1849: frontend bundle and chunk warning](2026-07-02-uiux-followup-bundle-chunk.md)
  - 証跡: [docs/test-results/2026-07-02-uiux-followup-bundle-chunk/](2026-07-02-uiux-followup-bundle-chunk/)
- [UX/UI follow-up visual regression evidence](2026-07-02-uiux-followup-visual-regression.md)
- [UX/UI follow-up #1848: workflowUx primitive and token hardening](2026-07-02-uiux-followup-workflow-ux-tokens.md)
- [2026-07-02 UI/UX Phase 2 Billing and Vendor Evidence](2026-07-02-uiux-phase2-billing-vendor.md)
  - 証跡: [docs/test-results/2026-07-02-uiux-phase2-billing-vendor/](2026-07-02-uiux-phase2-billing-vendor/)
- [2026-07-02 UI/UX Phase 3 Leave and Approval Evidence](2026-07-02-uiux-phase3-leave-approvals.md)
  - 証跡: [docs/test-results/2026-07-02-uiux-phase3-leave-approvals/](2026-07-02-uiux-phase3-leave-approvals/)
- [UX/UI Phase 4 - レポート・HR分析 検証結果](2026-07-02-uiux-phase4-reports-analytics.md)
  - 証跡: [docs/test-results/2026-07-02-uiux-phase4-reports-analytics/](2026-07-02-uiux-phase4-reports-analytics/)
- [UX/UI Phase 5 - ルームチャット・監査閲覧 検証結果](2026-07-02-uiux-phase5-chat-audit.md)
  - 証跡: [docs/test-results/2026-07-02-uiux-phase5-chat-audit/](2026-07-02-uiux-phase5-chat-audit/)
- [UX/UI Phase 6 - マスタ管理・運用ジョブ 検証結果](2026-07-02-uiux-phase6-master-jobs.md)
  - 証跡: [docs/test-results/2026-07-02-uiux-phase6-master-jobs/](2026-07-02-uiux-phase6-master-jobs/)
- [UX/UI Phase 7 - 設定画面 検証結果](2026-07-02-uiux-phase7-admin-settings.md)
  - 証跡: [docs/test-results/2026-07-02-uiux-phase7-admin-settings/](2026-07-02-uiux-phase7-admin-settings/)
- [UX/UI Phase 8 - PDF管理画面 検証結果](2026-07-02-uiux-phase8-pdf-files.md)
  - 証跡: [docs/test-results/2026-07-02-uiux-phase8-pdf-files/](2026-07-02-uiux-phase8-pdf-files/)
- [UI/UX Phase 9 Access Reviews Evidence - 2026-07-02](2026-07-02-uiux-phase9-access-reviews.md)
  - 証跡: [docs/test-results/2026-07-02-uiux-phase9-access-reviews/](2026-07-02-uiux-phase9-access-reviews/)
- [UI/UX Phase 10: Document send logs and audit logs](2026-07-02-uiux-phase10-document-audit-logs.md)
  - 証跡: [docs/test-results/2026-07-02-uiux-phase10-document-audit-logs/](2026-07-02-uiux-phase10-document-audit-logs/)
- [UI/UX Phase 11: Period locks](2026-07-02-uiux-phase11-period-locks.md)
  - 証跡: [docs/test-results/2026-07-02-uiux-phase11-period-locks/](2026-07-02-uiux-phase11-period-locks/)
- [UI/UX Phase 12 Dashboard Evidence](2026-07-02-uiux-phase12-dashboard.md)
  - 証跡: [docs/test-results/2026-07-02-uiux-phase12-dashboard/](2026-07-02-uiux-phase12-dashboard/)

### 2026-07-01

- [Expense settlement UX/UI implementation evidence - 2026-07-01](2026-07-01-expense-uiux.md)
  - 証跡: [docs/test-results/2026-07-01-expense-uiux/](2026-07-01-expense-uiux/)
- [Phase 1 daily/project UX/UI implementation evidence - 2026-07-01](2026-07-01-uiux-phase1-daily-project.md)
  - 証跡: [docs/test-results/2026-07-01-uiux-phase1-daily-project/](2026-07-01-uiux-phase1-daily-project/)

### 2026-03-23

- [2026-03-23 フロントE2E（管理設定 認証方式移行 UI エビデンス r1）](2026-03-23-frontend-e2e-r1.md)
  - 証跡: [docs/test-results/2026-03-23-frontend-e2e-r1/](2026-03-23-frontend-e2e-r1/)
- [2026-03-23 フロントE2E（Auth Gateway CurrentUser/認証セッション UI エビデンス r2）](2026-03-23-frontend-e2e-r2.md)
  - 証跡: [docs/test-results/2026-03-23-frontend-e2e-r2/](2026-03-23-frontend-e2e-r2/)

### 2026-03-19

- [証跡ディレクトリ: 2026-03-19-frontend-e2e](2026-03-19-frontend-e2e/)

### 2026-03-17

- [2026-03-17 フロントE2E（管理設定 会計マッピングルール UI エビデンス r1）](2026-03-17-frontend-e2e-r1.md)
  - 証跡: [docs/test-results/2026-03-17-frontend-e2e-r1/](2026-03-17-frontend-e2e-r1/)

### 2026-03-16

- [フロントE2E（管理設定/運用管理 UI エビデンス r1）](2026-03-16-frontend-e2e-r1.md)
  - 証跡: [docs/test-results/2026-03-16-frontend-e2e-r1/](2026-03-16-frontend-e2e-r1/)
- [2026-03-16 フロントE2E（レポート drilldown UI エビデンス r2）](2026-03-16-frontend-e2e-r2.md)
  - 証跡: [docs/test-results/2026-03-16-frontend-e2e-r2/](2026-03-16-frontend-e2e-r2/)
- [2026-03-16 フロントE2E（管理設定 連携ジョブ一覧 UI エビデンス r3）](2026-03-16-frontend-e2e-r3.md)
  - 証跡: [docs/test-results/2026-03-16-frontend-e2e-r3/](2026-03-16-frontend-e2e-r3/)
- [2026-03-16 フロントE2E（管理会計 CSV UI エビデンス r4）](2026-03-16-frontend-e2e-r4.md)
  - 証跡: [docs/test-results/2026-03-16-frontend-e2e-r4/](2026-03-16-frontend-e2e-r4/)

### 2026-03-09

- [ActionPolicy phase3 strict フロントE2E(core)](2026-03-09-action-policy-phase3-strict-frontend-e2e-core-r1.md)
- [ActionPolicy phase3 strict Podman smoke](2026-03-09-action-policy-phase3-strict-podman-smoke-r1.md)
- [フロントE2E(core)](2026-03-09-frontend-e2e-core.md)
- [フロントE2E（UIエビデンス r1）](2026-03-09-frontend-e2e-r1.md)
  - 証跡: [docs/test-results/2026-03-09-frontend-e2e-r1/](2026-03-09-frontend-e2e-r1/)
- [Podman smoke](2026-03-09-podman-smoke.md)

### 2026-03-08

- [ActionPolicy phase3 cutover 記録](2026-03-08-action-policy-phase3-cutover-r1.md)
- [ActionPolicy phase3 cutover 記録](2026-03-08-action-policy-phase3-cutover-r2.md)
- [ActionPolicy phase3 readiness 記録](2026-03-08-action-policy-phase3-readiness-r1.md)
- [ActionPolicy phase3 readiness 記録](2026-03-08-action-policy-phase3-readiness-r2.md)
- [S3バックアップ Readiness 記録](2026-03-08-backup-s3-readiness-r1.md)
- [Dependabot alerts 監視記録](2026-03-08-dependabot-alerts-r1.md)
- [ESLint10 readiness 記録](2026-03-08-eslint10-readiness-r1.md)

### 2026-03-03

- [ISSUE #1299 実行証跡（Phase 1-3 初回）](2026-03-03-issue-1299-phase1.md)

### 2026-03-02

- [ISSUE #1293 品質強化の証跡（2026-03-02）](2026-03-02-issue-1293-leave-quality.md)

### 2026-02-26

- [モバイル回帰証跡テンプレート（design-system適用後）](2026-02-26-mobile-regression-r1.md)
  - 証跡: [docs/test-results/2026-02-26-mobile-regression-r1/](2026-02-26-mobile-regression-r1/)

### 2026-02-18

- [IDOR smoke test result (2026-02-18)](2026-02-18-idor-smoke.md)
- [Secrets Rotation Drill (2026-02-18)](2026-02-18-secrets-rotation-drill.md)

### 2026-02-17

- [Audit Low Triage (R2) - 2026-02-17](2026-02-17-audit-low-triage-r2.md)
- [2026-02-17 Code Review Baseline R2](2026-02-17-code-review-baseline-r2.md)
- [証跡ディレクトリ: 2026-02-17-code-review-baseline-r2-logs](2026-02-17-code-review-baseline-r2-logs/)
- [E2E Frontend Smoke 分割計画（R2 / Lane C）](2026-02-17-e2e-smoke-split-plan-r2.md)
- [2026-02-17 E2E Flaky Stabilization (Issue #993)](2026-02-17-flaky-stabilization.md)
- [品質向上R2: Lane D/E 調査結果（2026-02-17）](2026-02-17-hotspot-nonfunctional-plan-r2.md)
- [2026-02-17 仕様⇔実装トレーサビリティ差分対応方針（Issue #993）](2026-02-17-spec-traceability-decision.md)
- [2026-02-17 Test Gap Triage R2](2026-02-17-test-gap-triage-r2.md)
- [UX最低ライン 棚卸し（R2） - 2026-02-17](2026-02-17-ux-quality-baseline-r2.md)

### 2026-02-16

- [2026-02-16 Code Review Baseline](2026-02-16-code-review-baseline.md)
- [2026-02-16 仕様実装トレーサビリティ（初回棚卸）](2026-02-16-spec-traceability-initial.md)
- [2026-02-16 Static Review Findings](2026-02-16-static-review-findings.md)

### 2026-02-12

- [Issue #941 回帰確認（design-system v1.1.0）](2026-02-12-issue-941-design-system-regression.md)
- [新UIパーツ取込後の確認（E2E/マニュアル）](2026-02-12-ui-parts-e2e-manual-check.md)

### 2026-02-11

- [証跡ディレクトリ: 2026-02-11-frontend-e2e](2026-02-11-frontend-e2e/)
- [Issue #933 検証記録（2026-02-11）](2026-02-11-issue-933-validation.md)

### 2026-02-09

- [チャット添付AV（staging）検証](2026-02-09-chat-attachments-av-staging.md)

### 2026-02-06

- [チャット添付AV（ClamAV/clamd）再検証（r2）](2026-02-06-chat-attachments-av-r2.md)

### 2026-02-05

- [フロントE2E（UIエビデンス r1）](2026-02-05-frontend-e2e-r1.md)
  - 証跡: [docs/test-results/2026-02-05-frontend-e2e-r1/](2026-02-05-frontend-e2e-r1/)

### 2026-01-24

- [PO移行リハーサル（SQLダンプ）結果 2026-01-24](2026-01-24-po-migration-r1.md)

### 2026-01-19

- [証跡ディレクトリ: 2026-01-19-frontend-e2e-pwa-push](2026-01-19-frontend-e2e-pwa-push/)
- [フロントE2E（full + UIエビデンス r1）](2026-01-19-frontend-e2e-r1.md)
  - 証跡: [docs/test-results/2026-01-19-frontend-e2e-r1/](2026-01-19-frontend-e2e-r1/)
- [PWA/Push 運用検証（2026-01-19）](2026-01-19-pwa-push-ops.md)

### 2026-01-16

- [テスト結果 2026-01-16 チャット添付AV（ClamAV/clamd）](2026-01-16-chat-attachments-av.md)

### 2026-01-15

- [フロントE2E（full + UIエビデンス）](2026-01-15-frontend-e2e.md)
  - 証跡: [docs/test-results/2026-01-15-frontend-e2e/](2026-01-15-frontend-e2e/)
- [フロントE2E（full + UIエビデンス r2）](2026-01-15-frontend-e2e-r2.md)
  - 証跡: [docs/test-results/2026-01-15-frontend-e2e-r2/](2026-01-15-frontend-e2e-r2/)

### 2026-01-12

- [フロントE2E（extended）](2026-01-12-frontend-e2e.md)

### 2026-01-08

- [テスト結果 2026-01-08 バックエンドスモーク](2026-01-08-backend-smoke.md)
- [テスト結果 2026-01-08 バックアップ/リストア](2026-01-08-backup-restore.md)
- [テスト結果 2026-01-08 フロントE2E](2026-01-08-frontend-e2e.md)
  - 証跡: [docs/test-results/2026-01-08-frontend-e2e/](2026-01-08-frontend-e2e/)

### 2026-01-07

- [Phase 3 PoC 評価（2026-01-07）](2026-01-07-phase3-poc-eval.md)
  - 証跡: [docs/test-results/2026-01-07-phase3-poc-eval/](2026-01-07-phase3-poc-eval/)

### 2026-01-06

- [テスト結果 2026-01-06 バックエンドスモーク](2026-01-06-backend-smoke.md)
- [テスト結果 2026-01-06 フロント簡易確認](2026-01-06-frontend-check.md)
- [テスト結果 2026-01-06 フロントE2E](2026-01-06-frontend-e2e.md)
  - 証跡: [docs/test-results/2026-01-06-frontend-e2e/](2026-01-06-frontend-e2e/)
- [HR/CRM 連携 運用検証（2026-01-06）](2026-01-06-hr-crm-ops.md)
- [テスト結果 2026-01-06 Lint/Format](2026-01-06-lint-format.md)
- [PWA/Push 運用検証（2026-01-06）](2026-01-06-pwa-push-ops.md)
- [レポート配信 運用検証（2026-01-06）](2026-01-06-report-delivery-ops.md)

### 2026-01-05

- [バックアップ/リストア検証（2026-01-05）](2026-01-05-backup-restore.md)

### 2026-01-04

- [テスト結果 2026-01-04 バックエンドスモーク](2026-01-04-backend-smoke.md)

<!-- test-results-index:end -->

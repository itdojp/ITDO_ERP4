# UI 画面カバレッジ（マニュアル/証跡）

## 目的
- PoC の UI（セクション）に対して、**操作マニュアル**と**画面キャプチャ（証跡）**の対応関係を追跡する
- 未カバーの画面/状態を発見し、追加作業を計画できるようにする

## 最新の証跡
- 最新の証跡ディレクトリは `docs/manual/ui-manual.md`（分冊入口）の「証跡」セクションを参照
  - 必要に応じて `docs/manual/ui-manual-user.md` / `docs/manual/ui-manual-admin.md` の前提も参照

## 画面（セクション）一覧
| 画面（UIセクション） | 対象ロール（目安） | 証跡（スクショ） | 操作マニュアル（主要） |
| --- | --- | --- | --- |
| 現在のユーザー（簡易ログイン/オフライン/PWA） | user/admin/mgmt/exec/hr | `docs/test-results/2026-02-05-frontend-e2e-r1/00-current-user.png` | `docs/manual/ui-manual-user.md` / `docs/manual/ui-manual-admin.md` |
| Push通知（購読登録/解除/再登録） | user/admin/mgmt/exec/hr | `docs/test-results/2026-01-19-frontend-e2e-pwa-push/17-push-registered.png`<br>`docs/test-results/2026-01-19-frontend-e2e-pwa-push/18-push-unsubscribed.png`<br>`docs/test-results/2026-01-19-frontend-e2e-pwa-push/19-push-resubscribed.png` | `docs/manual/ui-manual-user.md` / `docs/manual/ui-manual-admin.md` |
| Dashboard | user/admin/mgmt/exec/hr | `docs/test-results/2026-02-05-frontend-e2e-r1/01-core-dashboard.png` | `docs/manual/ui-manual-user.md` / `docs/manual/ui-manual-admin.md` |
| 検索（ERP横断） | user/admin/mgmt/exec/hr | `docs/test-results/2026-02-05-frontend-e2e-r1/06-core-global-search.png` | `docs/manual/ui-manual-user.md` / `docs/manual/ui-manual-admin.md` |
| 日報 + ウェルビーイング | user（入力）/ hr（閲覧） | `docs/test-results/2026-02-05-frontend-e2e-r1/02-core-daily-report.png` | `docs/manual/ui-manual-user.md` / `docs/manual/hr-guide.md` |
| 工数入力 | user | `docs/test-results/2026-02-05-frontend-e2e-r1/03-core-time-entries.png` | `docs/manual/ui-manual-user.md` |
| タスク | user / leader | `docs/test-results/2026-02-05-frontend-e2e-r1/21-project-tasks.png` | `docs/manual/ui-manual-user.md` / `docs/manual/project-leader-guide.md` |
| 経費入力 | user | `docs/test-results/2026-02-05-frontend-e2e-r1/04-core-expenses.png` | `docs/manual/ui-manual-user.md` |
| 休暇 | user | `docs/test-results/2026-02-05-frontend-e2e-r1/22-leave-requests.png` | `docs/manual/ui-manual-user.md` |
| 見積 | user / mgmt | `docs/test-results/2026-02-05-frontend-e2e-r1/05-core-estimates.png` | `docs/manual/ui-manual-user.md` / `docs/manual/accounting-guide.md` |
| 請求 | user / mgmt | `docs/test-results/2026-02-05-frontend-e2e-r1/06-core-invoices.png` | `docs/manual/ui-manual-user.md` / `docs/manual/accounting-guide.md` |
| 仕入/発注（一覧） | mgmt / admin | `docs/test-results/2026-02-05-frontend-e2e-r1/06-vendor-docs.png` | `docs/manual/ui-manual-admin.md` / `docs/manual/accounting-guide.md` |
| 仕入/発注（作成） | mgmt / admin | `docs/test-results/2026-02-05-frontend-e2e-r1/06-vendor-docs-create.png` | `docs/manual/ui-manual-admin.md` / `docs/manual/accounting-guide.md` |
| Reports | admin / mgmt / exec | `docs/test-results/2026-02-05-frontend-e2e-r1/08-reports.png` | `docs/manual/ui-manual-admin.md` / `docs/manual/reporting-guide.md` |
| 承認一覧 | mgmt / exec | `docs/test-results/2026-02-05-frontend-e2e-r1/07-approvals.png` | `docs/manual/ui-manual-admin.md` / `docs/manual/approval-operations.md` |
| Chat break-glass（監査閲覧） | admin / mgmt / exec | `docs/test-results/2026-02-05-frontend-e2e-r1/24-chat-break-glass.png` | `docs/manual/ui-manual-admin.md` / `docs/manual/chat-guide.md` |
| 案件（一覧） | admin / mgmt | `docs/test-results/2026-02-05-frontend-e2e-r1/09-projects.png` | `docs/manual/ui-manual-admin.md` / `docs/manual/project-leader-guide.md` |
| 案件メンバー | admin / mgmt / leader | `docs/test-results/2026-02-05-frontend-e2e-r1/09-project-members.png` | `docs/manual/ui-manual-admin.md` / `docs/manual/project-leader-guide.md` |
| マイルストーン | admin / mgmt / leader | `docs/test-results/2026-02-05-frontend-e2e-r1/23-project-milestones.png` | `docs/manual/ui-manual-admin.md` / `docs/manual/project-leader-guide.md` |
| 顧客/業者マスタ | admin / mgmt | `docs/test-results/2026-02-05-frontend-e2e-r1/10-master-data.png` | `docs/manual/ui-manual-admin.md` |
| Settings（管理設定） | admin / mgmt | `docs/test-results/2026-02-05-frontend-e2e-r1/11-admin-settings.png` | `docs/manual/ui-manual-admin.md` |
| 運用ジョブ | admin | `docs/test-results/2026-02-05-frontend-e2e-r1/25-admin-jobs.png` | `docs/manual/ui-manual-admin.md` |
| ドキュメント送信ログ | admin / mgmt | `docs/test-results/2026-02-05-frontend-e2e-r1/26-document-send-logs.png` | `docs/manual/ui-manual-admin.md` / `docs/manual/accounting-guide.md` |
| PDFファイル一覧 | admin / mgmt | `docs/test-results/2026-02-05-frontend-e2e-r1/27-pdf-files.png` | `docs/manual/ui-manual-admin.md` / `docs/manual/accounting-guide.md` |
| アクセス棚卸し | admin / mgmt | `docs/test-results/2026-02-05-frontend-e2e-r1/28-access-reviews.png` | `docs/manual/ui-manual-admin.md` |
| 監査ログ | admin / mgmt | `docs/test-results/2026-02-05-frontend-e2e-r1/29-audit-logs.png` | `docs/manual/ui-manual-admin.md` |
| 期間締め | admin / mgmt | `docs/test-results/2026-02-05-frontend-e2e-r1/30-period-locks.png` | `docs/manual/ui-manual-admin.md` |
| プロジェクトチャット | user | `docs/test-results/2026-02-05-frontend-e2e-r1/12-project-chat.png` | `docs/manual/ui-manual-user.md` / `docs/manual/chat-guide.md` |
| チャット（全社/部門/private_group/DM） | user / hr / 外部ユーザ（グループACL） | `docs/test-results/2026-02-05-frontend-e2e-r1/14-room-chat.png` | `docs/manual/ui-manual-user.md` / `docs/manual/chat-guide.md` |
| 匿名集計（人事向け） | hr | `docs/test-results/2026-02-05-frontend-e2e-r1/13-hr-analytics.png` | `docs/manual/ui-manual-admin.md` / `docs/manual/hr-guide.md` |

## 管理設定（詳細カード）
管理設定（Settings）はカードが多いため、主要カードは個別にキャプチャしています。
- `docs/test-results/2026-02-05-frontend-e2e-r1/11-chat-settings.png`
- `docs/test-results/2026-02-05-frontend-e2e-r1/11-chat-room-settings.png`
- `docs/test-results/2026-02-05-frontend-e2e-r1/11-scim-provisioning.png`
- `docs/test-results/2026-02-05-frontend-e2e-r1/11-rate-card.png`
- `docs/test-results/2026-02-05-frontend-e2e-r1/11-alert-settings.png`
- `docs/test-results/2026-02-05-frontend-e2e-r1/11-approval-rules.png`
- `docs/test-results/2026-02-05-frontend-e2e-r1/11-template-settings.png`
- `docs/test-results/2026-02-05-frontend-e2e-r1/11-report-subscriptions.png`
- `docs/test-results/2026-02-05-frontend-e2e-r1/11-integration-settings.png`

## 未カバー（追加候補）
現時点で「PoCの主要セクション（上表）」は証跡取得済みです。追加で網羅したい場合、以下を候補とします。
- Googleログイン（ボタン表示/成功フロー）: `VITE_GOOGLE_CLIENT_ID` 未設定だと UI に表示されません。
  - 設定値が揃った時点で、証跡用のE2E（または手動キャプチャ）を追加します。

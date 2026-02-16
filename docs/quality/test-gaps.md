# テストギャップ一覧（Test Gaps）

## 目的
主要領域ごとに「現状の自動テスト有無」と「優先度（A/B/C）」を整理し、追加すべきテストを追跡可能にする。

起点（手動確認）
- `docs/manual/manual-test-checklist.md`
- `packages/backend/src/tests/happy-path.md`

## 優先度の定義
- A: 回帰すると業務/運用に直撃する（PRゲートで検知したい）
- B: 重要だが当面は手動/限定範囲で許容（段階導入）
- C: 改善/拡張（後回しでよい）

## 領域別の整理（現状）
| 領域 | 代表シナリオ | 現状の自動テスト | 優先度 | 次の一手 |
| --- | --- | --- | --- | --- |
| PoC導線（UI） | ダッシュボード→日報→工数→請求 | Playwright E2E（`packages/frontend/e2e`） | A | 重要導線の最小ケースを安定化（flaky排除） |
| PoC導線（API） | プロジェクト/見積/請求/工数/経費のハッピーパス | E2E間接 + 手動スモーク（`scripts/smoke-backend.sh`） | A | unit/integration を追加し、APIの分岐を早期検知 |
| 承認（ルール/ステップ） | 金額閾値/定期案件/並列承認の判定 | backend unit（`packages/backend/test/approvalLogic.test.js`） | A | 追加の分岐（条件マッチ/順序正規化）を継続拡張 |
| 通知抑制（チャット） | `muteAllUntil` / `notifyMentions` / `notifyAllPosts` が通知作成を抑止 | backend unit（`packages/backend/test/chatMentionNotifications.test.js` / `packages/backend/test/chatAckReminders.test.js`） + E2E（`packages/frontend/e2e/backend-notification-suppression.spec.ts` ※ `approval_pending` / `approval_approved` / `approval_rejected` / `daily_report_missing` バイパス含む） | A | `chat_ack_escalation` など残りバイパス種別のE2Eを追加 |
| RBAC/可視範囲 | 非管理ロールの取得制限（self / project） | backend unit（一部: `packages/backend/test/rbac.test.js`） | A | 主要APIの integration を追加し、実動作も担保 |
| 期日/アラート | 納期・承認遅延・残業等の計算 | backend unit（一部: `packages/backend/test/dueDateRule.test.js`） | A | アラート閾値/集計の境界条件を追加 |
| レポート | 月次/案件別/個人別の集計 | E2E一部 + 手動 | B | 集計の境界条件を unit/integration で追加 |
| 移行（PO→ERP4） | dry-run / apply / 整合チェック | なし（手順のみ） | B | fixtures を用いた dry-run の自動化（実データはコミットしない） |
| バックアップ/リストア | dump→退避→復元 | なし（手順のみ） | B | Podman で最小の restore 検証を自動化し `docs/test-results/` に記録 |
| 添付（AV/ストレージ） | 422/503 などの挙動 | スモーク（`scripts/smoke-chat-attachments-av.sh`） | B | 本番有効化方針確定後にゲート化を検討（Issue #560） |

## 備考
- CI の実行条件/範囲は `docs/quality/quality-gates.md` を正とする。
- 追加したテストは、手動チェックリストのどの項目を代替するかを本ドキュメントで追跡する。

## 手動確認チェックリストとの対応（PoC）
`docs/manual/manual-test-checklist.md` の各項目について、現状の自動テスト/スモークの対応を整理する。

### バックエンド API
| 手動確認項目 | 自動テスト/スモーク（現状） | 備考 |
| --- | --- | --- |
| `POST /projects → /projects/:id/estimates → /projects/:id/invoices → /invoices/:id/send` | `scripts/smoke-backend.sh` / `packages/frontend/e2e/backend-manual-checklist.spec.ts @extended` |  |
| `POST/GET /time-entries`（非管理ロールは self のみ取得） | `packages/frontend/e2e/backend-time-invoice.spec.ts @core` / `packages/frontend/e2e/frontend-task-time-entry.spec.ts @core` / `packages/frontend/e2e/backend-manual-checklist.spec.ts @extended` | 非管理ロールの取得制限を追加カバー |
| `POST/GET /expenses`（非管理ロールは self のみ取得） | `packages/frontend/e2e/frontend-smoke.spec.ts @core` / `packages/frontend/e2e/backend-manual-checklist.spec.ts @extended` | 非管理ロールの取得制限を追加カバー |
| `/alert-settings` CRUD と `/jobs/alerts/run` で alert が保存される | `packages/frontend/e2e/frontend-smoke.spec.ts @core`（alert-settings 作成） / `scripts/smoke-backend.sh`（alerts job 実行） | job が alert を保存することの確認は smoke 側 |
| `/jobs/approval-escalations/run` で承認期限エスカレーションが保存される | `packages/frontend/e2e/backend-manual-checklist.spec.ts @extended` |  |
| `/pdf-templates` と `/template-settings` CRUD が動作する | `packages/frontend/e2e/frontend-smoke.spec.ts @core`（template-settings 作成） / `packages/frontend/e2e/backend-manual-checklist.spec.ts @extended` |  |
| `/document-send-logs/:id` と `/document-send-logs/:id/events` が取得できる | `packages/frontend/e2e/frontend-smoke.spec.ts @extended`（admin ops） / `packages/frontend/e2e/backend-manual-checklist.spec.ts @extended` |  |
| `/document-send-logs/:id/retry` で再送が記録される | `packages/frontend/e2e/backend-manual-checklist.spec.ts @extended` | 成功/抑止（already_sent/429）を許容 |
| `/report-subscriptions` CRUD → `/report-subscriptions/:id/run` で report_deliveries が作成される | `packages/frontend/e2e/frontend-smoke.spec.ts @core` / `packages/frontend/e2e/backend-manual-checklist.spec.ts @extended` |  |
| `/jobs/report-subscriptions/run` と `/jobs/report-deliveries/retry` が動作する | `packages/frontend/e2e/backend-manual-checklist.spec.ts @extended` |  |
| `/approval-rules` CRUD のハッピーパス | `packages/frontend/e2e/frontend-smoke.spec.ts @core`（作成） / `packages/frontend/e2e/backend-manual-checklist.spec.ts @extended` | DELETEは未提供 |
| `/projects/:id/members` のGET/POST/DELETEが動作する | `packages/frontend/e2e/frontend-smoke.spec.ts @extended`（一覧/追加/CSV） / `packages/frontend/e2e/backend-manual-checklist.spec.ts @extended` |  |
| `/projects/:id/member-candidates?q=` の候補検索が動作する | `packages/frontend/e2e/frontend-smoke.spec.ts @extended`（候補検索） |  |
| `/projects/:id/members/bulk` で複数メンバーの追加が動作する | `packages/frontend/e2e/frontend-smoke.spec.ts @extended`（CSVインポート） / `packages/frontend/e2e/backend-manual-checklist.spec.ts @extended` | CSVインポート経由で利用 |
| `/vendor-quotes` 作成と `/vendor-invoices` 作成→approve が通る | `packages/frontend/e2e/frontend-smoke.spec.ts @extended`（vendor docs create + approvals） / `scripts/smoke-backend.sh`（vendor invoice approve） |  |
| `/wellbeing-entries` POST → HR/AdminでGETできる | `packages/frontend/e2e/frontend-smoke.spec.ts @core`（送信/履歴） / `packages/frontend/e2e/backend-manual-checklist.spec.ts @extended` | HR閲覧を追加カバー |

### フロント PoC
| 手動確認項目 | 自動テスト（現状） |
| --- | --- |
| ダッシュボード: アラートカードが最新5件表示（なければプレースホルダ） | `packages/frontend/e2e/frontend-smoke.spec.ts @core` |
| 日報+WB: Good/Not Good 送信、Not Good時タグ/コメント/ヘルプ導線 | `packages/frontend/e2e/frontend-smoke.spec.ts @core` |
| 工数入力: 入力→一覧に反映 | `packages/frontend/e2e/frontend-smoke.spec.ts @core` / `packages/frontend/e2e/frontend-task-time-entry.spec.ts @core` |
| 請求: 作成→送信、詳細モックの表示 | `packages/frontend/e2e/frontend-smoke.spec.ts @core`（作成/表示） |
| 案件: メンバー管理（一覧/追加/削除/権限更新） | `packages/frontend/e2e/frontend-smoke.spec.ts @extended`（一覧/追加/CSV）※削除/権限更新は未カバー |
| 案件: メンバー候補検索 | `packages/frontend/e2e/frontend-smoke.spec.ts @extended` |
| 案件: CSVインポート/エクスポート | `packages/frontend/e2e/frontend-smoke.spec.ts @extended` |

### 環境・その他
| 手動確認項目 | 自動検査/手順（現状） |
| --- | --- |
| CI (backend/frontend/lint/lychee) が緑 | GitHub Actions（`CI` / `Link Check`） |
| prisma format/validate が通る | `CI / backend`（`.github/workflows/ci.yml`） |
| Podman 検証（reset→smoke完走） | `scripts/podman-poc.sh` + `scripts/smoke-backend.sh` |

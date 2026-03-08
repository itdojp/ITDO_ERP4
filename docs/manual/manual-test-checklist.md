# 手動確認チェックリスト（PoC）

## バックエンド API

### 基本（案件/請求/工数）

- [x] POST /projects → /projects/:id/estimates → /projects/:id/invoices → /invoices/:id/send のハッピーパスが通る
- [x] POST/GET /time-entries（非管理ロールは自分のデータのみ取得できる）
- [x] /alert-settings CRUD と /jobs/alerts/run で alert が保存される
- [x] /jobs/approval-escalations/run で承認期限エスカレーションが保存される
- [x] POST/GET（一覧）/PATCH /approval-rules のハッピーパス
- [x] /projects/:id/members の GET/POST/DELETE が動作する
- [x] /projects/:id/member-candidates?q= の候補検索が動作する
- [x] /projects/:id/members/bulk で複数メンバーの追加が動作する
- [x] GET /pdf-templates（一覧/詳細）と POST/GET/PATCH /template-settings が動作する
- [x] /document-send-logs/:id と /document-send-logs/:id/events が取得できる
- [x] /document-send-logs/:id/retry で再送が記録される
- [x] POST/GET/PATCH /report-subscriptions → /report-subscriptions/:id/run で report_deliveries が作成される
- [x] /jobs/report-subscriptions/run と /jobs/report-deliveries/retry が動作する

### Agent-First ガードレール（自動テスト参照）

- [x] `ACTION_POLICY_ENFORCEMENT_PRESET=phase2_core` で send 系が policy 未定義時に拒否される（`ACTION_POLICY_DENIED`）
  - 参照: `packages/backend/test/sendPolicyEnforcementPreset.test.js`
- [x] send 系で承認不足/証跡不足が拒否される（`APPROVAL_REQUIRED` / `EVIDENCE_REQUIRED`）
  - 参照: `packages/backend/test/sendPolicyEnforcementPreset.test.js`, `packages/backend/test/approvalEvidenceGate.test.js`
- [x] 承認アクション（`/approval-instances/:id/act`）で preset 強制時に policy 未定義拒否となる
  - 参照: `packages/backend/test/approvalActionPolicyPreset.test.js`
- [x] `ACTION_POLICY_REQUIRED_ACTIONS` 明示指定が preset より優先される
  - 参照: `packages/backend/test/sendPolicyEnforcementPreset.test.js`
- [x] `phase2_core` で高リスク mutation route が policy 未定義拒否 / 定義許可を満たす
  - 参照: `packages/backend/test/invoicePolicyEnforcementPreset.test.js`, `packages/backend/test/invoiceMarkPaidPolicyEnforcementPreset.test.js`, `packages/backend/test/purchaseOrderPolicyEnforcementPreset.test.js`, `packages/backend/test/expensePolicyEnforcementPreset.test.js`, `packages/backend/test/vendorInvoiceSubmitPolicyEnforcementPreset.test.js`, `packages/backend/test/vendorInvoiceEditPolicyEnforcementPreset.test.js`, `packages/backend/test/vendorInvoiceLinkPoRoutes.test.js`
- [ ] `make action-policy-phase3-readiness` / `make action-policy-phase3-readiness-json` を実行し、`ready: yes` かつ blockers が空であることを確認する
  - 手順: `docs/manual/agent-write-guardrails-guide.md` の fail-safe 運用手順に従う
  - 前提: `npm run build --prefix packages/backend` 実行済み、`DATABASE_URL` 設定済み
  - 記録: `make action-policy-phase3-readiness-record` で `docs/test-results/YYYY-MM-DD-action-policy-phase3-readiness-rN.md` を生成できる
  - 連続実行する場合: `make action-policy-phase3-trial-record`
  - 最低確認対象: `invoice:send`, `invoice:mark_paid`, `purchase_order:send`, `expense:submit`, `expense:mark_paid`, `vendor_invoice:submit`, `vendor_invoice:update_lines`, `vendor_invoice:update_allocations`, `*:approve`, `*:reject`
- [ ] `phase2_core` -> `phase3_strict` の切替後も主要操作が継続し、`action_policy_fallback_allowed` の新規発生がないことを確認する
  - 記録: `make action-policy-phase3-cutover-record`
  - 連続実行する場合: `make action-policy-phase3-trial-record`
- [ ] `make action-policy-fallback-report` / `make action-policy-fallback-report-json` で fallback 集計を確認し、`flowType:actionKey:targetTable` ベースで未収束キーが 0 件であることを確認する
- [ ] 問題発生時に `phase3_strict` -> `phase2_core` のロールバックと、必要な `ACTION_POLICY_REQUIRED_ACTIONS` 明示指定での段階復旧を確認する
  - ロールバック後は `make action-policy-phase3-readiness-json` と `make action-policy-fallback-report-json` で復旧対象キーのみが再出現していることを確認する
  - 記録: `make action-policy-phase3-cutover-record`

### チャット（確認依頼 ack required）

- [x] GET /chat-rooms/:roomId/ack-candidates?q= で候補（users/groups）が取得できる（q は2文字以上）
- [x] POST /chat-rooms/:roomId/ack-requests/preview で requiredUserIds の展開結果が確認できる
- [x] POST /chat-rooms/:roomId/ack-requests（dueAt 任意）で確認依頼を作成できる（message.ackRequest が作成される）
- [x] GET /chat-ack-requests/:id で dueAt/canceledAt/acks が取得できる
- [x] POST /chat-ack-requests/:id/ack で requiredUserIds のユーザが OK できる（冪等）
- [x] POST /chat-ack-requests/:id/revoke で OK 取消できる
- [x] POST /chat-ack-requests/:id/cancel で作成者または admin/mgmt が撤回できる（canceledAt/canceledBy）

### 通知ジョブ（運用）

- [x] POST /jobs/chat-ack-reminders/run（dryRun/limit）で期限到来（dueAt<=now）の未完了確認依頼に対し、通知候補/生成件数が返る
- [x] POST /jobs/leave-upcoming/run（targetDate/dryRun）で休暇開始日の通知（leave_upcoming）が生成される（本人+admin/mgmt）
- [x] POST /jobs/leave-entitlement-reminders/run（targetDate/dryRun）で有給付与期限の通知（leave_grant_reminder）が生成される（総務グループ）

### 休暇（有給付与/残高）

- [x] POST /leave-entitlements/profiles は `general_affairs` 所属のみ実行できる（非所属は 403 / GENERAL_AFFAIRS_REQUIRED）
- [x] POST /leave-entitlements/grants は理由必須で登録できる（監査ログ `leave_grant_created`）
- [x] GET /leave-entitlements/balance で付与/消化/引当/残高が取得できる
- [x] 有給申請 submit 時に不足がある場合、申請は継続しつつ `shortageWarning` が返る

### 休暇（種別ルール/連携export）

- [x] GET /leave-types?includeInactive=true で有効/無効を含む休暇種別一覧を取得できる
- [x] POST /leave-types で `requiresApproval` / `attachmentPolicy` / `submitLeadDays` / `allowRetroactiveSubmit` を含む種別を登録できる
- [x] PATCH /leave-types/:code でルール更新ができ、未知の `applicableGroupIds` は `INVALID_APPLICABLE_GROUP_IDS` で拒否される
- [x] POST /leave-requests/:id/submit は既存休暇重複時に `LEAVE_REQUEST_CONFLICT` を返す（日単位/時間単位）
- [x] `requiresApproval=false` の休暇種別では submit 後に状態が `approved` へ自動遷移する
- [x] GET /integrations/hr/exports/leaves は `status=approved` の申請のみを返し、leave type メタデータを含む
- [x] POST /integrations/hr/exports/leaves/dispatch は同一キー同条件で `replayed=true`、同一キー異条件で `409 idempotency_conflict`
- [x] GET /integrations/hr/exports/leaves/dispatch-logs は `target/idempotencyKey` フィルタと `limit/offset` が機能する

### 経費（拡張ワークフロー）

- [x] POST/GET /expenses（非管理ロールは自分のデータのみ取得できる）
- [x] POST /expenses で `lines`/`attachments` を含む作成ができる（`sum(lines.amount)=amount`）
- [x] GET /expenses/:id で `lines`/`attachments`/`comments` が取得できる
- [x] POST /expenses/:id/comments でコメントを追加できる（監査ログ `expense_comment_add`）
- [x] PUT /expenses/:id/budget-escalation で予算超過エスカレーション（理由/影響/代替案）を更新できる
- [x] POST /expenses/:id/submit は予算超過時にエスカレーション未入力だと `BUDGET_ESCALATION_REQUIRED` で拒否される
- [x] POST /expenses/:id/submit は `receiptUrl` がなくても添付証憑があれば通る（証憑必須条件）
- [x] POST /expenses/:id/submit は `receiptUrl` も添付証憑もない場合 `RECEIPT_REQUIRED` で拒否される
- [x] POST /expenses/:id/submit で承認依頼できる（予算条件を満たす場合）
- [x] pending_qa 承認時は QA チェックリスト未完了だと `EXPENSE_QA_CHECKLIST_REQUIRED` で拒否される
- [x] （承認後）POST /expenses/:id/mark-paid で settlementStatus=paid / paidAt / paidBy が設定される（監査ログ、通知 expense_mark_paid）
- [x] POST /expenses/:id/unmark-paid は reasonText 必須で、settlementStatus=unpaid に戻る（paidAt/paidBy クリア、監査ログ）
- [x] GET /expenses/:id/state-transitions で `create/submit/mark_paid/unmark_paid` の遷移履歴を確認できる
- [x] GET /expenses/:id/state-transitions は一般ユーザだと作成者本人のみ参照できる（他ユーザは 403）
- [x] `approved` 以外で POST /expenses/:id/mark-paid を実行すると `INVALID_STATUS` で拒否される
- [x] `settlementStatus=unpaid` の POST /expenses/:id/unmark-paid は `INVALID_STATUS` で拒否される
- [x] POST /expenses/:id/unmark-paid は reasonText が空文字/空白のみだと `INVALID_REASON` で拒否される
- [x] GET /expenses?projectId=... の `hasReceipt=true/false` で証憑有無（`receiptUrl` または添付）を正しく絞り込める
- [x] GET /expenses?projectId=... の `from/to` で発生日を境界日含めて正しく絞り込める
- [x] GET /expenses?projectId=... の `settlementStatus=paid` と `paidFrom/paidTo` が支払日で正しく絞り込まれる
- [x] GET /expenses?projectId=... の `paidFrom` 単体 / `paidTo` 単体でも境界日を含めて正しく絞り込まれる
- [x] GET /expenses?projectId=... の `from` / `to` / `paidFrom` / `paidTo` に不正日付を指定すると `INVALID_DATE` で拒否される
- [x] GET /expenses?projectId=... の `from/to` と `paidFrom/paidTo` で開始日 > 終了日の場合は `INVALID_DATE_RANGE` で拒否される
- [x] 一般ユーザによる PUT /expenses/:id/qa-checklist は `forbidden` で拒否される
- [x] 一般ユーザによる POST /expenses/:id/mark-paid / unmark-paid は `forbidden` で拒否される

### 仕入/発注（PO↔VI、配賦明細）

- [x] /vendor-quotes 作成と /vendor-invoices 作成 → /vendor-invoices/:id/submit → /vendor-invoices/:id/approve のハッピーパスが通る
- [x] POST /vendor-invoices/:id/link-po で PO を紐づけできる（案件/業者一致、監査ログ）
- [x] POST /vendor-invoices/:id/unlink-po で PO 紐づけを解除できる（監査ログ）
- [x] GET /vendor-invoices/:id/lines で `poLineUsage`（他VI利用数量/入力数量/残数量）が取得できる
- [x] PUT /vendor-invoices/:id/lines で部分請求数量を更新できる（同一PO明細の未請求残が負値になる更新は 400）
- [x] PUT /vendor-invoices/:id/allocations で配賦明細を更新できる（合計=請求合計、autoAdjust による端数調整）
- [x] allocations を空配列で送ると配賦明細をクリアできる（監査ログ）
- [x] purchaseOrderLineId 指定時、VI が PO 未紐づけの場合は 400、別 PO の line は 400、存在しない line は 404

### その他

- [x] /wellbeing-entries POST → HR/Admin で GET できる
- [x] /notifications の取得/既読化が動作する（unread-count、read）
- [x] /audit-logs で主要操作の監査ログが参照できる（`chat_ack_*`、`expense_mark_paid`/`expense_unmark_paid`、`vendor_invoice_*`、`*_run`）

## フロント PoC

### ダッシュボード/通知

- [x] ダッシュボード: アラートカードが最新5件表示される（なければプレースホルダ）
- [x] ダッシュボード: 通知カードが表示され、クリックで該当画面に遷移できる（chat/休暇/経費）

### チャット

- [x] チャット: 確認依頼を作成できる（対象ユーザ/グループ/ロール、期限 dueAt 任意）
- [x] チャット: 期限表示と「期限超過」表示が条件に応じて切り替わる
- [x] チャット: OK / OK取消 / 撤回 が権限条件に応じて操作できる
- [x] チャット: MentionComposer の候補検索（ユーザ/グループ）で対象を選択して投稿できる

### ワークフローエビデンス（Issue #953）

- [x] 注釈: `エビデンス追加` で chat_message 候補検索 → `追加` ができる（案件スコープ）
- [x] 注釈: `メモへ挿入` で Markdown リンクがメモへ挿入される
- [x] 注釈: `参照状態を確認` で `chat_message` の状態（参照可能/権限不足/発言なし）が表示される
- [x] 承認: `エビデンス（注釈）` の `表示` で 件数（外部URL/チャット参照）とメモを確認できる
- [x] 承認: `chat_message` のプレビューで抜粋を画面内確認できる（必要時は `開く` で遷移）

### 日報+工数

- [x] 日報+WB: Good/Not Good 送信、Not Good時タグ/コメント/ヘルプ導線
- [x] 工数入力: プロジェクト/タスク/日付/時間/作業種別/場所を入力→一覧に反映

### 請求

- [x] 請求: 作成→送信、詳細モックの表示

### 案件

- [x] 案件: メンバー管理（一覧/追加/削除/権限更新）が動作する
- [x] 案件: メンバー候補検索で候補が表示され、選択できる
- [x] 案件: CSVインポート/エクスポートが動作する

### 経費

- [x] 経費入力: プロジェクト/区分/日付/金額/通貨/共通経費/領収書URL を入力→一覧に反映
- [x] 経費入力: `状態` / `精算` / `領収書` / `支払日(開始・終了)` の一覧フィルタが動作する
- [x] 経費入力: （admin/mgmt）`支払済みにする` で精算状態が `paid` に更新される
- [x] 経費入力: （admin/mgmt）`支払取消` は理由必須で、実行後に精算状態が `unpaid` に戻る
- [x] 経費: 支払完了通知（expense_mark_paid）が通知カードに表示され、対象経費に遷移できる
- [x] 経費: 注釈 Drawer でメモを保存し、再表示で保持される
- [x] 経費: 注釈の EntityReferencePicker で内部参照候補を追加できる

### 休暇

- [x] 休暇申請: 既存休暇が重複する場合、submit が `LEAVE_REQUEST_CONFLICT` で失敗し状態が更新されない
- [x] 休暇申請: 時間休+工数の超過時に `TIME_ENTRY_OVERBOOKED` が返り、超過カードが表示される
- [x] 休暇申請: `承認不要` 種別は submit 後に `approved` 表示へ遷移する
- [x] 休暇申請: 証跡未添付かつ「相談無し」理由未入力の場合、`NO_CONSULTATION_REASON_REQUIRED` で失敗する

### 仕入/発注（PO↔VI）

- [x] 仕入/発注: VI 一覧が取得でき、PO 連携状態が表示される
- [x] 仕入/発注: VI の PO 紐づけ/解除ができる（ステータスにより理由入力の要否が変わる）
- [x] 仕入/発注: VI の配賦明細が表示/更新できる（合計、差分、端数調整の挙動）
- [x] 仕入/発注: 必要に応じて PO/VI のPDFを参照できる（stub の場合は警告表示）

### 運用ジョブ（AdminJobs）

- [x] AdminJobs: chat ack reminders / leave upcoming を dryRun/実行でき、結果(JSON)が表示される
- [x] 実行後、通知カードに反映される（必要に応じて /notifications で確認）

### 管理設定/監査（design-system 1.1.0）

- [x] ActionPolicy: PolicyFormBuilder で作成/更新ができる（必須・JSONバリデーション）
- [x] 承認ルール/ActionPolicy: 履歴表示で AuditTimeline と DiffViewer が表示される
- [x] 監査ログ: DateRangePicker（from/to）で期間指定検索ができる
- [x] 監査ログ: AgentRun 列の `詳細` で run/step/decision のドリルダウンを確認できる
  - 参照: `packages/frontend/e2e/frontend-smoke-audit-agent-run.spec.ts`
- [x] 監査閲覧: DateTimeRangePicker（targetFrom/targetUntil）で期間指定できる
- [x] HR分析: DateRangePicker（開始日/終了日）で集計範囲を変更できる

### モバイル回帰（design-system適用後）

- [x] `docs/test-results/mobile-regression-template.md` をコピーし、PR単位の証跡ファイル（`YYYY-MM-DD-mobile-regression-*.md`）を作成する
- [x] Invoices: 一覧/フィルタ/行アクションが `375x667` で崩れず操作できる
- [x] VendorDocuments: PO紐づけ/解除、配賦明細または請求明細入力が `375x667` で操作できる
- [x] AuditLogs: 検索フォーム/一覧/CSV出力が `375x667` で操作できる
- [x] PeriodLocks: 登録/解除導線が `375x667` で操作できる
- [x] AdminJobs: dryRun切替/実行/結果確認が `375x667` で操作できる
- [x] PR本文に証跡ファイルとスクリーンショット格納ディレクトリ（`docs/test-results/...`）のリンクを記載する

## 環境・その他

- [x] CI (backend/frontend/lint/lychee) が緑
- [x] prisma format/validate が通る（DATABASE_URL ダミー設定でOK）
- [x] フロント確認時は `VITE_API_BASE=http://localhost:3001` を指定して API を参照できる
- [x] （実行補助）`make frontend-dev-api` で API 接続付きフロントを起動できる
- [x] Podman 検証は `./scripts/podman-poc.sh reset` → `./scripts/smoke-backend.sh` で完走する
- [x] （実行補助）`make podman-smoke` で Podman reset + backend smoke を連続実行できる

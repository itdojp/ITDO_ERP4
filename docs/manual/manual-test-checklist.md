# 手動確認チェックリスト（PoC）

## バックエンド API

### 基本（案件/請求/工数）

- [ ] POST /projects → /projects/:id/estimates → /projects/:id/invoices → /invoices/:id/send のハッピーパスが通る
- [ ] POST/GET /time-entries（非管理ロールは自分のデータのみ取得できる）
- [ ] /alert-settings CRUD と /jobs/alerts/run で alert が保存される
- [ ] /jobs/approval-escalations/run で承認期限エスカレーションが保存される
- [ ] /approval-rules CRUD のハッピーパス
- [ ] /projects/:id/members の GET/POST/DELETE が動作する
- [ ] /projects/:id/member-candidates?q= の候補検索が動作する
- [ ] /projects/:id/members/bulk で複数メンバーの追加が動作する
- [ ] /pdf-templates と /template-settings CRUD が動作する
- [ ] /document-send-logs/:id と /document-send-logs/:id/events が取得できる
- [ ] /document-send-logs/:id/retry で再送が記録される
- [ ] /report-subscriptions CRUD → /report-subscriptions/:id/run で report_deliveries が作成される
- [ ] /jobs/report-subscriptions/run と /jobs/report-deliveries/retry が動作する

### チャット（確認依頼 ack required）

- [ ] GET /projects/:projectId/chat-ack-candidates?q= で候補（users/groups）が取得できる（q は2文字以上）
- [ ] POST /projects/:projectId/chat-ack-requests/preview で requiredUserIds の展開結果が確認できる
- [ ] POST /projects/:projectId/chat-ack-requests（dueAt 任意）で確認依頼を作成できる（message.ackRequest が作成される）
- [ ] GET /chat-ack-requests/:id で dueAt/canceledAt/acks が取得できる
- [ ] POST /chat-ack-requests/:id/ack で requiredUserIds のユーザが OK できる（冪等）
- [ ] POST /chat-ack-requests/:id/revoke で OK 取消できる
- [ ] POST /chat-ack-requests/:id/cancel で作成者または admin/mgmt が撤回できる（canceledAt/canceledBy）

### 通知ジョブ（運用）

- [ ] POST /jobs/chat-ack-reminders/run（dryRun/limit）で期限到来（dueAt<=now）の未完了確認依頼に対し、通知候補/生成件数が返る
- [ ] POST /jobs/leave-upcoming/run（targetDate/dryRun）で休暇開始日の通知（leave_upcoming）が生成される（本人+admin/mgmt）

### 経費（支払状態）

- [ ] POST/GET /expenses（非管理ロールは自分のデータのみ取得できる）
- [ ] POST /expenses/:id/submit で承認依頼できる
- [ ] （承認後）POST /expenses/:id/mark-paid で settlementStatus=paid / paidAt / paidBy が設定される（監査ログ、通知 expense_mark_paid）
- [ ] POST /expenses/:id/unmark-paid は reasonText 必須で、settlementStatus=unpaid に戻る（paidAt/paidBy クリア、監査ログ）

### 仕入/発注（PO↔VI、配賦明細）

- [ ] /vendor-quotes 作成と /vendor-invoices 作成 → /vendor-invoices/:id/submit → /vendor-invoices/:id/approve のハッピーパスが通る
- [x] POST /vendor-invoices/:id/link-po で PO を紐づけできる（案件/業者一致、監査ログ）
- [x] POST /vendor-invoices/:id/unlink-po で PO 紐づけを解除できる（監査ログ）
- [x] GET /vendor-invoices/:id/lines で `poLineUsage`（他VI利用数量/入力数量/残数量）が取得できる
- [x] PUT /vendor-invoices/:id/lines で部分請求数量を更新できる（同一PO明細の未請求残が負値になる更新は 400）
- [x] PUT /vendor-invoices/:id/allocations で配賦明細を更新できる（合計=請求合計、autoAdjust による端数調整）
- [x] allocations を空配列で送ると配賦明細をクリアできる（監査ログ）
- [x] purchaseOrderLineId 指定時、VI が PO 未紐づけの場合は 400、別 PO の line は 400、存在しない line は 404

### その他

- [ ] /wellbeing-entries POST → HR/Admin で GET できる
- [ ] /notifications の取得/既読化が動作する（unread-count、read）
- [ ] /audit-logs で主要操作の監査ログが参照できる（`chat_ack_*`、`expense_mark_paid`/`expense_unmark_paid`、`vendor_invoice_*`、`*_run`）

## フロント PoC

### ダッシュボード/通知

- [ ] ダッシュボード: アラートカードが最新5件表示される（なければプレースホルダ）
- [x] ダッシュボード: 通知カードが表示され、クリックで該当画面に遷移できる（chat/休暇/経費）

### チャット

- [ ] チャット: 確認依頼を作成できる（対象ユーザ/グループ/ロール、期限 dueAt 任意）
- [ ] チャット: 期限表示と「期限超過」表示が条件に応じて切り替わる
- [ ] チャット: OK / OK取消 / 撤回 が権限条件に応じて操作できる
- [ ] チャット: MentionComposer の候補検索（ユーザ/グループ）で対象を選択して投稿できる

### ワークフローエビデンス（Issue #953）

- [ ] 注釈: `エビデンス追加` で chat_message 候補検索 → `追加` ができる（案件スコープ）
- [ ] 注釈: `メモへ挿入` で Markdown リンクがメモへ挿入される
- [ ] 注釈: `参照状態を確認` で `chat_message` の状態（参照可能/権限不足/発言なし）が表示される
- [ ] 承認: `エビデンス（注釈）` の `表示` で 件数（外部URL/チャット参照）とメモを確認できる
- [ ] 承認: `chat_message` のプレビューで抜粋を画面内確認できる（必要時は `開く` で遷移）

### 日報+工数

- [ ] 日報+WB: Good/Not Good 送信、Not Good時タグ/コメント/ヘルプ導線
- [ ] 工数入力: プロジェクト/タスク/日付/時間/作業種別/場所を入力→一覧に反映

### 請求

- [ ] 請求: 作成→送信、詳細モックの表示

### 案件

- [ ] 案件: メンバー管理（一覧/追加/削除/権限更新）が動作する
- [ ] 案件: メンバー候補検索で候補が表示され、選択できる
- [ ] 案件: CSVインポート/エクスポートが動作する

### 経費

- [ ] 経費入力: プロジェクト/区分/日付/金額/通貨/共通経費/領収書URL を入力→一覧に反映
- [ ] 経費: 支払完了通知（expense_mark_paid）が通知カードに表示され、対象経費に遷移できる
- [ ] 経費: 注釈 Drawer でメモを保存し、再表示で保持される
- [ ] 経費: 注釈の EntityReferencePicker で内部参照候補を追加できる

### 仕入/発注（PO↔VI）

- [ ] 仕入/発注: VI 一覧が取得でき、PO 連携状態が表示される
- [ ] 仕入/発注: VI の PO 紐づけ/解除ができる（ステータスにより理由入力の要否が変わる）
- [ ] 仕入/発注: VI の配賦明細が表示/更新できる（合計、差分、端数調整の挙動）
- [ ] 仕入/発注: 必要に応じて PO/VI のPDFを参照できる（stub の場合は警告表示）

### 運用ジョブ（AdminJobs）

- [ ] AdminJobs: chat ack reminders / leave upcoming を dryRun/実行でき、結果(JSON)が表示される
- [ ] 実行後、通知カードに反映される（必要に応じて /notifications で確認）

### 管理設定/監査（design-system 1.1.0）

- [ ] ActionPolicy: PolicyFormBuilder で作成/更新ができる（必須・JSONバリデーション）
- [ ] 承認ルール/ActionPolicy: 履歴表示で AuditTimeline と DiffViewer が表示される
- [x] 監査ログ: DateRangePicker（from/to）で期間指定検索ができる
- [ ] 監査閲覧: DateTimeRangePicker（targetFrom/targetUntil）で期間指定できる
- [ ] HR分析: DateRangePicker（開始日/終了日）で集計範囲を変更できる

### モバイル回帰（design-system適用後）

- [ ] `docs/test-results/mobile-regression-template.md` をコピーし、PR単位の証跡ファイル（`YYYY-MM-DD-mobile-regression-*.md`）を作成する
- [x] Invoices: 一覧/フィルタ/行アクションが `375x667` で崩れず操作できる
- [ ] VendorDocuments: PO紐づけ/解除、配賦明細または請求明細入力が `375x667` で操作できる
- [ ] AuditLogs: 検索フォーム/一覧/CSV出力が `375x667` で操作できる
- [ ] PeriodLocks: 登録/解除導線が `375x667` で操作できる
- [ ] AdminJobs: dryRun切替/実行/結果確認が `375x667` で操作できる
- [ ] PR本文に証跡ファイルとスクリーンショット格納ディレクトリ（`docs/test-results/...`）のリンクを記載する

## 環境・その他

- [ ] CI (backend/frontend/lint/lychee) が緑
- [ ] prisma format/validate が通る（DATABASE_URL ダミー設定でOK）
- [ ] フロント確認時は `VITE_API_BASE=http://localhost:3001` を指定して API を参照できる
- [ ] Podman 検証は `./scripts/podman-poc.sh reset` → `./scripts/smoke-backend.sh` で完走する

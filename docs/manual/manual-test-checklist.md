# 手動確認チェックリスト（PoC）

## バックエンド API
- [ ] POST /projects → /projects/:id/estimates → /projects/:id/invoices → /invoices/:id/send のハッピーパスが通る
- [ ] POST/GET /time-entries （非管理ロールなら自分のデータのみ取得）
- [ ] POST/GET /expenses （非管理ロールなら自分のデータのみ取得）
- [ ] /alert-settings CRUD と /jobs/alerts/run で alert が保存される
- [ ] /jobs/approval-escalations/run で承認期限エスカレーションが保存される
- [ ] /pdf-templates と /template-settings CRUD が動作する
- [ ] /document-send-logs/:id と /document-send-logs/:id/events が取得できる
- [ ] /document-send-logs/:id/retry で再送が記録される
- [ ] /report-subscriptions CRUD → /report-subscriptions/:id/run で report_deliveries が作成される
- [ ] /jobs/report-subscriptions/run と /jobs/report-deliveries/retry が動作する
- [ ] /approval-rules CRUD のハッピーパス
- [ ] /projects/:id/members のGET/POST/DELETEが動作する
- [ ] /projects/:id/member-candidates?q= の候補検索が動作する
- [ ] /projects/:id/members/bulk で複数メンバーの追加が動作する
- [ ] /vendor-quotes 作成と /vendor-invoices 作成→approve が通る
- [ ] /wellbeing-entries POST → HR/AdminでGETできる

## フロント PoC
- [ ] ダッシュボード: アラートカードが最新5件表示される（なければプレースホルダ）
- [ ] 日報+WB: Good/Not Good 送信、Not Good時タグ/コメント/ヘルプ導線
- [ ] 工数入力: プロジェクト/タスク/日付/時間/作業種別/場所を入力→一覧に反映
- [ ] 請求: 作成→送信、詳細モックの表示
- [ ] 案件: メンバー管理（一覧/追加/削除/権限更新）が動作する
- [ ] 案件: メンバー候補検索で候補が表示され、選択できる
- [ ] 案件: CSVインポート/エクスポートが動作する

## 環境・その他
- [ ] CI (backend/frontend/lint/lychee) が緑
- [ ] prisma format/validate が通る（DATABASE_URL ダミー設定でOK）
- [ ] フロント確認時は `VITE_API_BASE=http://localhost:3001` を指定して API を参照できる
- [ ] Podman 検証は `./scripts/podman-poc.sh reset` → `./scripts/smoke-backend.sh` で完走する

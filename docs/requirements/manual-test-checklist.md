# 手動確認チェックリスト（PoC）

## バックエンド API
- [ ] POST /projects → /projects/:id/estimates → /projects/:id/invoices → /invoices/:id/send のハッピーパスが通る
- [ ] POST/GET /time-entries （非管理ロールなら自分のデータのみ取得）
- [ ] POST/GET /expenses （非管理ロールなら自分のデータのみ取得）
- [ ] /alert-settings CRUD と /jobs/alerts/run で alert が保存される
- [ ] /jobs/approval-escalations/run で承認期限エスカレーションが保存される
- [ ] /pdf-templates と /template-settings CRUD が動作する
- [ ] /approval-rules CRUD のハッピーパス
- [ ] /wellbeing-entries POST → HR/AdminでGETできる

## フロント PoC
- [ ] ダッシュボード: アラートカードが最新5件表示される（なければプレースホルダ）
- [ ] 日報+WB: Good/Not Good 送信、Not Good時タグ/コメント/ヘルプ導線
- [ ] 工数入力: プロジェクト/タスク/日付/時間/作業種別/場所を入力→一覧に反映
- [ ] 請求: 作成→送信、詳細モックの表示

## 環境・その他
- [ ] CI (backend/frontend/lint/lychee) が緑
- [ ] prisma format/validate が通る（DATABASE_URL ダミー設定でOK）

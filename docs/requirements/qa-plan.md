# QA 手順（ハッピーパス最小）

## バックエンド API
- 起動: `cd packages/backend && npm run dev` (環境変数 `DATABASE_URL` で任意のローカルDB)
- ヘルス: GET /health → { ok: true }
- プロジェクト作成: POST /projects { code,name } → 201
- 見積→請求: POST /projects/:id/estimates → submit → POST /projects/:id/invoices → submit → send
- タイムエントリ: POST /time-entries → GET /time-entries → submit
- 経費: POST /expenses → submit
- アラートジョブ: POST /jobs/alerts/run → GET /alerts で履歴確認
- ウェルビーイング: POST /wellbeing-entries → GET (HRのみ)

## フロント PoC
- 起動: `cd packages/frontend && npm run dev`
- ダッシュボード: アラート一覧が表示される（データが無ければ「なし」表示）
- 日報+WB: Good/Not Good入力＋タグ/短文（Not Good時）→ 送信 → 成功メッセージ
- 工数: 追加→一覧に反映
- 請求ドラフト: 一覧に番号/ステータスが出る（送信Stubボタン押下でUI反応すること）
- ヘルプモーダル: 日報画面から開閉でき、相談先リストと緊急案内が表示される
- シードデータ: scripts/seed-demo.sql をロード後、フロントに反映されることを確認（プロジェクト/請求/工数/経費のダミー）
- 整合チェック: scripts/checks/poc-integrity.sql を実行し、件数/合計が期待値と一致することを確認

## 管理系
- アラート設定: GET/POST/PATCH /alert-settings でCRUD動作
- 承認ルール: GET/POST/PATCH /approval-rules でCRUD動作
- 送信Stub: /invoices/:id/send, /purchase-orders/:id/send で status=sent になる

## 既知リスク/欠落（PoC）
- RBACは簡易、エラーハンドリング/バリデーションも基本のみ
- PDF/メールはStub
- データ永続先は環境構築次第
- UIは最小限でモバイル検証未完

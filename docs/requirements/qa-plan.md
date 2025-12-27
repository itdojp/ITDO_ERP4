# QA 手順（ハッピーパス最小）

## バックエンド API
- 起動: `cd packages/backend && npm run dev` (環境変数 `DATABASE_URL` で任意のローカルDB)
- ヘルス: GET /health → { ok: true }
- プロジェクト作成: POST /projects { code,name } → 201
- 見積→請求: POST /projects/:id/estimates → submit → POST /projects/:id/invoices → submit → send
- タイムエントリ: POST /time-entries → GET /time-entries → submit
- 経費: POST /expenses → submit
- 承認フロー: 見積/請求/発注/経費/休暇の submit → /approval-instances で作成確認 → /approval-instances/:id/act で承認/却下 → 対象ステータス更新
- アラートジョブ: POST /jobs/alerts/run → GET /alerts で履歴確認
- 承認期限エスカレーション: POST /jobs/approval-escalations/run → GET /alerts で履歴確認
- 定期案件ジョブ: recurring_project_templates を作成 → POST /jobs/recurring-projects/run → 月次/四半期のドラフト生成と重複防止を確認
- ウェルビーイング: POST /wellbeing-entries → GET (HRのみ)
- スモーク: scripts/smoke-backend.sh を実行してハッピーパスが通ることを確認

### 定期案件テンプレ投入例（手動）
```sql
WITH monthly_project AS (
  INSERT INTO "Project" (id, code, name, status, currency, "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), 'REC-MONTH', 'Recurring Monthly', 'active', 'JPY', now(), now())
  ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name,
        "updatedAt" = now()
  RETURNING id
),
quarterly_project AS (
  INSERT INTO "Project" (id, code, name, status, currency, "createdAt", "updatedAt")
  VALUES (gen_random_uuid(), 'REC-QUARTER', 'Recurring Quarterly', 'active', 'JPY', now(), now())
  ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name,
        "updatedAt" = now()
  RETURNING id
)
INSERT INTO "RecurringProjectTemplate"
  (id, "projectId", frequency, "defaultAmount", "defaultCurrency", "defaultTaxRate", "defaultTerms", "defaultMilestoneName", "billUpon", "dueDateRule", "shouldGenerateEstimate", "shouldGenerateInvoice", "nextRunAt", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), id, 'monthly', 100000, 'JPY', 0.1, 'Monthly retainer', 'Monthly milestone', 'date', '{"type":"periodEndPlusOffset","offsetDays":30}'::jsonb, true, true, now(), true, now(), now()
FROM monthly_project
UNION ALL
SELECT gen_random_uuid(), id, 'quarterly', 300000, 'JPY', 0.1, 'Quarterly retainer', 'Quarterly milestone', 'date', '{"type":"periodEndPlusOffset","offsetDays":30}'::jsonb, true, true, now(), true, now(), now()
FROM quarterly_project
ON CONFLICT ("projectId") DO UPDATE
  SET frequency = EXCLUDED.frequency,
      "defaultAmount" = EXCLUDED."defaultAmount",
      "defaultCurrency" = EXCLUDED."defaultCurrency",
      "defaultTaxRate" = EXCLUDED."defaultTaxRate",
      "defaultTerms" = EXCLUDED."defaultTerms",
      "defaultMilestoneName" = EXCLUDED."defaultMilestoneName",
      "billUpon" = EXCLUDED."billUpon",
      "dueDateRule" = EXCLUDED."dueDateRule",
      "shouldGenerateEstimate" = EXCLUDED."shouldGenerateEstimate",
      "shouldGenerateInvoice" = EXCLUDED."shouldGenerateInvoice",
      "nextRunAt" = EXCLUDED."nextRunAt",
      "isActive" = EXCLUDED."isActive",
      "updatedAt" = now();
```
実行後に `POST /jobs/recurring-projects/run` を叩き、同月内で二重作成されないことを確認。
UUID生成関数は環境に合わせて置き換え（`gen_random_uuid()`/`uuid_generate_v4()` など）。

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

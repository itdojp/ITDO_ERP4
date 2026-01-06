# データ品質チェック案（ドラフト）

## チェック項目（初期）
- コード重複: project_code / customer_code / vendor_code の重複検出
- 参照切れ: project_id/task_id の参照欠損（time_entries, expenses 等）
- 税率不整合: billing_lines.tax_rate が null か 0 かを検知し報告
- 通貨未設定: invoices/estimates の currency 欠損
- 日付不正: work_date/incurred_on の未来日/過去許容範囲外
- 番号整合: invoice_no/po_no がフォーマット `PYYYY-MM-NNNN` になっているか
- 重複ID: mapping_* に同一 legacy_id が複数 new_id に紐づいていないか
- 金額整合: project 単位で invoices.totalAmount と billing_lines の合計が一致するか
- 欠損: time_entries/expenses で user_id/project_id/currency が null のもの
- 工数/休暇の整合: 同一日で minutes が 1440 を超えていないか、休暇と重複していないか

### HR/CRM 連携向けチェック
- CRM: externalId が null/空、externalSource + externalId の重複
- CRM: contacts が customerId/vendorId のどちらにも紐付いていない
- CRM: contacts.email の形式不正（存在する場合）
- HR: userAccount.externalId の欠損、wellbeingEntry.userId/entryDate の欠損
- HR: 匿名化IDの形式（hash prefix 等）を運用ルールに合わせて検知

## 出力形式
- CSV or Markdown レポート: 「種別, 対象ID, 詳細」
- 件数サマリ: チェックごとの件数を集計

## 運用
- バッチ: 1日1回（cron）でチェックし、レポートを保存 & アラート通知候補
- PoCではローカルスクリプトでの手動実行でも可
- API: `POST /jobs/data-quality/run` でチェックを実行し、件数とサンプルを返す

## 擬似コード（例: SQLベース）
```sql
-- project_code 重複
select code, count(*) c from projects group by code having count(*) > 1;

-- time_entries の参照切れ
select id from time_entries te where not exists (select 1 from projects p where p.id = te.project_id);

-- invoice_no フォーマット確認
select id, invoice_no from invoices where invoice_no !~ '^P[DIQ]?[0-9]{4}-[0-9]{2}-[0-9]{4}$';

-- mapping_projects 重複
select legacy_id, count(*) c from mapping_projects group by legacy_id having count(*) > 1;

-- 請求ヘッダと明細の金額差分
select i.id, i.total_amount, sum(bl.quantity * bl.unit_price) as calc_total
from invoices i
join billing_lines bl on bl.invoice_id = i.id
group by i.id, i.total_amount
having abs(i.total_amount - sum(bl.quantity * bl.unit_price)) > 0.01;

-- 欠損（通貨なし）
select id from invoices where currency is null or currency = '';

-- 工数の1日合計超過
select user_id, work_date::date, sum(minutes) as total_min
from time_entries
group by user_id, work_date::date
having sum(minutes) > 1440;
```

## 将来拡張
- 期間別の集計差分チェック（予実/売上の突き合わせ）
- 工数の重複/矛盾チェック（休暇との重複、1日合計時間の上限）
- PDF/メール送信失敗の再送キュー監視

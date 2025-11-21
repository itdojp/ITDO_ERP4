# データ品質チェック案（ドラフト）

## チェック項目（初期）
- コード重複: project_code / customer_code / vendor_code の重複検出
- 参照切れ: project_id/task_id の参照欠損（time_entries, expenses 等）
- 税率不整合: billing_lines.tax_rate が null か 0 かを検知し報告
- 通貨未設定: invoices/estimates の currency 欠損
- 日付不正: work_date/incurred_on の未来日/過去許容範囲外

## 出力形式
- CSV or Markdown レポート: 「種別, 対象ID, 詳細」
- 件数サマリ: チェックごとの件数を集計

## 運用
- バッチ: 1日1回（cron）でチェックし、レポートを保存 & アラート通知候補
- PoCではローカルスクリプトでの手動実行でも可

## 擬似コード（例: SQLベース）
```sql
-- project_code 重複
select code, count(*) c from projects group by code having count(*) > 1;

-- time_entries の参照切れ
select id from time_entries te where not exists (select 1 from projects p where p.id = te.project_id);
```

## 将来拡張
- 期間別の集計差分チェック（予実/売上の突き合わせ）
- 工数の重複/矛盾チェック（休暇との重複、1日合計時間の上限）
- PDF/メール送信失敗の再送キュー監視

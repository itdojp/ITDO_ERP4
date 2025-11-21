# RateCard 適用ロジック（ドラフト）

## 前提
- time_entries に work_type/role が入ることを前提とする
- rate_cards は project_id (任意), role/work_type, unit_price, valid_from/valid_to, currency を持つ

## 適用ルール（案）
1. project_id + work_type で検索、valid_from <= work_date <= valid_to の最新を適用
2. 見つからない場合は role で検索（将来拡張）
3. それでも見つからない場合はデフォルト単価（設定値）を適用
4. 金額 = minutes/60 * unit_price を四捨五入（小数第2位）

## 例コード（擬似）
```ts
function calcAmount(minutes, unitPrice) {
  const hours = minutes / 60;
  return Math.round(hours * unitPrice * 100) / 100;
}
```

## 次ステップ
- rate_cards へのインデックス: (project_id, work_type, valid_from, valid_to)
- タイムエントリ保存時に計算 or バッチで集計（PoCではバッチ不要）
- 旧システムの単価移行ルールは migration-mapping に追記予定

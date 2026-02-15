# PO移行リハーサル結果テンプレート

- 実施日: YYYY-MM-DD
- 実施者:
- 対象Issue: #543
- 入力データ:
  - 形式: csv/json
  - ディレクトリ: `tmp/migration/...`（機微情報は記録しない）
  - 範囲: （期間/案件/顧客 など）

## 実行環境
- DB: `postgresql://...`
- コンテナ名/ポート: 
- ブランチ/コミット: 

## 実行コマンド
```bash
INPUT_DIR=tmp/migration/po-real INPUT_FORMAT=csv APPLY=1 RUN_INTEGRITY=1 \
  ./scripts/run-po-migration-rehearsal.sh
```

## 主要ログ
- dry-run: `tmp/migration/logs/.../dry-run.log`
- apply: `tmp/migration/logs/.../apply.log`
- integrity: `tmp/migration/logs/.../integrity.log`

## 結果サマリ
- dry-run errors: 
- apply errors: 
- integrity check: pass/fail
- 主要件数（users/projects/invoices/purchase_orders 等）:

## 問題一覧
| 区分 | 内容 | 対応方針 |
|---|---|---|
| 入力データ |  | 修正/保留 |
| マッピング |  | 修正/保留 |
| ツール |  | 修正/保留 |

## 判定
- [ ] リハーサル合格（errors=0, integrity問題なし）
- [ ] 追加対応が必要

## 次アクション
- 

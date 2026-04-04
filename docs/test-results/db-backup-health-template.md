# DBバックアップ健全性確認 記録テンプレート

## 実施情報
- 実施日: YYYY-MM-DD
- 対象環境: 検証 / ステージング / 本番
- 実施者:
- 対象ホスト:

## 実行コマンド
- DB backup freshness:
  ```bash
  ./scripts/quadlet/check-db-backup.sh --max-age-hours 24 --print-prefix
  ```
- Latest DB backup:
  ```bash
  ./scripts/quadlet/list-db-backups.sh --latest --print-prefix
  ```
- 任意: globals を含む archive 構成確認:
  ```bash
  ./scripts/quadlet/check-db-backup.sh --max-age-hours 24
  ```

## 実行結果
- 最新 backup prefix:
- dump path:
- globals path:
- 実行ログ:
  - ファイル:
  - 参照先:

## 判定
- freshness: OK / NG
- globals 同梱: OK / NG / 対象外
- 備考:

## 次アクション
- 追加対応要否: なし / あり
- ありの場合の Issue:
  - #

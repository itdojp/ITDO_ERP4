# DR復元演習 結果テンプレート

## 実施情報
- 実施日: YYYY-MM-DD
- 環境: PoC / 検証 / 本番相当
- 実施者:
- 対象: DB / 添付 / 設定（該当するもの）

## RTO/RPO（当該演習の前提）
- RPO:
- RTO:

## バックアップ
- バックアップ取得方法: `scripts/podman-poc.sh backup` / `scripts/backup-prod.sh backup`
- 退避先: ローカル / 別ホスト / （S3は後続）
- 暗号化: あり / なし（方式）
- バックアップファイル:
  - DB:
  - globals:
  - assets（該当時）:

## リストア
- 手順/コマンド:
- 実行ログ:
  - ファイル: （例: `tmp/erp4-dr-verify-YYYYMMDD-HHMMSS.log`）
- 所要時間:
  - リストア開始〜完了:
  - 整合性チェック完了:

## 検証（チェック項目）
- `scripts/podman-poc.sh check`:
- 追加検証（任意）:

## 結果
- 成功/失敗:
- 失敗時の原因:
- 改善点（Issue化）:
  - #


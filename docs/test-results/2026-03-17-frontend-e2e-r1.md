# 2026-03-17 フロントE2E（管理設定 会計マッピングルール UI エビデンス r1）

- 実行コマンド: `E2E_CAPTURE=1 E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-03-17-frontend-e2e-r1" E2E_GREP='frontend smoke admin ops' ./scripts/e2e-frontend.sh`
- 結果: PASS
- 補足:
  - `11-admin-settings.png` に `連携照合サマリ`、`連携ジョブ一覧`、`会計マッピングルール` の 3 カードを含める。
  - `11-accounting-mapping-rules.png` で mapping rule の作成、一覧取得、編集、再適用結果を確認する。
  - `11-integration-export-jobs.png` で leave export の再出力と `reexportOfId` 表示を確認する。

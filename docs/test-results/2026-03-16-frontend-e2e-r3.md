# 2026-03-16 フロントE2E（管理設定 連携ジョブ一覧 UI エビデンス r3）

- 実行コマンド: `E2E_CAPTURE=1 E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-03-16-frontend-e2e-r3" E2E_GREP='frontend smoke admin ops' ./scripts/e2e-frontend.sh`
- 結果: PASS
- 補足:
  - `11-admin-settings.png` に `連携照合サマリ` と `連携ジョブ一覧` の両カードを含める。
  - `11-integration-export-jobs.png` で `休暇CSV（勤怠）` の一覧取得と `reexportOfId` 表示を確認する。

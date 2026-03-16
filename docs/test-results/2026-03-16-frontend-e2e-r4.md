# 2026-03-16 フロントE2E（管理会計 CSV UI エビデンス r4）

- 実行コマンド: `E2E_CAPTURE=1 E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-03-16-frontend-e2e-r4" E2E_GREP='frontend smoke reports masters settings' ./scripts/e2e-frontend.sh`
- 結果: PASS
- 補足:
  - `08-reports.png` に `管理会計サマリCSV` ボタンを含める。
  - E2E では `management-accounting-summary-2026-03-01-to-2026-03-31.csv` の download を確認した。

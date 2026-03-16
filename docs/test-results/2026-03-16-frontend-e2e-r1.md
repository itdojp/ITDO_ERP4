# フロントE2E（管理設定/運用管理 UI エビデンス r1）

- date: 2026-03-16
- run: r1
- timezone: Asia/Tokyo
- command: `E2E_CAPTURE=1 E2E_EVIDENCE_DIR=\"$PWD/docs/test-results/2026-03-16-frontend-e2e-r1\" E2E_GREP='frontend smoke admin ops' ./scripts/e2e-frontend.sh`
- result: PASS
- tests: `1 passed`
- evidence: `docs/test-results/2026-03-16-frontend-e2e-r1/`

## Notes

- `Settings` の `連携照合サマリ` カードを含む管理設定画面の補足証跡を再取得した。
- `11-admin-settings.png` は外部連携設定と連携照合サマリの両方を含む。

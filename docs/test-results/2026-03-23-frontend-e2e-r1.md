# 2026-03-23 フロントE2E（管理設定 認証方式移行 UI エビデンス r1）

- 実行コマンド: `E2E_CAPTURE=1 E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-03-23-frontend-e2e-r1" E2E_GREP='frontend auth identity migration settings smoke' ./scripts/e2e-frontend.sh`
- 結果: PASS
- 補足:
  - `11-admin-settings.png` に管理設定全体と `認証方式移行` カードの配置を含める。
  - `11-auth-identity-migration.png` で認証主体一覧取得、Google 認証主体追加、ローカル認証主体追加、認証主体更新の導線を確認する。

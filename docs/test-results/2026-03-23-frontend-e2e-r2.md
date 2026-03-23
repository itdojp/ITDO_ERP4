# 2026-03-23 フロントE2E（Auth Gateway CurrentUser/認証セッション UI エビデンス r2）

- 実行コマンド: `E2E_CAPTURE=1 E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-03-23-frontend-e2e-r2" E2E_AUTH_MODE=jwt_bff E2E_BASE_URL=http://127.0.0.1:4173 E2E_API_BASE=http://127.0.0.1:3002 npm run e2e --prefix packages/frontend -- e2e/frontend-auth-gateway-bff.spec.ts`
- 結果: PASS
- 補足:
  - `00-current-user-auth-sessions.png` に `現在のユーザー` カード内の Auth Gateway 認証セッション一覧を含める。
  - current session と other session の表示、および `このセッションを失効` 実行後の一覧再読込を確認する。

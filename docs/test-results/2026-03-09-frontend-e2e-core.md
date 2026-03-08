# フロントE2E(core)

- date: 2026-03-09
- command: `E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`
- result: PASS
- tests: `91 passed`
- duration: `34.7s`
- sourceLog: `tmp/2026-03-09-frontend-e2e-core.log`

## Notes

- 現行 `origin/main` に対して Podman DB で core scope を再実行しました。
- 実行前に `backend-leave-time-conflict` と `frontend-smoke-core` の期待値/selector を現行実装に合わせて補正しました。

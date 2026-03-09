# ActionPolicy phase3 strict フロントE2E(core)

- date: 2026-03-09
- command: `ACTION_POLICY_ENFORCEMENT_PRESET=phase3_strict E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh`
- result: PASS
- tests: `91 passed`
- duration: `37.6s`
- sourceLog: `tmp/2026-03-09-action-policy-phase3-e2e-core.log`
- sourceReadinessRecord: `docs/test-results/2026-03-08-action-policy-phase3-readiness-r2.md`
- sourceCutoverRecord: `docs/test-results/2026-03-08-action-policy-phase3-cutover-r2.md`

## Notes

- `phase3_strict` で core scope を Podman DB へ再実行し、全 91 件が通過した。
- local strict 用に追加した demo seed の broad policy が guard 系 E2E を上書きしないよう、`backend-action-policy-ack-guard` と `backend-agent-first-mvp` は対象 action の competing policy を一時無効化して検証する形へ補正した。
- `backend-vendor-invoice-linking` は、post-submit の reason 必須を fallback ではなく explicit `requireReason` policy で検証する形へ補正した。
- `frontend-smoke-invoice-send-mark-paid` は、現行実装どおり invoice submit -> approval approve -> send を経てから non-admin の UI 制御を確認するよう補正した。

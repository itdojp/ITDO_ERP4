# ActionPolicy phase3 strict Podman smoke

- date: 2026-03-09
- command: `ACTION_POLICY_ENFORCEMENT_PRESET=phase3_strict make podman-smoke`
- result: PASS
- sourceLog: `tmp/2026-03-09-action-policy-phase3-podman-smoke.log`
- backendLog: `tmp/podman-smoke-backend.log`
- sourceReadinessRecord: `docs/test-results/2026-03-08-action-policy-phase3-readiness-r2.md`
- sourceCutoverRecord: `docs/test-results/2026-03-08-action-policy-phase3-cutover-r2.md`

## Notes

- demo seed に local strict rehearsal 用の `ActionPolicy` 行を追加し、`phase3_strict` でも Podman smoke を完走できるようにした。
- `invoice:send` は approval evidence gate 対象のため、`scripts/smoke-backend.sh` で submit 後に approval instance を `approved` まで進めてから送信するよう補正した。
- 実行結果は `smoke ok` / `podman smoke ok` で、`estimate/invoice/expense/purchase_order/vendor_invoice` の主要 submit/send 導線を local strict preset で確認した。

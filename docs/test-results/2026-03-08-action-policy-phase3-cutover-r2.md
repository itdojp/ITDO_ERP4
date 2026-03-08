# ActionPolicy phase3 cutover 記録

- generatedAt: 2026-03-08T08:50:01Z
- sourceReadinessRecord: `docs/test-results/2026-03-08-action-policy-phase3-readiness-r2.md`
- branch: ops/1312-phase3-local-rehearsal
- commit: b56b5d31
- fromPreset: `phase2_core`
- toPreset: `phase3_strict`

## 事前 readiness

- ready: yes
- from/to: 2026-03-07T08:49:19.712Z -> 2026-03-08T08:49:19.712Z
- missing_static_callsites: 0
- stale_required_actions: 0
- dynamic_callsites: 0
- fallback_unique_keys: 0
- fallback_high_risk_keys: 0
- fallback_medium_risk_keys: 0
- fallback_unknown_risk_keys: 0

## 切替手順

```bash
DATABASE_URL='postgresql://postgres:postgres@localhost:55444/postgres?schema=public' npm run build --prefix packages/backend
DATABASE_URL='postgresql://postgres:postgres@localhost:55444/postgres?schema=public' make action-policy-callsites-report
DATABASE_URL='postgresql://postgres:postgres@localhost:55444/postgres?schema=public' make action-policy-required-action-gaps
RUN_LABEL=r2 DATABASE_URL='postgresql://postgres:postgres@localhost:55444/postgres?schema=public' make action-policy-phase3-trial-record
DATABASE_URL='postgresql://postgres:postgres@localhost:55444/postgres?schema=public' node --test packages/backend/test/invoicePolicyEnforcementPreset.test.js packages/backend/test/invoiceMarkPaidPolicyEnforcementPreset.test.js packages/backend/test/purchaseOrderPolicyEnforcementPreset.test.js packages/backend/test/expensePolicyEnforcementPreset.test.js packages/backend/test/vendorInvoiceSubmitPolicyEnforcementPreset.test.js packages/backend/test/vendorInvoiceEditPolicyEnforcementPreset.test.js packages/backend/test/vendorInvoiceLinkPoRoutes.test.js packages/backend/test/sendPolicyEnforcementPreset.test.js packages/backend/test/approvalActionPolicyPreset.test.js packages/backend/test/approvalEvidenceGate.test.js packages/backend/test/estimatePolicyEnforcementPreset.test.js packages/backend/test/timeEntriesPolicyEnforcementPreset.test.js packages/backend/test/leavePolicyEnforcementPreset.test.js
```

- [ ] `phase3_strict` へ切替した
- [ ] アプリ再起動 / 再デプロイを実施した

補足:

- この記録は PoC ローカル環境（Podman PostgreSQL / `localhost:55444`）での rehearsal。
- `phase3_strict` の分岐自体は route preset test の `phase3_strict` ケースで確認した。
- 実アプリ設定変更と再デプロイは、この local rehearsal では未実施。

## 主要操作確認

- [x] `invoice:send`
- [x] `invoice:mark_paid`
- [x] `purchase_order:send`
- [x] `expense:submit`
- [x] `expense:mark_paid`
- [x] `vendor_invoice:submit`
- [x] `vendor_invoice:update_lines`
- [x] `vendor_invoice:update_allocations`
- [x] `*:approve`
- [x] `*:reject`

参照:

- `packages/backend/test/sendPolicyEnforcementPreset.test.js`
- `packages/backend/test/invoiceMarkPaidPolicyEnforcementPreset.test.js`
- `packages/backend/test/purchaseOrderPolicyEnforcementPreset.test.js`
- `packages/backend/test/expensePolicyEnforcementPreset.test.js`
- `packages/backend/test/vendorInvoiceSubmitPolicyEnforcementPreset.test.js`
- `packages/backend/test/vendorInvoiceEditPolicyEnforcementPreset.test.js`
- `packages/backend/test/vendorInvoiceLinkPoRoutes.test.js`
- `packages/backend/test/approvalActionPolicyPreset.test.js`
- `packages/backend/test/approvalEvidenceGate.test.js`
- `packages/backend/test/estimatePolicyEnforcementPreset.test.js`
- `packages/backend/test/timeEntriesPolicyEnforcementPreset.test.js`
- `packages/backend/test/leavePolicyEnforcementPreset.test.js`
- 実行結果: `90 pass / 0 fail`

## 切替後 fallback 確認

- [x] `make action-policy-fallback-report-json` で新規 fallback key が 0 件
- [x] 影響があれば `flowType:actionKey:targetTable` を記録した

```text
(none)
```

## ロールバック

- [ ] ロールバック不要
- [ ] `phase2_core` へロールバックした
- [ ] `ACTION_POLICY_REQUIRED_ACTIONS` 明示指定で段階復旧した

## 所見

- local rehearsal としては、readiness / callsites / required-action-gaps / representative route preset tests まで確認できた。
- 実環境で未実施なのは `phase3_strict` の設定反映、再デプロイ、ロールバック手順の実地確認。
- `#1312` / `#1308` の残件はこの実環境 trial のみ。

# ActionPolicy phase3 cutover 記録

- generatedAt: 2026-03-08T08:22:45Z
- sourceReadinessRecord: `docs/test-results/2026-03-08-action-policy-phase3-readiness-r1.md`
- branch: ops/1312-phase3-trial
- commit: 83a143cd
- fromPreset: `phase2_core`
- toPreset: `phase3_strict`

## 事前 readiness

- ready: yes
- from/to: 2026-03-07T08:22:04.406Z -> 2026-03-08T08:22:04.406Z
- missing_static_callsites: 0
- stale_required_actions: 0
- dynamic_callsites: 0
- fallback_unique_keys: 0
- fallback_high_risk_keys: 0
- fallback_medium_risk_keys: 0
- fallback_unknown_risk_keys: 0

## 切替手順

```bash
make action-policy-phase3-readiness-record
# 環境変数または設定を phase3_strict に変更
make action-policy-fallback-report
make action-policy-fallback-report-json
```

- [ ] `phase3_strict` へ切替した
- [ ] アプリ再起動 / 再デプロイを実施した

## 主要操作確認

- [ ] `invoice:send`
- [ ] `invoice:mark_paid`
- [ ] `purchase_order:send`
- [ ] `expense:submit`
- [ ] `expense:mark_paid`
- [ ] `vendor_invoice:submit`
- [ ] `vendor_invoice:update_lines`
- [ ] `vendor_invoice:update_allocations`
- [ ] `*:approve`
- [ ] `*:reject`

## 切替後 fallback 確認

- [ ] `make action-policy-fallback-report-json` で新規 fallback key が 0 件
- [ ] 影響があれば `flowType:actionKey:targetTable` を記録した

```text
(none)
```

## ロールバック

- [ ] ロールバック不要
- [ ] `phase2_core` へロールバックした
- [ ] `ACTION_POLICY_REQUIRED_ACTIONS` 明示指定で段階復旧した

## 所見

-

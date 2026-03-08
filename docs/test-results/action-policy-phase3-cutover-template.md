# ActionPolicy phase3 cutover 記録テンプレート

- 実施日: YYYY-MM-DD
- 実施者:
- 対象Issue: #1312, #1308
- 対象環境:
- 切替前 preset: `phase2_core`
- 切替後 preset: `phase3_strict`
- 事前 readiness 記録:

## 事前 readiness

- ready:
- from/to:
- missing_static_callsites:
- stale_required_actions:
- dynamic_callsites:
- fallback_unique_keys:
- fallback_high_risk_keys:
- fallback_medium_risk_keys:
- fallback_unknown_risk_keys:

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

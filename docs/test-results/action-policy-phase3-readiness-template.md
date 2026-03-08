# ActionPolicy phase3 readiness 記録テンプレート

- 実施日: YYYY-MM-DD
- 実施者:
- 対象Issue: #1312, #1308
- 対象環境:

## 実行コマンド

```bash
make action-policy-callsites-report
make action-policy-required-action-gaps
make action-policy-required-action-gaps-json
make action-policy-phase3-readiness
make action-policy-phase3-readiness-json
make action-policy-fallback-report
make action-policy-fallback-report-json
```

```bash
# 推奨: 観測結果と docs/test-results 記録を一括生成
make action-policy-phase3-readiness-record
# readiness 記録から cutover 記録まで続けて開始する場合
make action-policy-phase3-trial-record
```

## 前提

- `make action-policy-phase3-readiness*` / `make action-policy-fallback-report*` を実行する前に `npm run build --prefix packages/backend` 実行済み
- `make action-policy-phase3-readiness*` / `make action-policy-fallback-report*` を実行する前に `DATABASE_URL` が対象環境の監査ログを参照できる値
- 観測窓（既定は直近24時間）を必要に応じて明示指定

## 結果サマリ

- callsites:
- ready:
- from/to:
- missing_static_callsites:
- stale_required_actions:
- dynamic_callsites:
- fallback_unique_keys:
- fallback_high_risk_keys:
- fallback_medium_risk_keys:
- fallback_unknown_risk_keys:

## Blockers

```text
(none)
```

## Fallback Keys

```text
(none)
```

## 判定

- [ ] `phase3_strict` 移行可能
- [ ] 追加の ActionPolicy 整備が必要

## 次アクション

-

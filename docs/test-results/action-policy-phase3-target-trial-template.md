# ActionPolicy phase3 target-environment trial 記録テンプレート

- 実施日: YYYY-MM-DD
- 実施者:
- 対象Issue: #1426, #1875
- 対象環境:
- trialStatus: `blocked|failed|pass`
- rollbackStatus: `not_tested|not_required|failed|verified`
- sourceReadinessRecord:
- sourceCutoverRecord:
- operationResultsFile:
- postFallbackReportJson:
- rollbackFallbackReportJson:

## 生成コマンド

対象環境で事前 readiness と cutover record を採取したあと、主要操作確認と rollback 確認の証跡ファイルを指定して実行する。

```bash
TARGET_ENVIRONMENT=staging \
OPERATOR=alice \
TRIAL_STATUS=pass \
CUTOVER_AT=YYYY-MM-DDTHH:MM:SSZ \
READINESS_RECORD_FILE=docs/test-results/YYYY-MM-DD-action-policy-phase3-readiness-rN.md \
CUTOVER_RECORD_FILE=docs/test-results/YYYY-MM-DD-action-policy-phase3-cutover-rN.md \
OPERATION_RESULTS_FILE=docs/test-results/YYYY-MM-DD-action-policy-phase3-target-ops-rN.md \
POST_FALLBACK_REPORT_JSON=tmp/action-policy-phase3-target/post-fallback.json \
ROLLBACK_STATUS=verified \
ROLLBACK_AT=YYYY-MM-DDTHH:MM:SSZ \
ROLLBACK_FALLBACK_REPORT_JSON=tmp/action-policy-phase3-target/rollback-fallback.json \
make action-policy-phase3-target-trial-record
```

## pass 記録の必須条件

`TRIAL_STATUS=pass` の record は、script 側で以下を強制する。

- `TARGET_ENVIRONMENT` と `OPERATOR` が空ではない
- `READINESS_RECORD_FILE` と `CUTOVER_RECORD_FILE` が明示指定されている
- `CUTOVER_AT` が設定されている
- `OPERATION_RESULTS_FILE` が存在し、主要操作確認の必須行がすべて checked である
- `POST_FALLBACK_REPORT_JSON` が存在し、`uniqueKeys` が `0`
- `ROLLBACK_STATUS=verified`
- `ROLLBACK_AT` が設定されている
- `ROLLBACK_FALLBACK_REPORT_JSON` が存在する

## 主要操作確認

`OPERATION_RESULTS_FILE` には少なくとも以下を記録する。

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

各行には、実行者、対象データID、期待結果、実結果、関連する audit log / screen / API response の参照を含める。

## 判定

- `pass`: 主要操作、cutover 後 fallback 0 件、rollback 確認まで揃った状態。
- `failed`: 対象環境で trial を実施したが、主要操作・fallback・rollback のいずれかが失敗した状態。
- `blocked`: 対象環境、権限、運用ウィンドウ、確認担当、データ準備などが不足し、trial 未完了の状態。

`blocked` または `failed` の場合は #1426 を close しない。

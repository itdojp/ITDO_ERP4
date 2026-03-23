# ActionPolicy `phase3_strict` Trial Runbook

更新日: 2026-03-24  
関連Issue: `#1426`, `#1308`, `#1312`

## 目的

対象環境で `ACTION_POLICY_ENFORCEMENT_PRESET=phase3_strict` を trial / cutover / rollback するための実運用手順を定義する。

本 runbook は、既存の方針資料を運用手順へ落とし込んだものです。設計根拠は以下を参照する。

- `docs/manual/agent-write-guardrails-guide.md`
- `docs/requirements/action-policy-high-risk-apis.md`
- `docs/requirements/action-policy-failsafe-inventory.md`

## 適用条件

以下を満たさない場合、`phase3_strict` へ切り替えない。

- 対象環境が現在 `ACTION_POLICY_ENFORCEMENT_PRESET=phase2_core` で安定運用中
- `docs/test-results/2026-03-08-action-policy-phase3-readiness-r2.md`
- `docs/test-results/2026-03-08-action-policy-phase3-cutover-r2.md`
- `docs/test-results/2026-03-09-action-policy-phase3-strict-podman-smoke-r1.md`
- `docs/test-results/2026-03-09-action-policy-phase3-strict-frontend-e2e-core-r1.md`
  の repo-side rehearsal 結果を確認済み
- 対象環境の `DATABASE_URL` で監査ログ参照が可能
- `npm run build --prefix packages/backend` 実行済み

## 実施担当

- 実施責任者: platform / backend owner
- 業務確認: finance / approval workflow owner
- 監視確認: ops owner

最低 2 名で実施し、cutover と rollback 判断を単独で行わない。

## 事前確認

### 1. Readiness 取得

以下を対象環境の設定で実行する。

```bash
make action-policy-callsites-report
make action-policy-required-action-gaps
make action-policy-phase3-readiness
make action-policy-fallback-report-json
```

### 2. 判定基準

以下をすべて満たすこと。

- `callsites: 20`
- `missing_static_callsites: 0`
- `stale_required_actions: 0`
- `dynamic_callsites: 0`
- `fallback_unique_keys: 0`

### 3. 記録採取

trial 開始時点で証跡を生成する。

```bash
make action-policy-phase3-readiness-record
```

readiness と cutover を連続採取する場合は以下を使う。

```bash
make action-policy-phase3-trial-record
```

## Cutover 手順

### 1. 設定反映

対象環境で以下を反映する。

まず cutover 観測開始時刻を固定する。

```bash
export CUTOVER_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

その後、以下を反映する。

```dotenv
ACTION_POLICY_ENFORCEMENT_PRESET=phase3_strict
```

`ACTION_POLICY_REQUIRED_ACTIONS` は原則未指定のままとする。個別復旧目的の一時設定は、rollback 手順でのみ使う。

### 2. 再起動

再デプロイまたは再起動を行う。

### 3. 主要操作確認

以下を最低確認対象とする。

- `invoice:send`
- `invoice:mark_paid`
- `purchase_order:send`
- `expense:submit`
- `expense:mark_paid`
- `vendor_invoice:submit`
- `vendor_invoice:update_lines`
- `vendor_invoice:update_allocations`
- `*:approve`
- `*:reject`

### 4. Fallback 確認

cutover 後に、cutover 以降の観測窓に限定して以下を実行する。

```bash
node scripts/report-action-policy-fallback-allowed.mjs \
  --format=json \
  --from="$CUTOVER_AT" \
  --to="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

node scripts/report-action-policy-phase3-readiness.mjs \
  --format=json \
  --from="$CUTOVER_AT" \
  --to="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

判定基準:

- fallback report で新規 fallback key が 0 件
- readiness report の `fallback_high_risk_keys` が `0`

### 5. Cutover 記録

```bash
make action-policy-phase3-cutover-record
```

## Rollback 条件

以下のいずれかを満たした場合は `phase2_core` へ戻す。

- 主要操作で業務継続不能な deny が発生
- `action_policy_fallback_allowed` の新規 key が発生
- 承認 / 証跡フローに想定外の拒否が発生
- 当日中の恒久修正が不可能

## Rollback 手順

### 1. 設定を戻す

まず rollback 観測開始時刻を固定する。

```bash
export ROLLBACK_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

その後、以下へ戻す。

```dotenv
ACTION_POLICY_ENFORCEMENT_PRESET=phase2_core
```

必要なら暫定的に `ACTION_POLICY_REQUIRED_ACTIONS` を明示し、対象操作のみ段階復旧する。

### 2. 再起動

設定反映後に再デプロイまたは再起動する。

### 3. 復旧確認

```bash
node scripts/report-action-policy-phase3-readiness.mjs \
  --format=json \
  --from="$ROLLBACK_AT" \
  --to="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

node scripts/report-action-policy-fallback-allowed.mjs \
  --format=json \
  --from="$ROLLBACK_AT" \
  --to="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

確認観点:

- rollback 前に問題となった操作が `phase2_core` で復旧している
- fallback report には復旧対象 key のみが再出現している

## 証跡

trial 完了後は以下を `docs/test-results/` に追加する。

- readiness record
- cutover / rollback 結果を含む cutover record
- 必要なら対象環境での操作ログ / 監査ログ抜粋

最低限、`#1426` のチェックリストに対応する evidence へリンクを残す。

## 失敗時の切り分け

### `ACTION_POLICY_DENIED`

- policy 未定義
- subject 不一致
- state / guard 不一致

確認:

- `make action-policy-required-action-gaps`
- `make action-policy-fallback-report-json`
- `GET /audit-logs`

### `APPROVAL_REQUIRED` / `EVIDENCE_REQUIRED`

- 承認未了
- evidence snapshot 未取得

確認:

- 対象インスタンスへ絞り込んだ `GET /approval-instances` または承認一覧 UI
- `GET /agent-runs/:id`
- 監査ログの `metadata._agent.runId`

## 事後処理

- `#1426` に trial / cutover / rollback の結果を記録
- 新規 fallback key があった場合は個別 issue を起票
- cutover 継続判断なら target environment の標準設定として `phase3_strict` を確定

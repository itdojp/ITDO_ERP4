# ActionPolicy fail-safe 移行 棚卸（Issue #1312）

更新日: 2026-03-04  
関連Issue: #1312

## 1. 目的

- `evaluateActionPolicyWithFallback` の適用箇所を固定し、未定義許可（fallback）を残す余地を可視化する。
- `phase2_core` / `phase3_strict` で必要となる最小ポリシーセットと例外運用を明文化する。

## 2. 棚卸方法

### 2.1 呼び出し箇所レポート

```bash
node scripts/report-action-policy-callsites.mjs --format=text
```

- 取得対象: `packages/backend/src/routes/**/*.ts`
- 出力項目: `flowType`, `actionKey`, `targetTable`, `risk`, `file`, `line`
- リスク判定:
  - `high`: 財務確定系（invoice/expense/vendor_invoice/purchase_order）、承認操作、動的判定
  - `medium`: 工数/休暇/見積送信・申請系

### 2.2 fallback監査レポート

```bash
node scripts/report-action-policy-fallback-allowed.mjs --format=text
```

- 監査ログ `action_policy_fallback_allowed` の発生キーを集計
- 監査件数は重複抑制の影響を受けるため、定期集計ジョブで推移を追う

### 2.3 required actions ギャップレポート

```bash
node scripts/report-action-policy-required-action-gaps.mjs --format=text
```

- `policyEnforcementPreset.ts` の `PHASE2_CORE_ACTION_POLICY_REQUIRED_ACTIONS` を読み取り
- static callsite と required actions の差分を検出
- dynamic callsite（例: `instance.flowType/body.action`）を別枠で可視化

## 3. 呼び出し箇所（2026-03-04時点）

合計 19 callsites（routeのみ）。

### 3.1 高リスク（fallback残存不可）

- `invoice:submit`, `invoice:mark_paid`, `invoice:send`
- `purchase_order:submit`, `purchase_order:send`
- `expense:submit`, `expense:mark_paid`, `expense:unmark_paid`
- `vendor_invoice:update_allocations`, `vendor_invoice:update_lines`, `vendor_invoice:link_po`, `vendor_invoice:unlink_po`, `vendor_invoice:submit`
- `*:approve`, `*:reject`（`approvalRules.ts` は `instance.flowType` / `body.action` の動的評価）

### 3.2 中リスク（移行期間に限定してfallback許可を許容）

- `estimate:submit`, `estimate:send`
- `time:edit`, `time:submit`
- `leave:submit`

注記: 中リスク操作も最終的には `phase3_strict` で未定義拒否へ移行する。

## 4. 最小ポリシーセット（現行）

`ACTION_POLICY_ENFORCEMENT_PRESET=phase2_core` の既定 required actions:

- `estimate:submit, estimate:send`
- `invoice:submit, invoice:mark_paid, invoice:send`
- `purchase_order:submit, purchase_order:send`
- `expense:submit, expense:mark_paid, expense:unmark_paid`
- `time:edit, time:submit`
- `leave:submit`
- `vendor_invoice:update_allocations, vendor_invoice:update_lines, vendor_invoice:link_po, vendor_invoice:unlink_po, vendor_invoice:submit`
- `*:approve, *:reject`

`ACTION_POLICY_ENFORCEMENT_PRESET=phase3_strict` の既定:

- `ACTION_POLICY_REQUIRED_ACTIONS=*:*`（未定義=拒否）

## 5. 例外運用（admin/mgmt override）

### 5.1 共通ルール

- 例外許可は `admin` / `management` のみ
- 理由文字列（`reason`）を必須化
- `action_policy_override` を監査ログへ記録

### 5.2 現状制約

- guard override 対象は `chat_ack_completed` のみ
- `approval_open` / `period_lock` などへの管理者例外は未実装

## 6. 運用判断基準

- `phase2_core` 期間:
  - fallback発生キーが高リスクに含まれる場合は即時にActionPolicy追加
  - fallback発生キーが中リスクのみで、監査推移が減少しているなら継続可
- `phase3_strict` 移行条件:
  - fallbackレポートで高リスクキー 0
  - 主要業務の回帰テスト（send/vendor_invoice/time/leave）が green
  - required actions ギャップレポートで static callsite の missing 0

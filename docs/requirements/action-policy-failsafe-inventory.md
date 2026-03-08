# ActionPolicy fail-safe 移行 棚卸（Issue #1312）

更新日: 2026-03-06  
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

### 2.4 phase3 readiness レポート

```bash
node scripts/report-action-policy-phase3-readiness.mjs --format=text
```

- required actions ギャップと fallback 集計を 1 回で確認する
- `ready`, `blockers[]`, `fallbackSummary` を出力する
- 実行前提は `packages/backend` build 済み、かつ `DATABASE_URL` が対象環境の監査ログを参照できること
- 既定観測窓は直近 24 時間。切替判定では必要に応じて `--from/--to` を明示する
- `phase3_strict` 切替前の go/no-go 判定に使う

## 3. 呼び出し箇所（2026-03-06 時点）

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

### 3.3 route callsite 一覧（script 出力を整理）

| flowType            | actionKey            | targetTable          | risk   | file                                                |
| ------------------- | -------------------- | -------------------- | ------ | --------------------------------------------------- |
| `estimate`          | `send`               | `estimates`          | medium | `packages/backend/src/routes/send.ts:377`           |
| `estimate`          | `submit`             | `estimates`          | medium | `packages/backend/src/routes/estimates.ts:138`      |
| `expense`           | `mark_paid`          | `expenses`           | high   | `packages/backend/src/routes/expenses.ts:1185`      |
| `expense`           | `submit`             | `expenses`           | high   | `packages/backend/src/routes/expenses.ts:1023`      |
| `expense`           | `unmark_paid`        | `expenses`           | high   | `packages/backend/src/routes/expenses.ts:1342`      |
| `instance.flowType` | `body.action`        | `approval_instances` | high   | `packages/backend/src/routes/approvalRules.ts:790`  |
| `invoice`           | `mark_paid`          | `invoices`           | high   | `packages/backend/src/routes/invoices.ts:421`       |
| `invoice`           | `send`               | `invoices`           | high   | `packages/backend/src/routes/send.ts:620`           |
| `invoice`           | `submit`             | `invoices`           | high   | `packages/backend/src/routes/invoices.ts:525`       |
| `leave`             | `submit`             | `leave_requests`     | medium | `packages/backend/src/routes/leave.ts:739`          |
| `purchase_order`    | `send`               | `purchase_orders`    | high   | `packages/backend/src/routes/send.ts:863`           |
| `purchase_order`    | `submit`             | `purchase_orders`    | high   | `packages/backend/src/routes/purchaseOrders.ts:112` |
| `time`              | `edit`               | `time_entries`       | medium | `packages/backend/src/routes/timeEntries.ts:238`    |
| `time`              | `submit`             | `time_entries`       | medium | `packages/backend/src/routes/timeEntries.ts:430`    |
| `vendor_invoice`    | `link_po`            | `vendor_invoices`    | high   | `packages/backend/src/routes/vendorDocs.ts:1252`    |
| `vendor_invoice`    | `submit`             | `vendor_invoices`    | high   | `packages/backend/src/routes/vendorDocs.ts:1544`    |
| `vendor_invoice`    | `unlink_po`          | `vendor_invoices`    | high   | `packages/backend/src/routes/vendorDocs.ts:1420`    |
| `vendor_invoice`    | `update_allocations` | `vendor_invoices`    | high   | `packages/backend/src/routes/vendorDocs.ts:435`     |
| `vendor_invoice`    | `update_lines`       | `vendor_invoices`    | high   | `packages/backend/src/routes/vendorDocs.ts:789`     |

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

### 4.1 coverage 確認（2026-03-06）

- `node scripts/report-action-policy-required-action-gaps.mjs --format=text` の結果:
  - `missing_static_callsites: 0`
  - `stale_required_actions: 0`
  - `dynamic_callsites: 0`
- `scripts/report-action-policy-callsites.mjs` は承認アクション共通 route を `*:approve` / `*:reject` に静的展開する。
- したがって、`phase2_core` の required actions は現行の static route callsite を全て被覆済みである。

### 4.1.1 route preset テストの被覆

- 高リスク:
  - `invoice:submit` → `packages/backend/test/invoicePolicyEnforcementPreset.test.js`
  - `invoice:mark_paid` → `packages/backend/test/invoiceMarkPaidPolicyEnforcementPreset.test.js`
  - `invoice:send` → `packages/backend/test/sendPolicyEnforcementPreset.test.js`
  - `purchase_order:submit` → `packages/backend/test/purchaseOrderPolicyEnforcementPreset.test.js`
  - `purchase_order:send` → `packages/backend/test/sendPolicyEnforcementPreset.test.js`
  - `expense:submit` / `expense:mark_paid` / `expense:unmark_paid` → `packages/backend/test/expensePolicyEnforcementPreset.test.js`
  - `vendor_invoice:submit` → `packages/backend/test/vendorInvoiceSubmitPolicyEnforcementPreset.test.js`
  - `vendor_invoice:update_allocations` / `vendor_invoice:update_lines` → `packages/backend/test/vendorInvoiceEditPolicyEnforcementPreset.test.js`
  - `vendor_invoice:link_po` / `vendor_invoice:unlink_po` → `packages/backend/test/vendorInvoiceLinkPoRoutes.test.js`
  - `*:approve` / `*:reject` → `packages/backend/test/approvalActionPolicyPreset.test.js`
- 中リスク:
  - `estimate:submit` → `packages/backend/test/estimatePolicyEnforcementPreset.test.js`
  - `estimate:send` → `packages/backend/test/sendPolicyEnforcementPreset.test.js`
  - `time:edit` / `time:submit` → `packages/backend/test/timeEntriesPolicyEnforcementPreset.test.js`
  - `leave:submit` → `packages/backend/test/leavePolicyEnforcementPreset.test.js`

補足:

- vendor invoice edit 系は `vendorInvoiceEditPolicyEnforcementPreset.test.js` に収束させ、重複カバレッジは持たない運用とする。
- 送信系の deny/allow は ActionPolicy preset に加えて、承認・証跡ゲートの回帰 (`approvalEvidenceGate.test.js`) と合わせて確認する。

### 4.2 flowType別の既定方針（A1時点）

| flowType         | 最低 actionKey                                                         | subjects 既定               | stateConstraints 既定                                      | guards 既定                                            |
| ---------------- | ---------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `estimate`       | `submit`, `send`                                                       | 案件スコープ一致（project） | `send` は承認済み状態のみ                                  | `approval_open`（send系）                              |
| `invoice`        | `submit`, `mark_paid`, `send`                                          | 案件/請求書主体一致         | `mark_paid` は未入金状態のみ、`send` は送信可能状態のみ    | `approval_open`（send系）                              |
| `purchase_order` | `submit`, `send`                                                       | 案件/発注主体一致           | 終端状態（cancelled/closed）では拒否                       | `approval_open`（send系）                              |
| `vendor_invoice` | `update_allocations`, `update_lines`, `link_po`, `unlink_po`, `submit` | 仕入請求書主体一致          | `paid` は原則変更不可、`pending_qa` 以降は管理者のみ変更可 | `approval_open`（submit）、必要時 `chat_ack_completed` |
| `expense`        | `submit`, `mark_paid`, `unmark_paid`                                   | 本人申請 + 経理ロール       | `mark_paid` は支払前のみ、`unmark_paid` は支払済みのみ     | `approval_open`（submit）                              |
| `time`           | `edit`, `submit`                                                       | 本人/管理者（対象メンバー） | editableDays/期間ロックに従う                              | `editable_days`, `period_lock`                         |
| `leave`          | `submit`                                                               | 本人申請                    | 期間ロックと重複申請制約に従う                             | `period_lock`                                          |
| `*`              | `approve`, `reject`                                                    | 承認者一致                  | 承認インスタンス有効時のみ                                 | `approval_open`                                        |

注記:

- `subjects/stateConstraints/guards` の最終表現は ActionPolicy レコードと route 前段チェックの組み合わせで実装する。
- 上表は fail-safe 移行時の「最低限守るべき既定」を定義したもの。

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
  - fallbackレポートで `flowType:actionKey:targetTable` ベースの未収束キー 0
  - fallbackレポートで高リスクキー 0
  - 主要業務の route preset / send preset（send + evidence gate）回帰テスト（invoice / purchase_order / expense / vendor_invoice / estimate / time / leave / approval）が green
  - required actions ギャップレポートで static callsite の missing 0
  - 試験運用時は `make action-policy-phase3-readiness-record` で readiness / fallback 集計の証跡を `docs/test-results/` に保存する
  - readiness 記録から cutover 記録までまとめて開始する場合は `make action-policy-phase3-trial-record` を使い、同じ run label の readiness / cutover 記録を一対で残す

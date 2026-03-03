# Agent Write ガードレール運用ガイド（Phase 2）

更新日: 2026-02-24  
関連Issue: #1206

## 目的

エージェント経由の書き込み操作を、`ActionPolicy`・承認・証跡で制御する運用手順を示す。

## 関連仕様

- 方針全体: `docs/requirements/agent-first-erp.md`
- 高リスクAPIカタログ: `docs/requirements/action-policy-high-risk-apis.md`

## 対象API（MVP）

- Draft作成系
  - `POST /drafts`
  - `POST /drafts/regenerate`
  - `POST /drafts/diff`
- 送信系
  - `POST /estimates/:id/send`
  - `POST /invoices/:id/send`
  - `POST /purchase-orders/:id/send`
- 承認アクション
  - `POST /approval-instances/:id/act`

## 必須設定（推奨）

本番・検証環境は以下を基本値とする。

- `ACTION_POLICY_ENFORCEMENT_PRESET=phase2_core`
- `ACTION_POLICY_REQUIRED_ACTIONS` は通常未指定（必要時のみ明示上書き）
- `APPROVAL_EVIDENCE_REQUIRED_ACTIONS` は通常未指定（必要時のみ明示上書き）

補足:

- 未指定時は `phase2_core` の既定 action 一覧を適用する。
- 明示CSVを設定した場合は明示値を優先する。
- `phase3_strict` は `ACTION_POLICY_REQUIRED_ACTIONS=*:*` 相当の fail-safe モードとして利用できる（段階移行後に適用）。

## 実行フロー（請求送信の標準例）

1. `POST /drafts` で送信文面ドラフトを生成
2. 対象請求を `submit` して承認インスタンスを作成
3. `POST /approval-instances/:id/act` で承認完了
4. Evidence Snapshot を取得済みであることを確認
5. `POST /invoices/:id/send` を実行

## 代表エラーコードと対処

- `ACTION_POLICY_DENIED`
  - 原因: policy未定義、subject不一致、state/guard不一致
  - 対処: policy定義・対象ロール・状態遷移を見直す
- `APPROVAL_REQUIRED`
  - 原因: 承認未了、または `approval_open` guard 失敗
  - 対処: 承認フロー完了後に再実行
- `EVIDENCE_REQUIRED`
  - 原因: 承認済みだが Evidence Snapshot 未取得
  - 対処: snapshot取得後に再実行
- `REASON_REQUIRED`
  - 原因: `requireReason=true` の policy で理由未入力
  - 対処: エンドポイント仕様に合わせて理由項目を補完して再実行（例: 承認APIは body の `reason`、送信系は query の `reasonText`）

## 監査確認ポイント

- 監査ログで以下の整合を確認する。
  - 誰が（principal/actor）
  - 何を（API/action）
  - なぜ（reason）
  - 根拠（approval/evidence）
- deny時の `error.code` が標準コード（上記4種）であることを確認する。

### deny時の確認手順（AgentRun）

1. `GET /audit-logs` で対象 deny イベント（`ACTION_POLICY_DENIED` / `APPROVAL_REQUIRED` / `EVIDENCE_REQUIRED` / `REASON_REQUIRED`）を検索する
2. `metadata._agent.runId`（または `agentRunId`）を特定する
3. `GET /agent-runs/:id` で `steps[].errorCode` と `steps[].decisions[]` を確認する
   - `policy_denied` の場合: `decisionType=policy_override`
   - `approval_required` の場合: `decisionType=approval_required`
4. override を行う場合は理由を付与し、監査ログの `action_policy_override` を確認する

## テスト参照

- `packages/backend/test/draftRoutes.test.js`
- `packages/backend/test/sendPolicyEnforcementPreset.test.js`
- `packages/backend/test/approvalActionPolicyPreset.test.js`
- `packages/backend/test/approvalEvidenceGate.test.js`
- `packages/backend/test/agentRunRecorder.test.js`
- `packages/frontend/e2e/frontend-smoke-audit-agent-run.spec.ts`

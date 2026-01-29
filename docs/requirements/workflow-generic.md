# ワークフロー汎用化（承認 + アクション権限/ロック）設計

## 目的

- 多段承認、並列/順不同の承認（all/any/quorum 等）を、管理画面から柔軟に設定・変更できるようにする。
- 承認だけでは表現できない「編集ロック」「権限」「例外（管理者上書き）」を共通化し、ドメイン別実装の重複と手戻りを削減する。

## 決定事項（現行運用）

- 対象範囲
  - 承認: WorkflowDefinition（現 `ApprovalRule`）+ 承認インスタンス（`ApprovalInstance/Step`）
  - 権限/ロック: `ActionPolicy + Guard`（`flowType × actionKey × state` + 定義済み横断判定部品）
  - 副作用（送信/入金確認/支払確定 等）は Handler としてコード側に残し、管理画面から任意スクリプトは実行させない。
- 変更適用ポリシー
  - 承認ルール（ApprovalRule）は原則「新規申請から適用」。
    - 申請時に `ApprovalInstance.stagePolicy` をスナップショット保持し、進行中の承認はルール変更の影響を受けない。
    - 進行中に適用が必要な場合は、管理者運用（取消→再申請、上書き等）で吸収する。
  - ActionPolicy/Guard は各操作時に評価されるため、ポリシー変更は以後の操作に即時反映される。
    - Phase 3 は移行期のため「該当 ActionPolicy が無い場合は許可（fallback）」として既存動作を維持する。

## 用語

- **flowType**: 承認/ワークフロー適用対象の種別（例: `invoice`, `expense`）。現行は `FlowType` enum を使用。
- **target**: ワークフロー対象の実体（例: invoices テーブルの1行）。`targetTable + targetId` で参照。
- **approval workflow**: 承認インスタンス（ApprovalInstance/Step）により表現される承認プロセス。
- **actionKey**: 画面/API上の操作を表す共通キー（例: `edit`, `submit`, `send`, `mark_paid`）。
- **ActionPolicy**: `flowType × actionKey × state` で実行可否と要件（role、理由必須、ガード等）を定義するポリシー。
- **Guard**: 期間締め/案件closed/editableDays 等の横断判定部品（管理画面から「定義済み部品」を選択）。
- **Handler**: 送信/入金確認など副作用を伴う処理（安全性のためコード側に固定し、管理画面で任意スクリプトは許容しない）。

## actionKey 辞書（暫定/実装済み中心）

ActionPolicy/WorkflowDefinition で参照する **共通キー**として扱う。

### 共通 actionKey（現状）

- `edit`: 文書の更新（例: PATCH/PUT）
- `submit`: 承認申請（submitApprovalWithUpdate 相当）
- `send`: 対外送付（メール送信等の副作用は **Handler**）
- `mark_paid`: 入金/支払の確定
- `link_po`: 発注書（PO）との紐づけ
- `unlink_po`: PO 紐づけ解除

注:

- `cancel` / `reject` / `return`（差戻し）等の語彙は、現行実装（DocStatus）と要件差分が残っているため Phase 0 で確定する。

### FlowType別の主な対応エンドポイント（現行）

- estimate: `submit` -> `POST /estimates/:id/submit`, `send` -> `POST /estimates/:id/send`
- invoice: `submit` -> `POST /invoices/:id/submit`, `send` -> `POST /invoices/:id/send`, `mark_paid` -> `POST /invoices/:id/mark-paid`
- purchase_order: `submit` -> `POST /purchase-orders/:id/submit`, `send` -> `POST /purchase-orders/:id/send`
- vendor_invoice: `submit` 相当 -> `POST /vendor-invoices/:id/approve`（命名差分あり）
- expense: `submit` -> `POST /expenses/:id/submit`
- leave: `submit` -> `POST /leave-requests/:id/submit`
- time: `submit` -> `POST /time-entries/:id/submit`, `edit` -> `PATCH /time-entries/:id`

## 現行実装（調査結果の要約）

### 承認（共通基盤）

- DB: `ApprovalRule` / `ApprovalInstance` / `ApprovalStep` が存在し、`flowType` と `targetTable/targetId` で汎用化されている。
  - `packages/backend/prisma/schema.prisma`
- 申請時に `ApprovalInstance/Step` を生成し、承認は `/approval-instances/:id/act` で進行する。
  - `packages/backend/src/services/approval.ts`
  - `packages/backend/src/routes/approvalRules.ts`
- 現行の並列承認は `parallelKey` を `stepOrder` に正規化して同一 stepOrder に束ねる方式。
  - `packages/backend/src/services/approvalLogic.ts`

### 制約

- （調査時点の）現行の「並列ステージ」は **同一 stepOrder 内の全ステップ承認（all-of）** が前提で、`any` / `quorum` は表現できなかった（本設計・実装により解消済み）。
- 承認完了/取消に伴う target status 更新は `targetTable` ごとの分岐で個別。
  - `packages/backend/src/services/approval.ts`（`updateTargetStatus`）
  - `packages/backend/src/routes/approvalRules.ts`（`resetTargetStatus`）
- 承認以外の状態遷移（送信/入金確認等）や編集ロック（期間締め、案件closed、editableDays 等）は各ドメインで個別実装。
  - 例: `packages/backend/src/routes/send.ts`, `packages/backend/src/routes/invoices.ts`, `packages/backend/src/routes/timeEntries.ts`

## 要件（Phase 0-2 で確定させる項目）

### 承認ワークフロー

- 多段承認（ステージ順序）
- ステージ内の完了条件
  - `all`: 全員/全グループの承認が必要
  - `any`: いずれか1名/1グループの承認で完了
  - `quorum(n)`: n件の承認で完了
- 申請時スナップショット（進行中の承認は定義変更の影響を受けない）
- 変更適用ポリシー（原則: 新規申請から適用。進行中は admin/mgmt の運用で吸収）
- 監査ログ（通常操作と admin override を区別、auto-cancel 等も追跡可能にする）

### 承認以外（ロック/権限）

- ActionPolicy の導入（共通 actionKey、理由必須、許可ロール、ガード）
- Guard の部品化（定義済み部品を組み合わせて適用）
- Handler の責務分離（副作用はコード側に固定）

## 提案設計（Phase 1: 承認ワークフロー定義の拡張）

### 1) WorkflowDefinition（現 ApprovalRule）の後方互換拡張

`ApprovalRule.steps` は Json のため、**既存配列形式**と**新形式**を併用し後方互換とする。

- 既存（legacy）
  - `steps: [{ approverGroupId/approverUserId, stepOrder?, parallelKey? }, ...]`
- 新形式（案）
  - `steps: { stages: [{ order, label?, completion, approvers: [...] }, ...] }`

例（案）:

```json
{
  "stages": [
    {
      "order": 1,
      "label": "管理部",
      "completion": { "mode": "all" },
      "approvers": [{ "type": "group", "id": "mgmt" }]
    },
    {
      "order": 2,
      "label": "経営",
      "completion": { "mode": "quorum", "quorum": 1 },
      "approvers": [{ "type": "group", "id": "exec" }]
    }
  ]
}
```

注:

- approver の `type=role` を許容するかは要設計（現行は groupIds ベース）。
- reject の扱い（any reject で即却下/閾値方式等）は要設計。現行実装は「rejectで即クローズ」。

### 2) 申請時スナップショット（ApprovalInstanceへの保持）

実装を最小にするため、ApprovalInstance に **ステージ完了条件（stagePolicy）** を snapshot として保持する方式を採用する（案）。

- `ApprovalInstance.stagePolicy`（Json）: `{ [stepOrder]: { mode: 'all'|'any'|'quorum', quorum?: number } }`
- instance 作成時に rule の定義を解釈して stagePolicy を生成し保存する。

代替案:

- `ApprovalStage(instanceId, stepOrder, completionMode, quorum, ...)` の新設（検索性は上がるが移行/実装が増える）。

### 3) 承認実行ロジック（act）の拡張

- `mode=all`: 現行通り（同一 stepOrder の pending が無くなるまで待つ）
- `mode=any/quorum`: 完了条件を満たした時点で、同一 stepOrder の未処理ステップを **自動キャンセル**（`status=cancelled`, `actedBy='system'` 等）し、次ステージへ進める。

注:

- 自動キャンセルは「後続ステージへ進んでいるのに、未処理ステップが残り続ける」状態を避け、承認可能者一覧や監査の整合を保つために必要。

## 提案設計（Phase 2: ActionPolicy + Guard）

### 1) ActionPolicy（案）

ActionPolicy は「どの state で、誰が、どの action を実行できるか」を定義する。

例（概念）:

- flowType: `invoice`
- actionKey: `edit`
- allowedRoles: `admin/mgmt`（または groupIds）
- stateConstraint: `draft|rejected` のみ（承認中は不可）
- requireReason: `false`
- guards: `[]`

#### データモデル（案）

- `ActionPolicy`
  - `id`
  - `flowType`
  - `actionKey`（共通キー。例: edit/submit/cancel/send/mark_paid/link_po）
  - `priority`（同一 actionKey で複数マッチする場合の優先度）
  - `isEnabled`
  - `subjects`（Json: roles/groupIds/userIds の OR 条件を想定）
  - `stateConstraints`（Json: 例 `status in [...]`、承認中/承認後の制約など）
  - `requireReason`（admin override 等で理由入力を強制する用途）
  - `guards`（Json: 定義済み Guard の配列。例 `[{type:'period_lock'},{type:'editable_days', params:{daysSettingKey:'worklog.editableDays'}}]`）
  - `createdAt/createdBy/updatedAt/updatedBy`

注:

- `subjects` は「roles と groupIds のどちらを主とするか」が未確定（現行は API 権限は roles、承認者判定は groupIds）。
- `stateConstraints` の最小は `status`（DocStatus）だが、TimeEntry/Leave 等は別ステートのため統合方式は要設計。

#### 評価順序（案）

1. `flowType` + `actionKey` が一致する policy を候補とする
2. `stateConstraints` を満たすものに絞り込む
3. `subjects`（role/group/user）に合致するものに絞り込む
4. `priority` の高いものを採用（同点の場合は「より具体的な policy」を優先）

デフォルト動作（案）:

- マッチする policy が無い場合は拒否（deny by default）。運用上必要なら allowlist を作る。

### 2) Guard（案）

管理画面で選択できる「定義済み」判定部品として提供する。

例:

- `period_lock`: period lock されている場合は拒否
- `project_closed`: project.status=closed の場合は拒否
- `editable_days`: editableDays の範囲外は admin override + reason 必須

#### Guard 一覧（初期案）

- `approval_open`: open な ApprovalInstance がある場合は拒否（例: submit後の編集や付け替え禁止）
- `period_lock`: period lock されている場合は拒否
- `project_closed`: project.status=closed の場合は拒否
- `editable_days`: editableDays の範囲外は reject / もしくは override を要求（どちらを採用するかは actionKey ごとに要設計）

### 3) Handler（案）

副作用（PDF生成・メール送信・入金/支払確定）は handler としてコード側に固定し、ActionPolicy は「許可/禁止」と「ガード」までを担う。

#### API（案）

- `GET /action-policies?flowType=&actionKey=&isEnabled=`（一覧）
- `POST /action-policies`（作成: admin/mgmt）
- `PATCH /action-policies/:id`（更新: admin/mgmt）
- （運用支援）`POST /action-policies/evaluate`（入力: flowType/actionKey/targetId 等、出力: 判定理由）

## 段階的導入（運用）

- まず Phase 0-2（設計）を先行して確定する。
- 既存実装は後方互換で維持しつつ、Phase 3 以降でパイロットドメインから置換する。

## 未確定事項

- reject の集計ルール（any reject / quorum reject / veto 等）
- approver の表現（group/user/role の最終仕様、データモデル）
- DocStatus 以外の state（TimeEntry/Leave 等）を ActionPolicy にどう統合するか
- `returned`（差戻し）などドキュメント上の状態と実装の差分解消方針

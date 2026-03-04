# ApprovalRule 版管理（B1）現状棚卸

更新日: 2026-03-04  
関連Issue: #1315, #1308

## 1. 目的

- ApprovalRule を追記型版管理へ移行する前提として、現行の CRUD / 適用ロジック / DB スキーマを整理する。
- 「instance が開始時点の rule version に固定される」設計に対して、現在の不足点を明示する。

## 2. 現行API（backend）

実装: `packages/backend/src/routes/approvalRules.ts`

- `GET /approval-rules`
- `POST /approval-rules`
- `PATCH /approval-rules/:id`
- `GET /approval-instances`
- `POST /approval-instances/:id/act`
- `POST /approval-instances/:id/cancel`

補足:

- ApprovalRule に対する `DELETE` API は未提供。
- `PATCH /approval-rules/:id` は同一レコード更新（上書き）であり、新版作成にはなっていない。

## 3. 現行データモデル（Prisma）

実装: `packages/backend/prisma/schema.prisma`

### 3.1 ApprovalRule

- 主キー: `id`
- 主要列: `flowType`, `version`, `isActive`, `effectiveFrom`, `conditions`, `steps`
- 監査列: `createdAt`, `updatedAt`, `createdBy`, `updatedBy`

### 3.2 ApprovalInstance

- 主キー: `id`
- 主要列: `flowType`, `targetTable`, `targetId`, `status`, `currentStep`, `projectId`
- 参照: `ruleId`（必須、`ApprovalRule.id` への FK）
- 保持情報: `stagePolicy`, `createdAt`
- 子要素: `ApprovalStep[]`

### 3.3 参照整合

- `ApprovalInstance.ruleId` は `ON DELETE RESTRICT`。
- instance 側で `steps` と `stagePolicy` を保持しており、承認進行時は instance 側の情報を使う。

## 4. 現行適用ロジック

実装: `packages/backend/src/services/approval.ts`, `packages/backend/src/services/approvalLogic.ts`

### 4.1 ルール選択

- `resolveRule` が候補を取得。
- 候補条件は概ね以下:
  - `flowType` 一致
  - `isActive = true`
  - `effectiveFrom <= now`
- 並び順は `effectiveFrom desc`, `createdAt desc`。
- 候補に対して条件評価 (`matchesRuleCondition`) を行い、最初に一致した rule を採用。

### 4.2 instance 作成

- submit 系ルートは `submitApprovalWithUpdate` 経由で instance を作成。
- 作成時に `ruleId` と、正規化された `steps` / `stagePolicy` を instance 側へ保存。

### 4.3 承認進行

- `act` は instance の `steps` / `stagePolicy` を使って進行。
- ただし `GET /approval-instances` は `include: { rule: true }` で rule を JOIN して返すため、表示上は現行 rule 定義の影響を受けうる。

## 5. B1 観点での主要ギャップ

1. **上書き更新**
   - ルール更新が追記型ではなく、同一 `id` の上書き更新。
2. **version の実効性不足**
   - `version` 列はあるが、ルール選択時のキーとして利用されていない。
   - `(flowType, version)` 等の一意制約も未定義。
3. **instance の版固定情報不足**
   - `ruleId` は保持するが、`ruleVersion` や `ruleSnapshot` を明示保持していない。
4. **未解決時の暫定ID依存**
   - `ruleId='auto'` / `'manual'` を使う経路があり、実体 rule の運用前提が曖昧。
5. **編集ガード不足**
   - `PATCH` で `flowType` / `steps` / `conditions` / `version` が直接更新可能。
   - 進行中 instance との整合を守る「派生新規版作成」強制がない。

## 6. 次アクション（#1315 TODO1 への入力）

- 版識別子設計を確定（`ruleKey`, `version`, `isActive`, `effectiveFrom/effectiveTo`）。
- 進行中 instance の表示/APIが参照する rule 情報を、開始時点固定として扱う仕様を確定。
- `PATCH` を「新version作成」に置換する API 仕様案を作成。
- 既存データ移行（version=1 付番、active/effectiveFrom 補正）の手順案を作成。

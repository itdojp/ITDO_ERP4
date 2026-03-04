# ApprovalRule 追記型版管理 仕様ドラフト（B1 / TODO1）

更新日: 2026-03-04  
関連Issue: #1315, #1308  
前提ドキュメント: ApprovalRule 現状棚卸（PR #1345 で追加予定）

## 1. 目的

- ApprovalRule 更新を上書き型から追記型へ移行し、版を監査可能にする。
- 承認 instance が開始時点の版定義で再現できることを保証する。

## 2. 設計方針（推奨）

1. **ルール本体は不変（immutable）**
   - 既存版は更新しない。
   - 変更時は新しい version 行を追加する。

2. **適用中 instance は版固定**
   - instance 作成時に `ruleId` + `ruleVersion` + `ruleSnapshot` を保持する。
   - 進行中に最新版へ差し替えない。

3. **有効化は単位を絞る**
   - 版選択キーは `(flowType, ruleKey)` とする。
   - 同一キーで同時に active な版は1つに制限する。

## 3. データモデル案

### 3.1 ApprovalRule（既存テーブル拡張）

追加/整理案:

- `ruleKey` (text, not null)
  - 同一 flowType 内で版系列を識別する安定キー。
  - 例: `default`, `project:{projectId}`, `department:{deptId}`
- `version` (int, not null)
  - 同一 `(flowType, ruleKey)` 内で単調増加。
- `isActive` (bool, not null)
- `effectiveFrom` (datetime, not null)
- `effectiveTo` (datetime, nullable)
- `supersedesRuleId` (same type as `ApprovalRule.id`, nullable)
  - どの版から派生したかの監査用参照（`ApprovalRule.id` への参照）。

推奨制約（DB制約で担保し、運用のみには依存しない）:

- `unique(flowType, ruleKey, version)`
- `index(flowType, ruleKey, isActive, effectiveFrom)`
- `foreign key (supersedesRuleId) references ApprovalRule(id)`
- （PostgreSQL 想定）同一 `(flowType, ruleKey)` の open active 版を1件に制限
  - モデル前提: open active 版は `isActive=true` かつ `effectiveTo is null`
  - DDL 例:
    ```sql
    CREATE UNIQUE INDEX ux_approval_rule_active_one_per_key
      ON "ApprovalRule"("flowType", "ruleKey")
      WHERE "isActive" = TRUE
        AND "effectiveTo" IS NULL;
    ```

### 3.2 ApprovalInstance（版固定情報の保持）

追加案:

- `ruleVersion` (int, nullable -> 最終的に not null)
- `ruleSnapshot` (jsonb, nullable)
  - 最低限 `conditions`, `steps`, `stagePolicy`, `ruleKey`, `effectiveFrom` を保存。

補足:

- 既存の `steps` と `stagePolicy` は継続利用可能。
- `ruleSnapshot` は監査・表示再現用に追加する。

## 4. 適用ロジック案

### 4.1 ルール解決

- `resolveRule(flowType, payload)` は以下順で判定:
  1. `isActive=true`
  2. `effectiveFrom <= now`
  3. `effectiveTo is null or effectiveTo > now`
  4. 条件評価一致
  5. 条件一致候補が複数ある場合は優先順位で1件を選ぶ
     - 推奨優先順位: `priority desc`（新設）→ `effectiveFrom desc` → `createdAt desc`
     - 同順位同条件が残る場合は設定不正としてエラー
- 同一 `(flowType, ruleKey)` は最大1版 active とし、ruleKey内の曖昧一致を防ぐ。

### 4.2 instance 作成

- `createApprovalFor` で採用版の `id/version` と `ruleSnapshot` を保存。
- `rule` JOIN なしでも instance 単体で表示再現可能にする。

### 4.3 既存 PATCH の扱い

- `PATCH /approval-rules/:id` は非推奨化。
- 置換 API:
  - `POST /approval-rules/:id/versions`（既存版から新規版を作成）
  - `POST /approval-rules/:id/activate`（有効版切替）

## 5. API運用案

- `GET /approval-rules`
  - デフォルト: active 版のみ
  - `includeHistory=true` で版履歴を返却
- `GET /approval-rules/:id/versions`
  - 版一覧（差分比較向け）
  - `:id` は「任意の版ID」で受け付け、`id -> (flowType, ruleKey)` を解決して系列全体を返す

管理操作の監査:

- 版作成/有効化/無効化は全て AuditLog 対象。
- admin/mgmt 権限のみ更新許可。

## 6. 移行計画（段階導入）

1. **Schema 追加**
   - `ruleKey`, `ruleVersion`, `ruleSnapshot`, 制約を追加（nullable開始）
2. **バックフィル**
   - 既存 rule に `ruleKey='default'`, `version=1` を付与
   - 既存 instance に `ruleVersion` と `ruleSnapshot` を埋める
3. **書き込み経路切替**
   - 新規版作成 API を導入し、既存 PATCH を内部的に新版作成へ委譲
4. **strict 化**
   - 直接上書きを禁止
   - `ruleVersion` / `ruleSnapshot` を not null 化

## 7. 未決事項（要合意）

1. `ruleKey` の命名規則とスコープ（project/department/org）
2. 同時 active 制約の粒度（`flowType+ruleKey` で十分か）
3. `ruleSnapshot` の保存範囲（PIIを含めるか）
4. 旧 API の廃止時期（互換期間）

## 8. Done 定義（B1）

- ルール更新が追記型のみで実施される。
- instance が開始時点の版情報で再現可能。
- 版履歴が API/UI から参照可能。
- 監査ログで版変更イベントを追跡できる。

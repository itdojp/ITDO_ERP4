# 承認ルール未整備時フォールバック棚卸（B2）

更新日: 2026-03-04  
関連Issue: #1316, #1308

## 1. 目的

- ApprovalRule 未整備時に処理が成立するハードコード経路を棚卸する。
- 「DB既定ルール化すべき経路」と「段階削除すべき経路」を切り分けるための材料を整理する。

## 2. 対象フロー（submit/edit 入口）

実装: `packages/backend/src/routes/*.ts`

- estimate:submit
- invoice:submit
- purchase_order:submit
- vendor_invoice:submit（`/vendor-invoices/:id/submit`, `/approve` alias）
- expense:submit
- leave:submit（`requiresApproval=true` の場合）
- time:edit（承認影響がある変更時）

共通経路: いずれも `submitApprovalWithUpdate` / `createApprovalFor` を経由。

## 3. フォールバック経路（現行）

実装: `packages/backend/src/services/approval.ts`, `packages/backend/src/services/approvalLogic.ts`

### 3.1 ルール0件時の自動フォールバック

- `resolveRule` が `null` を返した場合、`createApprovalFor` は `computeApprovalSteps` にフォールバックする。
- 結果として、DB上に該当 ApprovalRule がなくても申請処理は成立する。

### 3.2 ルール不備時の自動フォールバック

- ルールは存在しても `steps` が無効/空の場合、`normalizeRuleStepsWithPolicy` が `null` となり、同様に `computeApprovalSteps` へフォールバックする。

### 3.3 ハードコード承認段生成

- `computeApprovalSteps` はハードコード値で段を生成する。
  - `mgmt` 段
  - 条件付き `exec` 段
  - 金額閾値（例: `skipUnder=50000`, `execThreshold=100000`）

### 3.4 条件不一致時の先頭ルール採用

- 条件一致ルールがない場合でも `rules[0]` を採用する経路がある。
- 暗黙デフォルトとして振る舞うため、誤設定を見逃しやすい。

### 3.5 ruleId の暫定固定値依存

- ルール未解決時に `ruleId='auto'` / `'manual'` を使う経路がある。
- `ApprovalInstance.ruleId` は必須 FK のため、実データとの整合が運用依存になる。

## 4. B2観点の主要論点

1. ルール未登録時でも成立させる運用を維持するか。
2. ルール不備を「暗黙救済」するか「設定不正で失敗」させるか。
3. 全フロー共通のハードコード段（mgmt/exec + 金額閾値）を継続するか。
4. 非金額フロー（leave/time）に金額前提フォールバックを適用してよいか。
5. `rules[0]` 採用の暗黙デフォルトを許容するか。
6. `auto/manual` 依存を残すか、DB既定ルールとして明示化するか。

## 5. 推奨（B2の次段）

- 「成立させるための fallback」はコード内ロジックではなく DB既定ルールとして明示する。
- ルール未解決/ルール不備の挙動を段階的にエラー化し、運用期間中は監査ログで観測する。
- 非金額フロー向け既定ルール（leave/time）を金額閾値ロジックから分離する。
- `ruleId='auto'/'manual'` 依存は廃止し、実在する rule version のみ参照する。

## 6. 次アクション（#1316 TODO1 への入力）

- 組織共通の最小既定ルールを flowType ごとに定義する。
- 既定ルール投入方式（seed / migration / 初期化API）を決定する。
- 段階削除計画を定義する（ログ化 → 警告 → deny-by-default）。

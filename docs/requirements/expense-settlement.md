# 経費精算の精算書/支払フロー（MVP確定）

## 背景
旧システムでは「申請→承認→精算（支払）」の二段階運用があり、申請後の精算処理が重要な業務フローでした。ERP4 では申請/承認はあるものの、精算書（支払）単位や支払状態が未整理です。

## 現状（ERP4）
- Expense は明細単位で `draft/pending_*/approved/rejected` を持つ
- 申請承認フローは approval_rules に準拠
- 精算書/支払の状態・履歴が未実装

## 差分/課題
- 申請承認後の「精算（支払）」操作の所在がない
- 支払方法/税率/支払先など、実務に必要な属性が不足
- 複数明細を束ねる単位（精算書/バンドル）の要否が未決定

## MVP方針（確定）
- 明細単位の精算で開始する（精算書は後続検討）
- 旧システムの「Submitter=支払対象」を踏襲し、支払先は原則 `userId` とする
- 外部支払先は既存の支払先名（外部会社名）で保持し、支払対象とは分離する
- 精算状態は Expense に保持する（MVP: `settlementStatus=unpaid/paid` + `paidAt/paidBy`）

## 後続拡張（候補）
### A. 明細単位の精算（MVP）
- Expense に `settlementStatus` / `paidAt` / `paidBy` を追加
- 精算操作は単票ごとに実施
- 実装負荷は低いが、件数が多い場合の運用負荷が残る

### B. 精算書（バンドル）単位
- ExpenseSettlement（精算書）を新設し、複数Expenseを紐付け
- 精算書で支払方法/支払日/担当を管理
- 実務運用に近いが設計/実装コストが増える

## 追加で整理すべき論点（MVPで確定させる項目）
### 属性（MVP確定/候補）
- 支払先（支払対象）: `userId` を基本とする（従業員）
- 精算状態: `settlementStatus`（MVP: `unpaid` / `paid`）
- 支払日: `paidAt`（MVP）
- 支払担当: `paidBy`（MVP）
- 支払方法: 振込/現金/法人カード/立替相殺（MVPは任意項目、運用で固定も可）
- 税率: 0/8/10%（明細単位、現状は後続）
- 証憑: `receiptUrl` を維持（命名規則/プレビューは後続のUIで拡張）
- 備考: `notes`（後続。現状 `Expense` に未実装）

### 状態遷移（MVP確定）
- 申請承認（既存）: `draft` → `pending_qa` → `pending_exec` → `approved` / `rejected` / `cancelled`
- 精算（追加）: `settlementStatus=unpaid` → `paid`
  - `status=approved` のみ `paid` へ遷移可能
  - `paid` の取消（`paid` → `unpaid`）は admin/mgmt のみ（理由必須、監査ログ対象）

### UI導線（MVP確定）
- 申請者: 自分の Expense 一覧/詳細で「精算状況（未/済）」を確認できる
- admin/mgmt: Expense 一覧/詳細に「支払済み」操作を追加（支払日/担当を記録）
- 検索/集計: 「未精算のみ」「支払日レンジ」「案件」で絞り込み（MVPは最小で可）

### 権限/監査/通知（MVP確定）
- 精算操作（支払済み/取消）は admin/mgmt のみ
- `status=pending_*`（承認中）/`status=approved`（承認後）は、申請者による主要項目変更を禁止（現行ポリシー維持）
- 監査ログ:
  - `expense_settlement_mark_paid`（誰が/いつ/金額/支払日/支払方法）
  - `expense_settlement_unmark_paid`（理由必須）
- 通知: 支払完了は申請者へアプリ内通知（メールは運用次第、通知体系は `docs/requirements/notifications.md` に準拠）

## 後続検討
- 属性要件（支払方法/税率/備考 等）の拡充
- UI導線（精算操作、検索、証憑の扱い）の整理
- 精算書（バンドル）への拡張要否

## 関連
- `docs/requirements/domain-api-draft.md`
- `docs/requirements/approval-alerts.md`
- `docs/requirements/reassignment-policy.md`

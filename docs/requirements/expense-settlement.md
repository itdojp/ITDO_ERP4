# 経費精算の精算書/支払フロー（たたき台）

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

## 方針案（未確定）
### A. 明細単位の精算
- Expense に `settlementStatus` / `paidAt` / `paidBy` を追加
- 精算操作は単票ごとに実施
- 最小実装で開始できるが、業務負荷が上がる可能性

### B. 精算書（バンドル）単位
- ExpenseSettle（精算書）を新設し、複数Expenseを紐付け
- 精算書で支払方法/支払日/担当を管理
- 実務運用に近いが設計/実装コストが増える

## TODO
- [ ] 属性要件の確定（支払先/税率/支払方法/備考 等）
- [ ] 精算単位（明細 vs 精算書）の決定
- [ ] 承認後の状態遷移（approved → settled/paid 等）の定義
- [ ] UI導線（精算操作、検索、証憑の扱い）の整理

## 関連
- `docs/requirements/domain-api-draft.md`
- `docs/requirements/approval-alerts.md`
- `docs/requirements/reassignment-policy.md`

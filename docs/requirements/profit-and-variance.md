# 損益/工数予実の算出ロジック（ドラフト）

## 目的
- 案件別の損益（売上/コスト）と工数の予実を一貫して算出する
- レポートとアラートの算出基準を明確化する

## 前提
- 間接費配賦は行わない（間接費は案件分割 or 共通案件で管理）。
  - 「間接費」の例: 会社全体の一般管理費（バックオフィス人件費、採用費、役員報酬）、オフィス賃料・水道光熱費、共通SaaS利用料など、特定の案件に直接ひもづかないコスト。
  - 「直接費」は特定の projectId / taskId にひもづく支出（外注費・仕入、案件別経費、time_entries に基づく労務コストなど）を指す。
- 経費は必ず projectId を持つ。共通経費は専用Projectで処理する。

## データソース（MVP）
- 売上: invoices.totalAmount
  - 集計対象: status in (approved, sent, paid)
  - 期間: issueDate ベース（支払ベースは後続）
- 外注/仕入: vendor_invoices.totalAmount
  - 集計対象: status in (received, approved, paid)
- 直接経費: expenses.amount
  - 集計対象: status in (approved)
  - 備考: 承認待ち（pending_qa/pending_exec）は最終承認前のため集計対象外
- 労務コスト: time_entries.minutes * rate_cards.unitPrice
  - 集計対象: status in (submitted, approved)
  - rate_cards は projectId 指定優先、無ければ汎用（role/workType）を参照

## 予算（Budget）/見込
- 売上予算: approved な estimate.totalAmount または milestone.amount の合計
- 工数予算: 現状は未定義（後続で planHours を持たせる）
- コスト予算: 現状は未定義（後続で budgetCost を持たせる）

## 期間指定時の扱い
- 期間指定がある場合:
  - 売上予算: 期間内に作成された estimate を優先（最新1件）。存在しない場合は milestone.dueDate の期間合計にフォールバック
  - 売上実績: invoice.issueDate の期間合計
  - コスト: expense.incurredOn / vendor_invoice.receivedDate / time_entry.workDate で期間合計
- 期間指定がない場合:
  - 売上予算: 最新の estimate を優先（無ければ milestone 合計）

## 単価の決め方（工数）
- rate_cards は projectId + workType + 期間で最適一致を解決
- 単価が未設定の場合は 0 として扱い、警告ログを出す
- 端数処理は rounding ルールを後続で定義（MVPは小数点そのまま）

## グループ/ユーザ別の配賦（MVP）
- 収支を user/group 軸で出す場合は、**労務コスト比率**で売上と外注費を配賦する
  - 配賦率 = user.laborCost / totalLaborCost
  - totalLaborCost が 0 の場合は minutes 比率、minutes も 0 の場合は 0 とする
- 経費は userId が明確なため、配賦せず user に直接紐づける
- 返却値に allocationMethod を含め、配賦方法を明示する

## 指標（MVP）
- 売上実績: sum(invoices.totalAmount)
- 直接コスト: sum(expenses + vendor_invoices + laborCost)
- 粗利: 売上実績 - 直接コスト
- 粗利率: 粗利 / 売上実績
- 工数実績: sum(time_entries.minutes)
- 予実差分: actual - budget（売上/工数/コスト）

## 集計軸
- 期間: 月次/四半期/任意期間
- 単位: project / group / user
- 為替: MVP は同一通貨前提（多通貨対応は後続）

## アラート連携
- 予算超過（売上）: 売上予算に対する実績比率で判定（初期 110%）
- 予算超過（コスト）: budgetCost 定義後に別途判定ロジックを追加する
- 残業: time_entries から集計

## 未決定/確認事項
- 工数予算の持ち方（project/milestone/task のどこに planHours を置くか）
- 売上予算の基準（estimate vs milestone のどちらを主とするか）
- 複数通貨/税抜税込の集計方針
- コスト予算（budgetCost）に対する予算超過アラートの有無としきい値

# PO→ERP4 データ移行マッピング（ドラフト）

目的: Project-Open (im_*/acs_*) から ERP4 スキーマへの一方向移行で、主要テーブルの対応関係・変換ルール・リスクを整理する。

## 対象とゴール
- 対象: プロジェクト/タスク/マイルストーン、工数、請求/見積、経費、ユーザ/ロール（参照のみ）、業者関連（発注/業者請求/業者見積）。
- ゴール: MVP のPoC環境にデータを投入し、予実/損益/承認の動作確認ができる状態。

## マッピング表（初版）

### プロジェクト/タスク/マイルストーン
- PO: `im_projects` → ERP4: `projects`
  - code/name/status/parent: 直接マッピング。階層は parent_id で5階層まで許容。
  - budget/計画日はあれば `project_milestones`/`project_tasks` に分配。
- PO: `im_proj_phases` → ERP4: `project_milestones`
  - phase名/期間/金額相当をマイルストーンに転記（bill_upon=acceptance をデフォルト）。
- PO: `im_timesheet_tasks` ほか → ERP4: `project_tasks`
  - WBS を wbs_code として保持。親子は parent_task_id にマップ。

### 見積/請求
- PO: `im_invoices` → ERP4: `invoices`
  - invoice_no は再発番（PYYYY-MM-NNNN）。旧番号は `external_id` 相当カラムに保持（後で追加）。
  - ステータス: closed/paid → paid, open → approved/sent, draft → draft。
- PO: `im_invoice_items` → ERP4: `billing_lines`
  - 課税/非課税は tax_rate で表現。task_id があれば紐付け。
- PO: 見積テーブル（もしあれば）→ ERP4: `estimates`
  - 無い場合はスキップ、または `invoices` をコピーして作成しない。

### 工数
- PO: `im_timesheet`, `im_hours` など → ERP4: `time_entries`
  - user_id, project_id, task_id, work_date, minutes をマップ。
  - ステータスは submitted に統一（承認履歴は履歴テーブルがあれば別途検討）。

### 経費/共通経費
- PO: `im_expenses` → ERP4: `expenses`
  - is_shared 判定: 共通経費用の疑似案件なら true、それ以外は false。
  - 領収書パスは receipt_url に転記（ファイル本体は別途移送が必要）。

### ユーザ/ロール
- PO: `cc_users`, `acs_rels` 等 → ERP4: `users` 相当（まだ未定義）
  - ロール/プロジェクトアサインは参照用にダンプし、RBACは新設計に合わせて再付与。

### 業者/発注/仕入
- PO: 取引先テーブル（例: `im_companies`）→ ERP4: `vendors`/`customers`（区分で分岐）
  - 外注先を vendors とし、bank情報は bank_infoへ。
- PO: 発注/業者請求テーブル（存在する場合）→ ERP4: `purchase_orders` / `vendor_invoices` / `vendor_quotes`
  - 番号は再発番（PO/VQ/VI形式）。旧番号は external_id 等で保持する方針。

## 変換ルール・クレンジング
- 日付/時刻: timezone を JST として取り込み（後にUTC正規化）。欠損は null。
- コード整合: project_code/customer_code は一意チェック。重複はサフィックスをつけるか手動解消。
- 通貨: 不明な場合は JPY を既定。税率が無い場合は 0% とする。
- ステータス: 旧システムの状態を DocStatus/ProjectStatus にマッピング。未知の値は draft にフォールバックし、移行レポートに記録。

## シーケンス/ID整合
- IDは新規UUIDを発行。旧IDは external_source/id として保持し、リレーションは旧ID→新UUIDのマップテーブルで解決。
- シーケンス不整合（例: t_sec_security_token_id_seq）の解消: 今回は一方向移行のため、旧シーケンスは参照のみ。新環境では独立した発番を使用。

## ETL手順（サンプル）
1. 抽出: FDW または CSV でプロジェクト/工数/請求/経費/取引先を取得。
2. 変換: Python/DBT などでコード正規化、税率/通貨デフォルト付与、旧ID→新IDマッピングを適用。
3. ロード: 依存順にロード（customers/vendors → projects/tasks/milestones → estimates/invoices → time_entries/expenses）。発番は新環境の number_sequences を使用。
4. 検証: プロジェクト単位で件数・金額整合をチェック（工数合計、請求合計、経費合計）。

## リスク/未決
- 旧システムに業者系テーブルが無い場合、仕入/発注は手入力での移行が必要。
- 見積データが無い場合、請求のみを移行し、見積は今後作成運用とするか要判断。
- ファイル（領収書/PDF）の移送手順未定。ストレージ設計後に決定。
- ユーザIDの突合せ（メールアドレス/社員コード）に曖昧さがある場合、手動マッピングが必要。

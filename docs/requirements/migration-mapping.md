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
  - IDは mapping_projects で UUID を発行し、元IDは legacy_id / legacy_code に保持。
- PO: `im_proj_phases` → ERP4: `project_milestones`
  - phase名/期間/金額相当をマイルストーンに転記（bill_upon=acceptance をデフォルト）。
- PO: `im_timesheet_tasks` ほか → ERP4: `project_tasks`
  - WBS を wbs_code として保持。親子は parent_task_id にマップ。

### 見積/請求
- PO: `im_invoices` → ERP4: `invoices`
  - invoice_no は再発番（PYYYY-MM-NNNN）。旧番号は `external_id` 相当カラムに保持（後で追加）。
  - project_id は mapping_projects をJOINして新UUIDに置換。
  - ステータス: closed/paid → paid, open → approved/sent, draft → draft。
- PO: `im_invoice_items` → ERP4: `billing_lines`
  - 課税/非課税は tax_rate で表現。task_id があれば紐付け。
- PO: 見積テーブル（もしあれば）→ ERP4: `estimates`
  - 無い場合はスキップ、または `invoices` をコピーして作成しない。
- PO: 発注/業者請求/業者見積 → ERP4: `purchase_orders` / `vendor_invoices` / `vendor_quotes`
  - いずれも番号は再発番（PO/VQ/VI + YYYY-MM-####）。旧番号は legacy_code または external_id で保存。

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
- チーム/グループ: 旧組織・プロジェクトグループは mapping_groups に保持し、グループ設計確定後に紐付け。
  - PoCでは `UserAccount.id = legacy user_id` として投入し、TimeEntry/Expense の参照を一旦解決する案も検討（恒久運用では再マッピングが必要）。

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
- ユーザIDマッピング: `legacy_user_id -> new_user_uuid` のCSV/テーブルを作成し、time_entries/expenses/daily_reports 等で参照。メールアドレス/社員コードをキーにマッピングし、変換時にJOINで埋め込む。

### マッピングテーブルDDL（サンプル）
```sql
create table if not exists mapping_projects(
  legacy_id text primary key,
  new_id uuid not null,
  legacy_code text,
  created_at timestamptz default now()
);

create table if not exists mapping_users(
  legacy_id text primary key,
  new_id uuid not null,
  legacy_login text,
  created_at timestamptz default now()
);

create table if not exists mapping_vendors(
  legacy_id text primary key,
  new_id uuid not null,
  legacy_code text,
  created_at timestamptz default now()
);

create table if not exists mapping_groups(
  legacy_id text primary key,
  new_id uuid not null,
  legacy_code text,
  created_at timestamptz default now()
);
```

### マッピング例（サンプルデータ）
```sql
insert into mapping_projects(legacy_id, new_id, legacy_code) values
  ('im_projects:1001', '11111111-1111-1111-1111-111111111111', 'PRJ-001'),
  ('im_projects:1002', '22222222-2222-2222-2222-222222222222', 'PRJ-002');

insert into mapping_users(legacy_id, new_id, legacy_login) values
  ('cc_users:501', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'taro@example.com'),
  ('cc_users:502', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'hanako@example.com');

insert into mapping_vendors(legacy_id, new_id, legacy_code) values
  ('im_companies:801', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'VND-001');
```

### マッピング手順
- ユーザ: メール または 社員コードで重複を解消し、欠損は手動で紐付け。マッピング未解決の行は別ファイルに出力する。
- プロジェクト: code が重複する場合はサフィックス（-1,-2）を付与し、元コードは legacy_code に残す。
- ベンダ/顧客: 旧の company type を見て vendors/customers に振り分け、コードが無い場合は連番を付与。

## ETL手順（サンプル）
1. 抽出: FDW または CSV でプロジェクト/工数/請求/経費/取引先を取得。
2. 変換: Python/DBT などでコード正規化、税率/通貨デフォルト付与、旧ID→新IDマッピングを適用。
3. ロード: 依存順にロード（customers/vendors → projects/tasks/milestones → estimates/invoices → time_entries/expenses）。発番は新環境の number_sequences を使用。
4. 検証: プロジェクト単位で件数・金額整合をチェック（工数合計、請求合計、経費合計）。

### 参照切れ検出SQL（例）
```sql
-- time_entries: project_id の参照切れ
select te.id
from time_entries te
left join projects p on p.id = te.project_id
where p.id is null;

-- time_entries: user_id の参照切れ（mapping_users で解決できていない）
select te.id, te.user_id
from time_entries te
left join mapping_users mu on mu.new_id::text = te.user_id
where mu.new_id is null;

-- expenses: project_id の参照切れ
select e.id
from expenses e
left join projects p on p.id = e.project_id
where p.id is null;

-- invoices: project_id の参照切れ
select i.id
from invoices i
left join projects p on p.id = i.project_id
where p.id is null;
```
## リスク/未決
- 旧システムに業者系テーブルが無い場合、仕入/発注は手入力での移行が必要。
- 見積データが無い場合、請求のみを移行し、見積は今後作成運用とするか要判断。
- ファイル（領収書/PDF）の移送手順未定。ストレージ設計後に決定。
- ユーザIDの突合せ（メールアドレス/社員コード）に曖昧さがある場合、手動マッピングが必要。

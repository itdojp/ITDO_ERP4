# マスタデータ管理アーキテクチャ原案（ドラフト）

## 1. 目的とスコープ
- Project-Open で運用してきた法人（会社・部署）・プロジェクト・契約・顧客マスタを、ERP4 のモダンアーキテクチャへ移管する。
- 認証／権限設計と密接に連携し、Google Workspace や他 SaaS とのデータ同期を考慮した拡張性あるモデルを構築する。
- 初期フェーズでは法人・顧客・プロジェクト・契約・担当者のコアマスタを対象とし、段階的に商流（見積・受注）や財務マスタを追加する。

## 2. 現行運用の整理（Project-Open）
| 区分 | 現行テーブル／機能 | 主な利用内容 | 課題 |
|------|--------------------|--------------|------|
| 法人・顧客 | `im_companies`, `im_customers` | 顧客・仕入先・自社組織。プロジェクトとの関連付けに利用 | データ重複、属性不足（税番号、請求先単位） |
| 部署／担当者 | `im_offices`, `cc_users` | プロジェクトメンバー、承認者を管理 | 組織更新時の同期が手作業、権限モデルと分離 |
| プロジェクト | `im_projects`, `im_proj_phases` | 親子構造、ステータス、予算、フェーズ管理 | 属性が増殖しスキーマが複雑、履歴管理が弱い |
| 契約・請求 | `im_contracts`, `im_invoices` | 工数ベース／マイルストーン請求 | インボイス制度対応を追加カスタムで対応 |
| マスタ連携 | Tcl/SQL スクリプト | CSV インポート／手動修正 | バリデーション不足、監査性が低い |

## 3. 新アーキテクチャ方針
1. **ドメインモデルの明確化**  
   - 法人（LegalEntity）、組織単位（OrgUnit）、顧客（CustomerAccount）を分離。  
   - プロジェクト（Project）と契約（Engagement/Contract）を独立エンティティとして扱い、関連を明確化。  
   - 共同利用する参照値（通貨、産業分類、税区分）はコードマスタとして集中管理。
2. **属性管理**  
   - 自社・顧客双方の請求／支払情報（所在地、インボイス登録番号、担当窓口）を標準項目として保持。  
   - プロジェクトにはビジネス単位、契約種別、収益認識メソッドなど拡張フィールドを用意。  
   - 監査要件に合わせて有効期間・変更履歴（Audit Trail）を保持。
3. **外部連携**  
   - Google Workspace や CRM ツール（例: HubSpot）との同期を想定し、外部ID（`external_source`, `external_id`）を各マスタへ付与。  
   - 認証基盤で同期した Google グループ／組織情報を OrgUnit へ反映する導線を準備。

## 4. エンティティ概要
| エンティティ | 主キー | 主な属性 | 備考 |
|--------------|--------|----------|------|
| `legal_entities` | `id` | `entity_type`（self/customer/vendor）、`name`, `jpn_corporate_number`, `invoice_registration_id`, `address`, `tax_region`, `currency`, `status` | 自社・顧客・仕入先を一元管理 |
| `org_units` | `id` | `legal_entity_id`, `parent_id`, `code`, `name`, `type`, `manager_user_id`, `external_source`, `external_id` | 自社組織（部署・事業部）管理。外部同期可能 |
| `contacts` | `id` | `legal_entity_id`, `name`, `email`, `phone`, `role`, `is_primary`, `notes` | 顧客／仕入先担当者。プロジェクト・契約担当と紐付け |
| `projects` | `id` | `code`, `name`, `status`, `project_type`, `start_date`, `end_date`, `owner_user_id`, `org_unit_id`, `customer_entity_id`, `parent_project_id`, `delivery_model`, `currency`, `budget_labor`, `budget_expense` | プロジェクト階層・属性を保持。業態別テンプレへ展開予定 |
| `project_phases` | `id` | `project_id`, `name`, `phase_type`, `plan_start`, `plan_end`, `actual_start`, `actual_end`, `baseline_id` | WBS フェーズ。Timeline/バーンダウンと連動 |
| `contracts` | `id` | `project_id`, `customer_entity_id`, `contract_type`, `contract_status`, `signed_date`, `effective_start`, `effective_end`, `billing_model`, `payment_terms`, `total_value`, `currency`, `external_id` | プロジェクトに紐付く契約情報（工数請求・固定費など） |
| `contract_milestones` | `id` | `contract_id`, `name`, `amount`, `milestone_type`, `bill_upon`, `due_date`, `tax_rate`, `invoice_template_id` | マイルストーン請求のための単位。タイムシート承認と連携 |
| `project_members` | `id` | `project_id`, `user_id`, `role_code`, `allocation_percentage`, `start_date`, `end_date`, `source` | プロジェクト配員管理。Google グループ同期との突き合わせに使用 |

※ コード表（ `project_statuses`, `contract_types` 等）は別テーブルで管理し、将来の多言語対応に備える。

## 5. ID と外部システム連携
- **ID 戦略**  
  - 内部 ID は UUID（CUID）を採用。人間可読な `code`（顧客コード、プロジェクトコード）は別カラムで管理し、整合性チェックを行う。  
  - 外部システムのID（例: Legacy Project-Open project_id）を `legacy_source`/`legacy_id` として保持し、移行後のトレーサビリティを確保。  
  - Google Workspace 連携時は `org_units.external_source = 'google_directory'` 等で区別する。
- **API 方針**  
  - REST/GraphQL で CRUD・検索・参照 API を提供。権限チェックは RBAC + プロジェクトスコープで評価。  
  - 監査ログに API コールを記録し、変更履歴テーブルに差分を保存する（例: `project_change_logs`）。

## 6. データ移行計画（概要）
1. **データ棚卸し**  
   - `im_companies`, `im_projects`, `im_contracts`, `im_proj_members` などを対象に、必須属性／不要属性／変換ルールを整理。  
   - データクレンジングルールを定義（例: 法人番号の正規化、住所フォーマット統一）。
2. **抽出・変換**  
   - Legacy DB からステージングテーブルへ抽出（PostgreSQL FDW or CSV）。  
   - 変換スクリプト（dbt／Python ETL）で新スキーマに合わせて整形。  
   - アクセスログと照合し未使用データをアーカイブへ回す。
3. **ロード**  
   - 順序: `legal_entities` → `org_units` → `contacts` → `projects` → `contracts` → `project_members`。  
   - ロード時に referential integrity チェックを実行し、エラーは検証用レポートへ出力。  
   - マイグレーションツールにより差分適用とロールバック用バックアップを自動化。
4. **検証**  
   - サンプルプロジェクトを抽出し、Project-Open と新システムの集計値（予算、配員、契約金額）が一致することを確認。  
   - BI/レポーティング用クエリとの互換性を検証（例: 月次売上、部門別工数）。

## 7. ガバナンス／運用
- **権限管理**: ユーザーは Google SSO → User Profile → プロジェクトロール付与の流れで権限を得る。マスタ編集権は限定ロール（PMO/経理）が所有。  
- **監査／履歴**: `updated_by`, `updated_at`, `change_reason` を共通カラムとして保持。重要マスタは楽観ロック + 変更履歴テーブルで追跡。  
- **データ品質**: 定期的にマスタ整合性チェック（重複、参照切れ、失効/有効期間矛盾）をバッチ実行し、レポートを出力。  
- **API ガバナンス**: 外部システムからの登録・更新は API 経由に統一し、直接 DB 更新を禁止。CI で契約単価・税率などビジネスルールを検証。

## 8. 未決事項
- 基幹会計・販売管理とのデータ連携範囲（ERP／会計システムへのインタフェース仕様）。  
 - 外部顧客ポータル等での参照要件（アクセス権・匿名化の扱い）。  
 - プロジェクトテンプレートの管理方法（別テーブル vs JSON テンプレート）。  
 - 見積・受注など Sales 領域とのデータ連携（Salesforce 等がある場合のルール）。  
 - 組織改編時の履歴保持・自動配賦（OrgUnit の有効期間管理）。

---
本ドキュメントは議論用のドラフトです。要件決定・プロトタイピング結果に応じて更新します。

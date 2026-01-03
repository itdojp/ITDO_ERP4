# TODO リスト（短期ドライブ用）

## 次アクション（M1.0 検証 + Phase2 着手準備）
- [ ] 現環境（Podman）でMVP主要フローの総合確認
  - [ ] 見積→請求→送信（メール/PDF）のハッピーパス
  - [ ] 工数/経費/修正承認の入力と履歴確認
  - [ ] アラート発火→ダッシュボード通知の確認
  - [ ] ウェルビーイング閲覧権限（人事のみ）と監査ログ確認
- [ ] PWAオフライン下書きの動作確認と不具合チケット化
  - [ ] 日報/工数の下書き保存→復元
  - [ ] オフライン→オンライン復帰時の送信/保存
- [ ] 承認ルール/アラート設定画面のAPI連携（保存/読み込み）
- [ ] レポートUIの実装（プロジェクト別/グループ別/個人別残業）
- [ ] データ移行リハーサル（サンプルETL→件数/金額検証）
- [x] 運用ドキュメント更新（Podman手順/バックアップ/復旧）
- [ ] Phase2実装スコープの初期チケット起票（HR/CRM連携・自動化レポート・Push通知MVP）

## 次アクション（Phase 1 本番化）
- [x] PDF/メール本番運用の設定/QA/手順整備 (#244)
  - [x] 環境変数/必要ファイルと送信ログ/再送の確認手順を整理
- [x] IDaaS/SCIM 連携の運用フロー/テスト整備 (#245)
  - [x] 同期フロー/代表ケース/監査ログ確認の項目化
- [x] 性能チューニング: ベンチマーク/目標SLA/計測手順 (#246)
  - [x] 代表クエリのSLAと計測手順の叩き台
- [x] モバイルPoC: PWAスケルトンとオフライン下書き最小実装 (#247)
  - [x] manifest/service worker と下書き保存の最小実装

## 11/21 週（～12/10ステージングまでに着手）
- [x] Prisma/SQL 詳細化（enum/型/FK/削除ポリシー）とスキーマPR作成（#5）
  - [x] DocStatus/TimeStatus/LeaveStatus/FlowType のenum見直しと日本語注釈追加
  - [x] FK/ON DELETE/ON UPDATE方針をテーブルごとに列挙（Project/Estimate/Invoice/Expense/TimeEntry）
  - [x] 請求・発注・仕入系のnullable列を精査（estimateId/milestoneId/taskIdなど）
  - [x] 監査メタ createdBy/updatedBy の扱いを統一し TODO記載
  - [x] PRにschema.prisma + docs/requirements/schema-prisma-sketch.md 対応をまとめる
- [x] 発番/定期案件/アラート計算のバッチ擬似コード・シーケンスを追加（#6, batch-jobs.md）
  - [x] 採番サービスに月跨ぎリセット/オーバーフロー処理コメント追加
  - [x] 定期案件テンプレから案件生成、請求ドラフト自動作成のシーケンス図
  - [x] アラート（予算/残業/承認遅延/納期未請求）の擬似コードと発火→通知→サプレッションフロー
- [x] バックエンドPoCスケルトン（APIサーバ: プロジェクト/見積/請求/タイムシート/経費登録と発番・承認フック）
  - [x] prisma clientをDI化またはモジュール共有に寄せる
  - [x] `/projects/:id/estimates`起案→`/estimates/:id/submit`→`/invoices/:id/submit/send`のhappyパス通し
  - [x] タイムエントリ・経費のPOST/GETと簡易フィルタ（projectId/userId/date範囲）
  - [x] タイム修正時に承認インスタンスを起動するhookのスタブ
- [x] フロントPoCスケルトン（Web: 日報入力、工数入力、請求ドラフト閲覧）
  - [x] APIクライアントラッパ（fetch + JSON/エラー処理）
  - [x] 日報+WBフォームのモック（入力→POST→トースト表示）
  - [x] 工数入力フォーム（project/task選択、日付、時間、場所、残業区分）と一覧リロード
  - [x] 請求ドラフト一覧+詳細モック（番号/ステータス/送信ボタン）
- [x] データ移行マッピング初版（PO im_*/acs_* → 新スキーマ、キー/シーケンス整合）
  - [x] im_project/acs_project 等のカラムと Project との対応表
  - [x] 見積/請求/発注/仕入の番号マッピングと連番採番方針
  - [x] ユーザーID/チームID→UUIDの紐付けサンプルSQL
- [x] CI足場（lint/format/docリンクチェック）とテンプレート（Issue/PR）
  - [x] backend: eslint+prettierの最小設定と`npm run lint`
  - [x] frontend: eslint+prettierの最小設定と`npm run lint`
  - [x] markdownリンクチェック(or lychee) のJob追記
  - [x] .github/ISSUE_TEMPLATE / PULL_REQUEST_TEMPLATE 追加
- [x] バックエンド: 番号採番サービス（number_sequencesラッパ）とメール送信Stubをユーティリティ化
  - [x] numberSequencesテーブル用のupsertエラー処理（シリアル上限、月跨ぎ）
  - [x] メール送信stub（sendInvoiceEmail/sendPurchaseOrderEmail）をservices/notifier.tsに切り出し
  - [x] send routesからstubを呼び出すよう整理
- [x] バックエンド: 承認ルールマッチャー（条件→ステップ生成）の雛形実装
  - [x] approvalRules.conditionsの構造サンプル（金額閾値/定期案件判定/小額スキップ）
  - [x] matcher関数: 入力(FlowType, payload)→steps[] を返すスタブをservices/approval.tsへ
- [x] バックエンド: ダッシュボード用アラートフィードAPI（メール送信Stubと同時に発報履歴保存）
  - [x] GET /alerts?projectId/&status= などの簡易フィルタ
  - [x] POST /jobs/alerts/run 内でAlertレコード保存＋notifier呼び出し
- [x] フロント: 認証モック（Google OIDC想定のセッション+BFFダミー）
  - [x] `/me`へのfetchとロール/グループ保持、未ログイン時の簡易ログインボタン
  - [x] fetchラッパで Authorization ヘッダの付与を集約
- [x] フロント: ダッシュボードでアラート表示（初期はダミーデータorAPI連携）
  - [x] アラートカードコンポーネント（type/対象/日時/ステータス）
  - [x] ダッシュボードで上位5件表示＋「すべて表示」リンク
- [x] フロント: ウェルビーイング Not Good 時のタグ/短文と「ヘルプ/相談」モーダル導線実装（相談先候補・緊急案内表示）
  - [x] モーダルの固定テキスト（相談先候補3件、緊急案内）を配置
  - [x] Not Good選択時のみタグ/コメント入力欄を表示
- [x] 移行: 旧ID→新UUIDマッピングテーブル設計とサンプルスクリプト
  - [x] mapping_users, mapping_projects, mapping_vendors のDDLと例データ
  - [x] 移行後に参照切れを検出するクエリテンプレート
- [x] 監査ログ設計: 主要操作（承認/発番/ウェルビーイング閲覧）のログ項目サマリ
  - [x] audit_logテーブル案（who/when/action/target/from/to/meta）
  - [x] 発番・承認・閲覧(Wellbeing)で記録する項目を列挙
- [x] バックエンド: シンプルなバリデーション (zod / fastify schema) を主要エンドポイントに付与
  - [x] time/expense/estimate/invoice/PO/leave の schema で必須/型/最小値を整理
  - [x] バリデーション失敗時のエラーレスポンスを揃える
- [x] バックエンド: `/me` にロール/グループ等のモックデータを返す
  - [x] roleに応じたownerOrgId/projectsフィルタのモックを追加
- [x] バックエンド: タイムシート修正時の承認ルール適用（変更時のみ approval 起動）
  - [x] PATCH /time-entries/:id 追加、変更点判定でApprovalInstance作成スタブ
- [x] バックエンド: 承認ステップの監査ログ（who/when/from/to/reason）保存
  - [x] ApprovalStep更新時にaudit_logへINSERTするhookスタブ
- [x] バックエンド: 送信Stub（請求書メール/発注書メール）とPDF生成枠のダミー関数
  - [x] services/notifier.ts に sendInvoiceEmail/sendPurchaseOrderEmail
  - [x] services/notifier.ts に PDF生成スタブ（テンプレ名を受け取る）
- [x] バックエンド: RBAC簡易チェック（role + projectId で閲覧をフィルタ）
  - [x] requireRoleにprojectIdチェックのオプションを追加し、time/expenseに適用
- [x] フロント: APIクライアントの共通ラッパ（fetch + エラーハンドリング）
  - [x] ヘッダ付与・エラー時トースト表示・リトライなしのベーシック版
- [x] フロント: 請求ドラフト詳細画面モック（明細、承認状態、送信ボタン）
  - [x] ダミーデータで明細テーブルと承認ステータス表示
- [x] フロント: 工数入力フォーム（プロジェクト/タスク/日付/時間/場所/残業区分）
  - [x] 入力→POST→一覧再取得のハッピーパス
- [x] フロント: ヘルプモーダルの内容（相談先ラベル/説明/緊急案内）を表示
  - [x] 単体コンポーネント化して日報画面に組み込み
- [x] テスト: バックエンド簡易ハッピーパス (contracts/invoices/time/expenses) のスモーク
  - [x] scripts/smoke-backend.sh で /projects→/estimates→/invoices→/send の一連
  - [x] /time-entries, /expenses のPOST/GET を同スクリプトで確認
- [x] テスト: 仕入/承認フローを含むスモークを追加 (#226)
  - [x] vendor/purchase order/vendor invoice/approval-instances を同スクリプトで確認
- [x] シード: 発注/仕入データと承認ルールを追加 (#228)
  - [x] purchase_order/vendor_invoice のApprovalRuleとデモデータを追加
- [x] チェック: PoC整合チェックに発注/仕入を追加 (#230)
  - [x] scripts/checks/poc-integrity.sql に件数/合計の確認を追加
- [x] ドキュメント: 公式ロール一覧の叩き台を追記 (#232)
  - [x] access-control にロール責務/権限のドラフトを追加
- [x] ドキュメント: 付け替え方針の理由コード/締め期間を追記 (#234)
  - [x] reassignment-policy に理由コードと締め期間の叩き台を追加
- [x] ドキュメント: バックアップ/リストア方針の叩き台を追記 (#236)
  - [x] 保持期間/暗号化/添付の扱いを明文化
- [x] ドキュメント: 運用監視の閾値/再送ポリシーを追記 (#238)
  - [x] ops-monitoring に監視閾値と再送の叩き台を追加
- [x] ドキュメント: ID管理のユーザ属性/監査ログ案を追記 (#240)
  - [x] id-management に属性表と監査ログのたたき台を追加
- [x] ドキュメント: ABAC条件フォーマットの叩き台を追記 (#242)
  - [x] access-control にフォーマット例とルール例を追加
- [x] テスト: フロントの手動確認手順（ダッシュボード→日報→工数→請求送信Stub）
  - [x] READMEに手順と期待結果を書き出し
- [x] CI: lint/format のジョブ追加 (GH Actions)、prisma format/validate を走らせる
  - [x] eslint/prettierが失敗した場合にfailさせる
- [x] CI: Vite build テストのジョブ追加
  - [x] `npm run build --prefix packages/frontend` を既存ジョブとは別に明示
- [x] 移行: 抽出→変換→ロードのスクリプト雛形 (Python or SQL) を docs に追加
  - [x] 抽出SQLサンプル（プロジェクト/見積/請求/工数/経費）
  - [x] 変換スクリプト雛形（python/pandas or SQL）
  - [x] ロード手順と検証チェックリスト
- [x] 移行: 重複コード/欠損データの検出ルールと簡易レポート草案
  - [x] コード重複（project code/invoice no/po no）の検出SQL
  - [x] 欠損（工数のprojectId/userId無し、請求の金額0）の検出SQL

## 12/1 週（ステージング前の仕上げ）
- [x] 発番と承認の実装PoC（API + バッチジョブで連携）
- [x] アラート発火の最小実装（予算+10%、残業、承認遅延のダッシュボード表示＋メール送信Stub）
- [x] 定期案件テンプレ生成のジョブテスト（毎月/四半期）
- [x] ウェルビーイング入力と人事閲覧のRBAC/監査ログ実装PoC
- [x] レポート3種の算出ロジック（プロジェクト別工数/予実、グループ別工数、個人別残業）
- [x] 納期範囲の未請求レポート（マイルストーンと請求の紐付け確認）
- [x] フロント: 日報/工数入力のUX改善とバリデーション（モバイル対応）
- [x] フロント: 請求ドラフトの一覧/詳細で番号・ステータスを表示、送信Stub連携
- [x] バックエンド: PDF生成Stub（請求書/発注書）とテンプレAPIの枠
- [x] バックエンド: 休暇/経費/タイムシート修正承認の統一ハンドラ
- [x] QA: 簡易E2Eまたは手順書（ハッピーパス）
- [x] フロント: 人事向け匿名集計ビューの骨組み（5人未満非表示）※簡易でもよい
- [x] バックエンド: metrics計算関数のスタブ（予算消化率、残業時間、承認遅延計測）
- [x] バックエンド: AlertSettingのCRUDと有効/無効切替API
- [x] バックエンド: ApprovalRule CRUDと条件/ステップ保存
- [x] バックエンド: RateCard 適用ロジック（工数×単価計算の枠）
- [x] フロント: アラート設定と承認ルールの簡易設定画面モック（保存は後続でも可）
- [x] 移行: サンプルデータを使ったPoCロード＆整合チェック（工数件数、請求合計）
- [x] CI: prettier/eslint 設定と整合性チェック
- [x] セキュリティ: CORS/ヘッダ/基本的な入力サイズ制限設定
- [x] プロダクト: アラート再送/サプレッションの設計メモ追加
- [x] プロダクト: QA用シードデータセット（プロジェクト/見積/請求/工数/経費）の作成

## 次フェーズ（本番化/運用準備）
- [x] PDF/メール本実装（テンプレ/署名/送信追跡/外部連携） (#139)
  - [x] 送信ログテーブルとAPI追加（請求/発注）
  - [x] 送信履歴の取得API追加
  - [x] SMTPメール送信の実装（請求/発注/アラート）
  - [x] ローカルPDF生成と配信（/pdf-files）
  - [x] SendGridメール送信の実装（請求/発注/アラート）
  - [x] PDF/メール送信の本実装（外部サービス連携）
  - [x] SMTP送信の簡易テスト（バリデーション/フォールバック）
- [x] 認証/IDaaS連携強化（SCIM/プロビジョニング） (#140)
  - [x] JWT Bearer認証モード（AUTH_MODE）とclaimマッピング追加
  - [x] SCIM/プロビジョニング連携の実装
- [x] テーブル設計の正規化/性能チューニング（大規模データ向け） (#141)
  - [x] 主要テーブルの複合インデックス追加（project/status/date, soft delete）
- [x] モバイル/ネイティブ対応（オフライン/Push） (#142)

### 本番化・運用整備（残タスク）
- [x] 性能チューニングの実測（主要クエリのEXPLAIN/統計収集） (#154)
  - [x] 承認一覧/アラート/工数集計のクエリ計画を docs に記録
  - [x] index/partition/summary の判断メモを追記
- [x] 運用監視の最小設計 (#155)
  - [x] バッチ失敗/アラート遅延の監視観点を整理
  - [x] バックアップ/リストア手順の草案作成
- [x] Vendor未登録時のPO作成が500になる (#180)

## Phase 2（拡張・2026H1）
- [x] HR/CRM 連携拡張の要件整理 (#156)
  - [x] HR: wellbeing/ID 連携のデータ範囲/匿名化ポリシー
  - [x] CRM: 顧客/業者/連絡先の同期範囲とマッピング
  - [x] 連携方式/頻度/エラー処理の整理
- [x] モバイル対応 PoC 設計 (#157)
  - [x] PWA/Capacitor の方針決定
  - [x] オフライン下書き（IndexedDB/SQLite）のフロー設計
  - [x] Push 通知の MVP 仕様（APNS/FCM）整理
- [x] 自動化ワークフロー/レポート拡張の設計 (#158)
  - [x] 定期レポート生成・配信の要件整理
  - [x] 承認フローの自動分岐/条件追加の設計
  - [x] レポートテンプレの拡張方針

## 12/10 以降（MVP後続拡張・完了分）
- [x] 承認期限エスカレーション、Slack/Webhook外部通知
- [x] 経費UI高度化（領収書URL入力/リマインダ）
- [x] グループチャット（プロジェクト紐付け、タグ、絵文字）
  - [x] プロジェクト紐付けのチャットAPI
  - [x] タグ/絵文字リアクション対応
- [x] レポート拡充（CSVエクスポート: 収支/工数/納期）
- [x] レポート拡充（カスタムレイアウト、PDFエクスポートの柔軟化）
- [x] データ品質チェックバッチ（コード重複、参照切れ、税率不整合）
- [x] アラートのリマインド/サプレッション設定
- [x] 承認期限エスカレーション設定UIとバッチ
- [x] ウェルビーイング匿名集計の高度化（時系列/部門比較、フィルタ、閾値設定）
  - [x] HR向け匿名集計API（group/月次、期間/閾値フィルタ）
  - [x] HR画面のフィルタ・時系列表示
- [x] 見積/請求テンプレ管理UI（番号ルール、フォーマット、署名挿入）

## 次フェーズ（基盤整備 → 承認・権限制御 → 主要機能拡充）
### 基盤整備
- [x] Prisma migration 方針の文書化（dev/staging/prod の使い分け）
- [x] Podman を使った検証手順の記載（DB起動/seed/チェック）
- [x] seed/検証手順の更新（updatedAt 必須反映）
- [x] DB初期化/検証の簡易スクリプト案の整理

### 承認・権限制御の本番化
- [x] 承認ルール条件の拡張（projectType/customerId/orgUnitId 等の入力整理）
- [x] 並列承認/二重チェックのUI想定とAPI項目の見直し
- [x] 並列承認の二重チェック制約（同一ユーザー禁止）のAPI実装
- [x] 承認インスタンスの閲覧範囲（申請者/プロジェクトメンバー）の実装方針整理
- [x] 監査ログの項目と保存方針の最終化
- [x] 期限超過アラートの運用ルール整理（エスカレーションは後続）

### マスタ管理
- [x] 顧客/業者マスタCRUDの追加 (#184)

### 案件・請求・工数の主要機能拡充
- [x] 案件階層/タスク/マイルストーンの編集フロー整理
- [x] 定期案件テンプレのUI/入力項目の設計
- [x] 見積/請求/発注の運用UI（一覧/詳細/承認）の要件整理
- [x] 損益・工数予実の算出ロジック整理（データソース/期間/単価）

### 実装準備（案件/請求/工数）
- [x] RecurringProjectTemplate のスキーマ拡張（dueDateRule/生成フラグ/マイルストーン初期値）
- [x] 定期案件テンプレの CRUD API と生成履歴の仕様決定
- [x] Project/Task/Milestone の CRUD + 付け替え/削除制約の実装
- [x] 見積/請求/発注/仕入の一覧・詳細 API（フィルタ/承認状態）実装
- [x] 損益・工数予実の集計 API とテスト（期間/単位）
- [x] ドキュメント整合（domain-api-draft/data-model-sketch/schema-prisma-sketch の更新）
- [x] 定期案件生成履歴テーブルの実装（recurring_generation_logs）
- [x] dueDateRule のバリデーション/変換ユーティリティ追加
- [x] Project/Task/Milestone の親子整合チェック（親タスクの同一project検証）
- [x] 収支レポートの集計軸拡張（group/user単位）

## 次の実装（運用・UI整備）
- [x] 顧客/業者マスタのUI（一覧/検索/登録/編集） (#188)
- [x] 取引先連絡先（Contact）のCRUD（API + UI） (#189)
- [x] Project の customerId 選択とバリデーション（API + UI） (#190)
- [x] projectId 手入力の一覧選択化（工数/経費/請求/レポート/チャット） (#191)
- [x] Vendor関連画面の整備（PO/仕入見積/仕入請求の一覧・詳細で名称表示） (#192)
- [x] QA手順の更新（マスタ/連絡先/プロジェクト連携） (#193)
- [x] 仕入/発注一覧UI追加 (#214)
- [x] 仕入/発注の登録UI（発注書/仕入見積/仕入請求の入力） (#215)
- [x] 発注/仕入請求の承認依頼ボタン追加 (#217)
- [x] 承認一覧UI（フィルタ/承認・却下操作） (#218)
- [x] 承認操作の可否UI (#219)
- [x] 承認アクションの権限制御 (#220)
- [x] pending_exec の反映 (#221)
- [x] ダッシュボードに承認待ち件数を表示 (#222)
- [x] 案件ラベル表示の改善 (#223)
- [x] QA手順更新（仕入/承認） (#224)

## Phase 3（2026H2〜）
- [x] AI支援/分析モジュールの要件整理 (#177)
- [x] GRC/監査機能強化の要件整理 (#178)

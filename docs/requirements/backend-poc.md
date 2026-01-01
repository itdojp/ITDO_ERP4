# バックエンド PoC 方針（12/10 ステージング向け）

目的: 発番・承認・アラートの最小ラインを通す API スケルトンを用意し、フロント PoC から触れるようにする。

## 技術スタック（案）
- Node.js / TypeScript
- Fastify or NestJS（軽量で可）
- Prisma + PostgreSQL（スキーマは packages/backend/prisma/schema.prisma）
- メール/通知は Stub（ログ出力）

## 最低限エンドポイント
- Auth: セッションモック（user/roleをヘッダで受け入れるデバッグモード）
- Projects: CRUD, 階層取得
- Estimates/Invoices: 作成/更新/submit/approve/send
- PurchaseOrders/VendorInvoices/VendorQuotes: 作成/submit/approve/send/ack
- TimeEntries: 登録/修正（修正時のみ承認フロー）
- Expenses: 作成/submit/approve
- DailyReports/Wellbeing: 作成/一覧（人事のみ閲覧）
- Alerts: list（ダッシュボード用）

## サービス層（モジュール）
- NumberingService: number_sequences を楽観ロックで更新、`PYYYY-MM-NNNN` を返す
- ApprovalService: approval_rules を評価し steps を生成、状態遷移を記録
- AlertService: 発火判定と alerts 作成、メール/ダッシュボード stub 送信
- RecurringService: recurring_project_templates からドラフト生成

## ミドルウェア
- Request context に user/role を注入（デバッグ時は固定ユーザ）。
- RBAC フックで API 単位にスコープチェック（簡易: ロール+プロジェクトID）。

## バッチ
- 発番: API内でトランザクション実行（別ジョブ不要）
- 定期案件: 1日1回の cron（node-cron 等）で RecurringService を呼び出し
- アラート: 1日1回で予算/残業/承認遅延を計算（初期）、数時間おきに拡張可

## 作業ステップ
- [ ] プロジェクト構成作成（packages/backend, tsconfig, lint）
- [ ] Prisma クライアントセットアップ & schema.prisma と同期
- [ ] NumberingService 実装（トランザクション＋リトライ）
- [ ] ApprovalService 雛形（rules → steps、状態遷移記録）
- [ ] AlertService 雛形（閾値判定、alerts insert、メール/ダッシュボード stub）
- [ ] エンドポイント: projects/estimates/invoices/purchase-orders/vendor-invoices/vendor-quotes/time-entries/expenses/daily-reports/wellbeing/alerts
- [ ] 簡易テスト or 手順（ハッピーパス）

## 留意
- 本番用の詳細な権限/監査/バリデーションは後続。PoC では Happy Path優先。
- メール/PDF/Slack は Stub でログ出力し、後続で差し替え。

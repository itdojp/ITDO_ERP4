# セキュリティベースライン（暫定）

## 目的
PoC→運用フェーズに向けて、最低限のセキュリティ基準（前提/脅威/対策/残課題）を明文化し、継続的に改善できる状態を作る。

## 守る資産（例）
- 顧客/業者/担当者などのマスタ情報
- 案件/見積/請求/発注/外部見積/外部請求の取引情報
- 工数/経費/休暇などの労務情報
- ウェルビーイング（センシティブ情報）
- 添付ファイル（PDF/画像等）
- 認証情報（JWT/トークン/セッション相当）

## 想定脅威（例）
- 認証回避、なりすまし
- 認可不備（IDOR）による他案件・他ユーザデータ閲覧/改ざん
- 入力不備（型/境界）による障害、想定外データ登録
- 依存関係脆弱性の混入
- 添付によるマルウェア持ち込み
- ログからの機密情報漏えい

## 前提（暫定）
- 本番は reverse proxy 配下で TLS 終端する（アプリ単体でのTLSは扱わない）
- DB はネットワーク分離され、アプリからのみ到達可能
- 管理者権限は限定された担当者が保持する

## 実装済みの最低対策（例）
- 認証/認可
  - `AUTH_MODE` により header/JWT を切替可能
  - RBAC（admin/mgmt/exec/hr/user 等） + プロジェクト所属に基づくアクセス制御（段階的）
- 入力サイズ制限
  - API bodyLimit（1MB）
  - 添付ファイルサイズ上限（既定 10MB、`CHAT_ATTACHMENT_MAX_BYTES` で調整）
- レート制限（最小）
  - `@fastify/rate-limit`（in-memory）を導入
  - `RATE_LIMIT_ENABLED=1` または `NODE_ENV=production` で有効化
  - 設定: `RATE_LIMIT_MAX`（既定 600）/ `RATE_LIMIT_WINDOW`（既定 `1 minute`）
- 可観測性
  - request-id（`x-request-id`）付与と統一エラー応答（`docs/ops/observability.md`）
- 監査ログ
  - 必須イベント一覧と最小項目を定義（`docs/security/audit-required-events.md`）
- キャッシュ制御
  - backend API は `Cache-Control: no-store` / `Pragma: no-cache` を既定付与
  - Service Worker は静的アセット（`/assets/*` とコアファイル）のみキャッシュし、`/api*`・`/health*`・`/ready*` はキャッシュしない
- Push通知
  - 通知URLは same-origin の相対パスのみ許可し、外部URLは `/` にフォールバック
- 添付
  - 方式は別Issueで継続（例: #560）

## CIでの最低チェック
### 依存脆弱性（high/critical の検出）
GitHub Actions で `npm audit --audit-level=high` を実行する。

- `.github/workflows/ci.yml` の `security-audit` job
- high/critical が検出された場合は CI を失敗させる
- moderate/low は運用で優先度を付けて対応（別途 Issue 化）

## 残課題（別Issue管理）
- SAST（CodeQL 等）の導入可否（リポジトリ公開範囲/契約制約に依存）
- IDOR の重点点検（主要API）
- Secrets 管理（環境変数/鍵/ローテーション）
- 添付のAVスキャン/隔離/最終保管（#560 等）

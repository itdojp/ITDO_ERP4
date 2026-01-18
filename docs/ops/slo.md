# SLI/SLO（暫定）

## 目的
可観測性（ログ/request-id）に加えて、運用上の目標（SLO）と許容範囲（エラーバジェット）を暫定定義し、運用の属人性を低減する。

## 用語
- SLI: 計測値（例: 5xx率、p95レイテンシ）
- SLO: 目標値（例: 月次 99.5%）
- エラーバジェット: SLO未達の許容枠（「どれくらい壊れてよいか」）

## 対象（最小セット）
PoC/初期運用で、ユーザ影響が大きい導線を最小セットとして定義する。

### 主要導線/API（3〜5）
1. 案件→見積→請求（ハッピーパス）
   - `POST /projects` → `POST /projects/:id/estimates` → `POST /projects/:id/invoices` → `POST /invoices/:id/send`
2. 工数入力
   - `POST /time-entries` / `GET /time-entries`
3. 経費入力
   - `POST /expenses` / `GET /expenses`
4. チャット（MVP）
   - ルーム一覧/投稿/既読（APIは後続で確定し、ログ計測対象に含める）

## SLI定義（暫定）
### Availability（エラー率）
- 分母: 対象APIへの全リクエスト数（`2xx/3xx/4xx/5xx`）
- 分子: `5xx` のリクエスト数
- SLI: `1 - (5xx / total)`

注意:
- 認可/入力ミス等の `4xx` は「ユーザ操作/データ品質」の指標として別途集計し、Availability SLI からは除外する（暫定）

### Latency（p95/p99）
- 対象: 対象APIの成功応答（`2xx/3xx`）の処理時間
- SLI: p95/p99（ログの `responseTime` などから集計）

### Saturation（枯渇）
取得可能な範囲で以下を指標とする。
- DB接続数（`pg_stat_activity`）
- DB負荷（`pg_stat_statements` の上位クエリ）
- コンテナのCPU/メモリ（`podman stats` 等）

### Correctness proxy（正しさの代理指標）
重要ジョブの失敗率を「正しさの代理指標」として扱う（暫定）。
- 例: `/jobs/alerts/run`、`/jobs/report-subscriptions/run`、`/jobs/report-deliveries/retry`

## SLO（暫定推奨値）
最初は「守れる値」を置き、ベースライン計測後に更新する。

### Availability
- 主要導線/API: **月次 99.5%**

### Latency
- 読み取り（GET中心）: **p95 < 800ms**
- 書き込み（POST中心）: **p95 < 1500ms**

## エラーバジェット（簡易）
- 99.5% / 30日 = 許容ダウンタイム（または失敗枠） 約 3.6 時間相当
- エラーバジェット消費が早い場合は、新規リリースより先に安定化を優先する（暫定ルール）

## 計測方法（最小構成）
### ログ
- backend は Fastify の JSON ログを標準とする（`docs/ops/observability.md`）
- 集計基盤（例: Cloud Logging / Loki / ELK 等）は環境依存
  - ない場合は、ファイル出力→`jq` 集計などの手動手順で代替する

### 参照
- アラート設計: `docs/ops/alerting.md`
- ダッシュボード定義: `docs/ops/dashboard.md`


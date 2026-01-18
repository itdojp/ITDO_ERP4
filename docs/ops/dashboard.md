# 運用ダッシュボード定義（最小セット）

## 目的
運用者が「平時の健全性」と「障害時の切り分け」を最短で行えるように、見るべき指標と導線を定義する。

## 前提
- 収集基盤（Prometheus/Grafana等）は環境依存
- 最小構成として、ログ集計とDBのメトリクス確認で代替可能

## 主要パネル（最小セット）
### Golden Signals（API）
- リクエスト数（RPS/分）
- 5xx率（主要導線）
- 4xx率（入力/認可の補助指標）
- p95/p99 レイテンシ（主要導線）

### 依存（DB）
- `/readyz` の状態（時系列）
- DB接続数（`pg_stat_activity`）
- 上位クエリ（`pg_stat_statements`）

### ジョブ/非同期処理
- 重要ジョブの成功/失敗（アラート生成、レポート配信等）
- リトライ増加の傾向

## 障害時の導線（見る順）
1. `/readyz` が 200 か（依存障害かどうか）
2. 5xx率が上がっている導線/API はどれか
3. 直近デプロイSHA/tag は何か
4. request-id を起点にログでトレース（`docs/ops/observability.md`）
5. DB接続/スロークエリの兆候があるか

## 関連
- SLO: `docs/ops/slo.md`
- アラート: `docs/ops/alerting.md`
- 一次切り分け: `docs/ops/incident-response.md`


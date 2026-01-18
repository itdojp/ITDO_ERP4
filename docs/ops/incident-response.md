# 障害対応（Runbook）

## 目的
障害対応を「検知→一次切り分け→復旧→振り返り」まで手順化し、属人性とMTTRを低減する。

## SEV（重大度）定義（暫定）
- **SEV1（重大）**: 業務停止相当、広範囲のユーザに影響、または情報セキュリティ事故の疑い
- **SEV2（高）**: 主要導線に影響、回避策はあるが放置できない
- **SEV3（中）**: 限定的影響、運用で吸収可能（営業時間内に対応）

注記:
- SEV は「影響」と「緊急度」で判断する。原因（バグ/設定/依存障害）は問わない。

## 連絡/エスカレーション（暫定）
運用体制に依存するため、最小限のルールのみ定義する。

- SEV1: 運用担当→管理者/マネージャへ即時連絡（チャネルは運用で定義）
- SEV2: 運用担当→管理者/マネージャへ共有、状況に応じて経営側へエスカレーション
- SEV3: Issue 化し、担当者/期限を設定して対応

## 初動（共通）
1. 影響範囲の確認（どの導線/APIか、発生時刻、再現条件）
2. `/healthz`（liveness）: `200` か
3. `/readyz`（readiness）: `200` か（`503` の場合は依存障害）
4. 直近デプロイSHA/tag の確認（`docs/ops/release-strategy.md`）
5. request-id（`x-request-id`）の取得（クライアント側/ログ）

ログの見方（request-id 起点）は `docs/ops/observability.md` を参照。
SLI/SLO とアラート定義は `docs/ops/slo.md` / `docs/ops/alerting.md` を参照。

## よくある症状と一次切り分け
### DBに接続できない（/readyz が 503）
- DB コンテナ/サービスの稼働確認
- `DATABASE_URL` の設定確認
- `scripts/podman-poc.sh start` / `scripts/podman-poc.sh check` の実行（検証環境）

### 依存脆弱性チェックが失敗する（security-audit）
- `npm audit --audit-level=high` の出力を確認し、High/Critical の有無を確認
- 許容する場合は理由と期限を Issue 化する（運用）

### レート制限で API が弾かれる
- `RATE_LIMIT_ENABLED` / `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` を確認
- health/readiness は allowlist のため通常は影響しない

## 対応中の記録（推奨）
対応が長引く場合、以下を必ず残す。
- 発生時刻/検知時刻
- 影響範囲（誰が/何ができないか）
- 直近変更（デプロイSHA/tag、Feature Flag変更など）
- 実施した対応と結果（時系列）

## 復旧後（必須）
1. 影響が収束したことの確認（主要導線/アラート）
2. Postmortem の作成（テンプレ）: `docs/ops/postmortem-template.md`
3. 再発防止/改善を Issue 化（担当者/期限を設定）

## 関連
- リリース/ロールバック: `docs/ops/release-strategy.md`
- Feature Flag: `docs/ops/feature-flags.md`
- ゲームデイ（演習計画）: `docs/ops/game-day.md`

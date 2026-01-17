# 可観測性（request-id / ログ / エラー）

## 目的
本番運用・障害解析の前提として、以下を標準化する。

- request-id（相関ID）でリクエストを追跡できること
- 構造化ログで検索・集計が可能であること
- 機密情報（認証情報等）がログに出ないこと
- API エラー応答の形式が統一されていること
- health/readiness が判定可能であること

## request-id（相関ID）
### ヘッダ
- inbound: `x-request-id`
  - クライアントが `x-request-id` を付与している場合、形式が安全な場合のみ採用する
  - 採用しない場合はサーバで新規生成する
- outbound: `x-request-id`
  - すべてのレスポンスに `x-request-id` を付与する（成功/失敗を問わない）

### 形式（採用条件）
- 1〜128 文字
- `[A-Za-z0-9._-]` のみ

## ログ
### 形式
- JSON（Fastify 内蔵 logger / pino）
- request-id（`reqId`）を含む

### レベル
環境変数 `LOG_LEVEL` で制御する。

- `fatal` / `error` / `warn` / `info` / `debug` / `trace`
- 未設定時は `info`

### redaction（機密情報マスク）
以下の代表的なキーを `[REDACTED]` に置換する（将来の拡張を見込む）。

- `authorization`
- `cookie`
- `set-cookie`
- `x-api-key`

## エラー応答（統一形式）
### 形式
API がエラーを返す場合、原則として以下の形式とする。

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": []
  }
}
```

### 方針
- 予期しない例外は `INTERNAL_ERROR` とし、`NODE_ENV=production` の場合は詳細メッセージを返さない
- 既存の `{"error":"..."}` 形式はレスポンス整形フックで `{"error":{"code":...}}` へ正規化する（段階移行）

## health / readiness
### `/healthz`
プロセスが稼働しているか（liveness）。

- `200` を返せば OK

### `/readyz`
主要依存（現時点では DB）が利用可能か（readiness）。

- `200`: ready
- `503`: not ready

レスポンス例:

```json
{
  "ok": true,
  "checks": {
    "db": { "ok": true }
  }
}
```

## 運用時の調査手順（例）
1. クライアント側で取得できる `x-request-id` を確認
2. サーバログを `reqId` で検索し、該当リクエストの開始〜終了（または例外）を追跡
3. エラー応答の `error.code` と合わせて原因箇所を特定


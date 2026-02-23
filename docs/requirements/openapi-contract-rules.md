# OpenAPI 契約整合ルール（Agent-First）

更新日: 2026-02-23  
関連Issue: #1205

## 目的

API 変更時の互換性と運用性を担保するため、OpenAPI スナップショットに対する最小ルールを定義する。

## 適用範囲

- `docs/api/openapi.json` に出力される全 API。
- 既存 API は段階適用、新規/更新 API は本ルールを必須化する。

## ルール

### 1. 命名

- パスはリソース名中心（動詞は末尾アクションに限定）。
  - 例: `/invoices/:id/send`, `/approval-instances/:id/act`
- クエリパラメータ名はドメイン共通語彙を優先。
  - 例: `projectId`, `from`, `to`, `status`, `limit`

### 2. エラー応答

- クライアントエラー/権限エラーは JSON で返す。
- エラーコードは機械判定可能な `error.code` を持つ。
- 推奨例:
  - `INVALID_DATE`, `INVALID_DATE_RANGE`
  - `forbidden_project`, `scope_denied`
  - `NOT_FOUND`, `REASON_REQUIRED`, `ACTION_POLICY_DENIED`

### 3. ページング

- 件数が増えうる一覧 API は `limit` を持つ。
- サーバ側上限を持ち、過大な要求は丸めるか 4xx で拒否する。
- 既存の非ページング API（集約 API など）は対象外。

### 4. 日付フォーマット

- 単日: `YYYY-MM-DD`
- 日時: ISO 8601（UTC 推奨）
- `from`/`to` は date / date-time の両方を許容する場合、
  実装側で補正ルール（例: date-only `to` は終端時刻補正）を明示する。

## CI 検証

`CI / api-schema` で以下を実施する。

1. `scripts/export-openapi.mjs` による再生成
2. `docs/api/openapi.json` との差分検証
3. ベースブランチとの差分で `openapi-diff` による破壊的変更チェック

## 運用ルール

- API 仕様変更時は、実装と同一 PR で `docs/api/openapi.json` を更新する。
- 仕様変更時は `docs/manual/` または `docs/requirements/` の関連文書も同時更新する。

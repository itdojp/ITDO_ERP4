# Agent Read API ガイド（Phase 1）

更新日: 2026-02-23  
関連Issue: #1205

## 目的

UIを開かずにプロジェクト状況と請求状況を把握するためのRead API利用手順を示す。

## 関連仕様

- Agent-First方針: `docs/requirements/agent-first-erp.md`
- OpenAPI契約ルール: `docs/requirements/openapi-contract-rules.md`

## 対象エンドポイント

- `GET /project-360`
- `GET /billing-360`

## 共通クエリ

- `projectId`（任意）: 対象案件ID
- `from`（任意）: 期間開始（ISO date/date-time）
- `to`（任意）: 期間終了（ISO date/date-time）

## 認可とスコープ

- 利用可能ロール: `admin` / `mgmt` / `exec` / `user`
- `admin` / `mgmt` は全案件スコープ
- `user` は `projectIds` に含まれる案件のみ
- スコープ外 `projectId` 指定時は `403 forbidden_project`

## 応答の要点

### `GET /project-360`

- プロジェクト件数（status別）
- 請求サマリ（status別件数・金額）
- 工数サマリ（status別件数・分）
- 経費サマリ（status別件数・金額）
- 承認待ち件数（全体・flowType別）

### `GET /billing-360`

- 請求status別件数・金額
- 未収（openAmount）/入金済み（paidAmount）/期限超過（overdueCount, overdueAmount）
- 支払側（仕入請求）status別件数・金額、未払合計

## 監査ログ

両APIは監査ログへ記録される。

- `action=project_360_viewed` / `billing_360_viewed`
- `targetTable=project_360` / `billing_360`
- `metadata`: 返却サマリ（scope/rangeを含む）
- 委任認証時は `source=agent` と `_auth` が付与される

### AgentRun との突合（監査ドリルダウン）

1. `GET /audit-logs?requestId=...&format=json&mask=0` で対象イベントを取得する
2. `metadata._agent.runId`（または `agentRunId`）を確認する
3. `GET /agent-runs/:id` で run/step/decision を取得し、実行経路を確認する

補足:

- 監査UI（管理画面の監査ログ）では `AgentRun` 列の `詳細` から同等の確認が可能。
- `GET /agent-runs/:id` は `admin/mgmt/exec` のみ参照可能。

## エラー

- `400 INVALID_DATE`: 日付形式不正
- `400 INVALID_DATE_RANGE`: `from > to`
- `403 forbidden_project`: スコープ外案件

## テスト観点（MVP）

- `packages/frontend/e2e/backend-agent-first-mvp.spec.ts`
  - `project-360` / `billing-360` のUI非依存取得
  - スコープ外プロジェクト拒否（`forbidden_project`）
  - 監査ログ上の `_request` / `_auth` メタ確認

# AgentOps ログモデル決定（Phase 1/2）

更新日: 2026-02-23  
関連Issue: #1209

## 結論

- 採用: **案C（ハイブリッド）**
  - Phase 1: `AuditLog.metadata` 拡張を継続（現行実装）
  - Phase 2以降: `AgentRun` / `AgentStep` / `DecisionRequest` を段階導入

## 現行（Phase 1）の評価

### 実装状況

- 実行監査: `AuditLog` + `metadata._request` / `metadata._auth`
- 主な保存項目
  - `source`（`agent` / `api`）
  - `requestId`
  - `principalUserId` / `actorUserId`
  - `authScopes` / `tokenId` / `audience` / `expiresAt`

### 利点

- 既存監査基盤を活用できる（追加テーブル不要）
- 既存 API（`/audit-logs`）で即時検索可能
- 監査イベントの導入コストが低い

### 制約

- 「1回のエージェント実行（Run）」を複数イベント横断で束ねにくい
- ステップ単位（tool call / reasoning checkpoint）の集計がしづらい
- 意思決定要求（DecisionRequest）の状態管理に非最適

## 案比較

| 案  | 概要                                    | 実装コスト | 運用負荷 | 監査再現性 | 評価                       |
| --- | --------------------------------------- | ---------- | -------- | ---------- | -------------------------- |
| A   | AuditLog metadata 拡張のみ              | 低         | 低       | 中         | Phase 1 には適合、長期不足 |
| B   | AgentRun/AgentStep/DecisionRequest 新設 | 高         | 中       | 高         | 最終形だが初期投入が重い   |
| C   | Phase1=A, Phase2以降でB                 | 中         | 中       | 高         | 段階導入に最適（採用）     |

## クエリ要件（Phase 2で満たす）

- Run単位: `runId` で開始〜完了を時系列追跡
- Step単位: API実行、外部連携、承認待ちなどの中間状態を追跡
- Decision単位: 承認要求/却下/再実行の履歴照会
- 監査連携: `AuditLog` から `runId` で相互参照可能

## 移行方針

1. Phase 1（現行）
   - `AuditLog.metadata` の `_request` / `_auth` を標準運用
2. Phase 2
   - `AgentRun` / `AgentStep` / `DecisionRequest` テーブル導入
   - 新規書き込みは新テーブルへ、監査は `AuditLog` へも継続記録
3. 互換運用
   - 監査UI/APIは既存 `AuditLog` を主、必要に応じ Run 詳細へドリルダウン

## ロールバック

- Phase 2 導入後も `AuditLog` を継続記録するため、
  新テーブル機能を無効化しても監査連続性は保持される。

## 実装（Issue #1214 / 2026-02-23）

- DBモデル:
  - `AgentRun`（run単位）
  - `AgentStep`（step単位）
  - `DecisionRequest`（承認/例外判断要求）
    - run単位の判断要求は `stepId=null`
    - step単位の判断要求は `stepId` を設定
- write path:
  - 委任認証（`auth.delegated=true`）のリクエストで `AgentRun`/`AgentStep` を自動記録
  - `policy_denied` / `approval_required` 応答時は `DecisionRequest` を自動作成
- 監査連携:
  - `AuditLog.metadata._agent.runId` / `decisionRequestId` を追加
  - `/audit-logs` のレスポンスに `agentRunId` / `agentRunPath` を追加
- Run詳細API:
  - `GET /agent-runs/:id`（admin/mgmt/exec）

## 移行/ロールバック手順（運用）

### 適用

1. `packages/backend/prisma/migrations/20260223193000_add_agent_ops_models/migration.sql` を適用
2. backend を再起動（Fastify hook でAgentRun記録が有効化）
3. 監査画面（`/audit-logs`）で AgentRun ドリルダウンが利用可能

### ロールバック

1. 一時停止が必要な場合は backend 側で `plugins/agentRuns.ts` の登録を外して再起動
2. 既存監査は `AuditLog` に残るため、監査追跡は継続可能
3. DBロールバックが必要な場合は上記migrationで追加した3テーブルを削除（データ退避後）

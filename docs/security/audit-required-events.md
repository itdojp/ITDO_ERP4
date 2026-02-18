# 監査ログ必須イベント定義（Security Hardening v1）

## 目的

- 重要操作の監査証跡を「どのイベント名で、どの最小項目を持って残すか」に統一する
- 実装差分レビュー時に、ログ抜けを機械的に確認できる状態にする

## 監査ログの最小項目

`audit_logs`（`packages/backend/prisma/schema.prisma`）のうち、運用で必須とする項目は以下。

- `action`（必須）: 操作種別。`domain_operation_result` 形式で命名（例: `project_member_added`）。
- `createdAt`（必須）: 記録時刻（UTC）。
- `userId`（推奨）: 実行主体。バッチ等は `system` または `null` を許容。
- `actorRole`（推奨）: 主要ロール（絞り込み用途）。
- `requestId`（推奨）: APIリクエストとの相関ID。
- `targetTable` / `targetId`（推奨）: 対象リソース識別子。
- `reasonCode` / `reasonText`（条件付き必須）: 例外運用・override・取消系では必須。
- `metadata`（推奨）: before/after、判定理由、件数などの補足情報。

## 必須イベント一覧（v1）

| 分類                    | 必須イベント（action）                                                                                                                                      | 実装箇所（代表）                                |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 権限・所属変更          | `project_member_added` / `project_member_removed` / `project_member_role_updated`                                                                           | `packages/backend/src/routes/projects.ts`       |
| 権限・所属変更          | `group_created` / `group_updated` / `group_deleted` / `group_member_added` / `group_member_removed`                                                         | `packages/backend/src/routes/groups.ts`         |
| 監査閲覧（break-glass） | `chat_break_glass_requested` / `chat_break_glass_approved` / `chat_break_glass_rejected` / `chat_break_glass_accessed`                                      | `packages/backend/src/routes/chatBreakGlass.ts` |
| 外部送信（設定/実行）   | `chat_room_updated`（`allowExternalIntegrations` 変更を含む）                                                                                               | `packages/backend/src/routes/chatRooms.ts`      |
| 外部送信（実行可否）    | `chat_external_llm_requested` / `chat_external_llm_succeeded` / `chat_external_llm_failed` / `chat_external_llm_blocked` / `chat_external_llm_rate_limited` | `packages/backend/src/routes/chatRooms.ts`      |
| 添付操作                | `chat_attachment_uploaded` / `chat_attachment_downloaded` / `chat_attachment_blocked` / `chat_attachment_scan_failed`                                       | `packages/backend/src/routes/chat.ts`           |
| 監査ログ閲覧            | `audit_log_exported`（JSON/CSVの検索・出力）                                                                                                                | `packages/backend/src/routes/auditLogs.ts`      |
| 重要状態変更            | `project_status_updated`                                                                                                                                    | `packages/backend/src/routes/projects.ts`       |

## 運用ルール

- 追加APIで権限判定・外部送信・状態遷移を実装する場合、上表に該当する `action` の追加/再利用を必須にする。
- `reasonText` は個人情報や機密値を含めない（必要情報は `metadata` に構造化して保持）。
- 監査ログの回帰防止として、最低1本の自動テスト（integration/e2e）で `action` 記録を検証する。

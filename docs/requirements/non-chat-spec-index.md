# 非チャット機能 仕様の所在（インデックス）

目的: チャット以外（案件/見積請求/工数/経費/承認/レポート/運用等）の仕様がどこに書かれているかを 1 箇所から辿れるようにする。

## 1. 仕様の一次ソース（読む順）
- スコープ/全体像: `docs/requirements/mvp-scope.md`
- ドメイン/データモデル/API たたき台: `docs/requirements/domain-api-draft.md`
- 画面/運用（見積/請求/発注/仕入）: `docs/requirements/estimate-invoice-po-ui.md`
- 承認/アラート: `docs/requirements/approval-alerts.md` / `docs/requirements/approval-log.md` / `docs/requirements/alerts-notify.md` / `docs/requirements/alert-suppression.md`
- 案件/タスク/マイルストーン/定期案件:
  - `docs/requirements/project-task-milestone-flow.md`
  - `docs/requirements/recurring-project-template.md`
  - `docs/requirements/project-member-ops.md`
  - `docs/requirements/reassignment-policy.md`
- 工数/経費/休暇/日報/ウェルビーイング:
  - API/概念: `docs/requirements/domain-api-draft.md`
  - ウェルビーイング: `docs/requirements/wellbeing-policy.md`
- 損益/予実/単価: `docs/requirements/profit-and-variance.md` / `docs/requirements/rate-card.md`
- 認証/ID/アクセス制御: `docs/requirements/id-management.md` / `docs/requirements/access-control.md` / `docs/requirements/rbac-matrix.md`
- 運用（バックアップ/監視/ジョブ）: `docs/requirements/backup-restore.md` / `docs/requirements/batch-jobs.md` / `docs/requirements/ops-monitoring.md`
- データ移行: `docs/requirements/migration-mapping.md` / `docs/requirements/db-migration.md` / `docs/requirements/migration-poc.md`
- QA/テスト: `docs/requirements/qa-plan.md` / `docs/requirements/manual-test-checklist.md` / `docs/test-results/README.md`

補足: チャットの仕様は `docs/requirements/project-chat.md` を一次ソースとする。

## 2. 仕様の確定事項（要点）
- 工数: 基本は承認なしで記録し、修正（重要項目変更）のみ承認フロー対象（管理部グループ、将来の拡張で段数追加可能）。
- 経費: 必ず案件に紐付ける（共通経費は社内/管理案件プロジェクトで扱う）。
- 見積/請求: 見積なし請求を許容。マイルストーン紐付けは任意。納期超過未請求はアラート/レポートで検知する。
- 採番: `PYYYY-MM-NNNN`（P=Q/D/I/PO/VQ/VI ...）を区分×年月で連番管理する。
- 削除: 物理削除は原則禁止。論理削除 + 理由コード。付け替え/削除は承認WF中は不可（取消後に実施）。

## 3. 仕様の整合メモ（更新対象）
- `docs/requirements/mvp-scope.md` は要約のため、承認や運用の最終値は `docs/requirements/approval-alerts.md` を一次として参照する。
- 承認操作は原則 `POST /approval-instances/:id/act` に集約する（各リソースの `/approve` は持たない方針）。

## 4. 要確認（非チャット）
- 見積番号の永続化: 見積を番号で検索/参照する要件があるか（DBに見積番号を保持するか/表示時に生成するか）。
- 請求の dueDate 必須度: 必須にするか（未入力は警告に留めるか）。
- 入金/支払の扱い: `paid` 遷移の権限/責務（部分入金や仕訳連携はスコープ外で良いか）。
- 締め運用: 月次/案件期間ロックの基準（`period_locks` の運用と整合）。
- S3本番値: バケット/リージョン/KMS確定値と移行時期（`docs/requirements/backup-restore.md`）。

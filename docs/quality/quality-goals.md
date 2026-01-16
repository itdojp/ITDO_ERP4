# 品質目標（Quality Goals）

## 目的
本プロダクトにおける「品質で守る対象（スコープ）」と「優先順位」を明文化し、以後の実装・レビュー・運用判断の基準にする。

## 対象システム（現状）
- Backend: TypeScript / Fastify / Prisma（`packages/backend`）
- Frontend: TypeScript / React / Vite / Playwright（`packages/frontend`）
- DB: PostgreSQL 15（CIは service、検証は Podman を主に利用）
- 運用スクリプト: `scripts/`（E2E、スモーク、バックアップ/リストア、移行、疎通チェック等）

## 品質スコープ（起点）
PoC導線の手動確認ドキュメントを、品質スコープの起点として扱う。
- `docs/requirements/manual-test-checklist.md`
- `packages/backend/src/tests/happy-path.md`

補助（QA/リリース準備のチェックリスト）
- `docs/requirements/qa-plan.md`
- `docs/plan/release-checklist.md`

## 品質スコープ（MVPで守る範囲）
### 1) 業務機能（PoC導線 + 主要CRUD）
目的: 回帰防止（最低限「壊していない」ことを保証する）

- フロントE2E（`scripts/e2e-frontend.sh`）でカバーされる主要フロー
- バックエンドのハッピーパス/スモーク（`scripts/smoke-backend.sh`）
- 主要CRUD（顧客/業者/案件/見積/請求/発注/工数/経費/承認/レポート/チャット）

### 2) データ移行（PO→ERP4）
目的: 一方向移行のリハーサルを反復可能にし、移行失敗/不整合を早期に顕在化させる

- ツール: `scripts/migrate-po.ts`
- Runbook: `docs/requirements/migration-runbook.md`
- 整合チェック: `scripts/checks/migration-po-integrity.sql`

### 3) バックアップ/リストア（復旧可能性）
目的: 障害時に「復元できる」状態を維持する（手順と検証記録を残す）

- ドキュメント: `docs/requirements/backup-restore.md`
- スクリプト: `scripts/backup-prod.sh`（S3/別ホスト/GPGを想定）
- PoC/検証: `scripts/podman-poc.sh backup|restore`

### 4) セキュリティ（最低限のガード）
目的: 明確な危険を作らない（権限・外部連携・添付/ファイルの基本対策）

- 認可: RBAC/ABAC（`packages/backend/src/services/rbac.ts` ほか）
- 監査ログ: `packages/backend/src/services/audit.ts` + 各APIからの記録
- 外部通知: Webhook/Slack（SSRF対策/allowlist等）
- チャット添付: AVスキャン拡張（`docs/requirements/chat-attachments-antivirus.md`）

## 品質目標（優先順位と判定基準）
本プロジェクトは段階強化を前提とし、まずは「壊さない」ことを優先する。

### P0（最優先: 破綻を防ぐ）
- CI の必須ゲートが通ること（詳細: `docs/quality/quality-gates.md`）
- PoC導線の最小QAが実施できること（`docs/requirements/qa-plan.md` の「ハッピーパス最小」）
- DB整合チェックが破綻しないこと
  - PoC: `scripts/checks/poc-integrity.sql` がエラーなく実行できる
  - 移行: `scripts/checks/migration-po-integrity.sql` がエラーなく実行できる（#543 実施時）

### P1（重要: 運用上の事故を減らす）
- 監査ログが「いつ/誰が/何を」行ったか追跡できる（閲覧/エクスポート含む）
- 外部連携（Webhook等）で既知の危険（SSRF/過大payload等）を作らない
- 重要運用（バックアップ/リストア/移行）の手順が docs にあり、検証結果が `docs/test-results/` に残る

### P2（改善: 体験/保守性）
- UIの状態表現（loading/error/empty/disabled）が一貫している
- 主要画面で design-system を適用し、UIの部品/密度が統一される（#547）
- コード規約（lint/format）により、変更の読みやすさが維持される

## 既知の「後で強化する」品質（今は目標に含めない）
- 性能のSLO/SLA（数値目標の確定と負荷試験の定常運用）
- セキュリティの高度化（SAST/DAST、WAF、脅威モデリング、秘密情報スキャンの自動化）
- 移行の完全自動化（複数回リハーサルの完全再現性と差分検知の自動化）

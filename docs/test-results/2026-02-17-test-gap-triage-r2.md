# 2026-02-17 Test Gap Triage R2

Issue: #1001

## 対象
- `docs/manual/manual-test-checklist.md`（未チェック 80 項目）
- 高優先ドメイン: 承認/通知/仕入請求(PO↔VI)/権限

## 先行判定（高優先のみ）

| ドメイン | チェック項目（代表） | 既存自動テスト根拠 | 判定 | 次アクション |
| --- | --- | --- | --- | --- |
| 承認(Workflow) | 承認一覧で承認実行、ack guard時の理由必須、リンク作成/削除 | `packages/frontend/e2e/frontend-smoke.spec.ts` (`approval ack link lifecycle`, `approvals ack guard requires override reason`), `packages/frontend/e2e/backend-action-policy-ack-guard.spec.ts` | 自動E2E済み | 失敗時メッセージの文言変更耐性（code基準）を追加検討 |
| 通知 | 通知抑止、current-user通知設定、digest/realtime | `packages/frontend/e2e/backend-notification-suppression.spec.ts`, `packages/frontend/e2e/frontend-smoke.spec.ts` (`current-user notification settings`) | 自動E2E済み | 通知カード遷移（dashboard click-through）を追加 |
| 仕入請求(PO↔VI) | link/unlink、submit後理由必須、配賦/明細整合 | `packages/frontend/e2e/backend-vendor-invoice-linking.spec.ts`, `packages/frontend/e2e/frontend-smoke.spec.ts` (`vendor docs create`, `vendor approvals`) | 概ね自動E2E済み | `GET/PUT /vendor-invoices/:id/lines` の負値境界を追加 |
| 権限境界 | project access、non-admin制限、override監査 | `packages/frontend/e2e/backend-project-access-guard.spec.ts`, `packages/frontend/e2e/backend-vendor-invoice-linking.spec.ts`, `packages/frontend/e2e/backend-action-policy-ack-guard.spec.ts` | 自動E2E済み | 非管理ロールのUI非表示/無効化のE2Eを追加 |

## 未カバー（優先）

1. Dashboard通知カードの遷移検証（chat/休暇/経費）
   - チェックリスト: 「ダッシュボード: 通知カードが表示され、クリックで該当画面に遷移」
   - 現状: APIレベルと設定UIは網羅、カード遷移は未自動化
2. Vendor invoice lines 境界（部分請求残が負値になる更新は 400）
   - チェックリスト: `PUT /vendor-invoices/:id/lines` の境界
   - 現状: link/unlink と submit後制御は網羅、lines負値境界の直接E2Eは不足
3. モバイル回帰（375x667）
   - チェックリスト: Invoices/VendorDocuments/AuditLogs/PeriodLocks/AdminJobs
   - 現状: 画面単位のモバイル検証シナリオ未整備

## 次PR候補（小粒）

- PR-A: dashboard notification card click-through E2E
- PR-B: vendor-invoice lines negative-remaining boundary E2E
- PR-C: mobile smoke for Invoices/VendorDocuments/AdminJobs (375x667)

## 備考
- 現時点では高優先4ドメインの「機能自体の回帰防止」は成立。
- 以降は UI 遷移品質と境界条件の取りこぼしを埋める段階。

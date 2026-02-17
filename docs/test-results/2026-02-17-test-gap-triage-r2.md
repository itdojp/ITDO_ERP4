# 2026-02-17 Test Gap Triage R2

Issue: #1001

## 対象

- `docs/manual/manual-test-checklist.md`（未チェック 42 項目）
- 高優先ドメイン: 承認/通知/仕入請求(PO↔VI)/権限

## 先行判定（高優先のみ）

| ドメイン        | チェック項目（代表）                                       | 既存自動テスト根拠                                                                                                                                                                                                                                                   | 判定        | 次アクション                                               |
| --------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------- |
| 承認(Workflow)  | 承認一覧で承認実行、ack guard時の理由必須、リンク作成/削除 | `packages/frontend/e2e/frontend-smoke-approval-ack-link.spec.ts`, `packages/frontend/e2e/frontend-smoke-approvals-ack-guard.spec.ts`, `packages/frontend/e2e/backend-action-policy-ack-guard.spec.ts`                                                                | 自動E2E済み | 失敗時の分岐（schema validation含む）の code基準維持を継続 |
| 通知            | 通知抑止、current-user通知設定、digest/realtime            | `packages/frontend/e2e/backend-notification-suppression.spec.ts`, `packages/frontend/e2e/frontend-smoke-current-user-notification-settings.spec.ts`, `packages/frontend/e2e/frontend-dashboard-notification-routing.spec.ts`                                         | 自動E2E済み | 高優先ギャップ解消済み                                     |
| 仕入請求(PO↔VI) | link/unlink、submit後理由必須、配賦/明細整合               | `packages/frontend/e2e/backend-vendor-invoice-linking.spec.ts`, `packages/frontend/e2e/frontend-smoke-vendor-docs-create.spec.ts`, `packages/frontend/e2e/frontend-smoke-vendor-approvals.spec.ts`                                                                   | 自動E2E済み | 高優先ギャップ解消済み                                     |
| 権限境界        | project access、non-admin制限、override監査                | `packages/frontend/e2e/backend-project-access-guard.spec.ts`, `packages/frontend/e2e/backend-vendor-invoice-linking.spec.ts`, `packages/frontend/e2e/backend-action-policy-ack-guard.spec.ts`, `packages/frontend/e2e/frontend-smoke-invoice-send-mark-paid.spec.ts` | 自動E2E済み | 高優先ギャップ解消済み                                     |

## 優先ギャップの対応状況（2026-02-17 更新）

1. Dashboard通知カードの遷移検証（chat/休暇/経費）
   - 対応: `packages/frontend/e2e/frontend-dashboard-notification-routing.spec.ts`
   - 状態: main 反映済み
2. Vendor invoice lines 境界（部分請求残が負値になる更新は 400）
   - 対応:
     - `packages/frontend/e2e/backend-vendor-invoice-linking.spec.ts`
     - `PO_LINE_QUANTITY_EXCEEDED`（単一行/分割行）と `quantity <= 0` の境界をカバー
     - `GET /vendor-invoices/:id/lines` の `poLineUsage` をカバー
     - `purchaseOrderLineId` の異常系（PO未紐づけ=400 / 別PO line=400 / 不存在line=404）をカバー
     - `PUT /vendor-invoices/:id/allocations` の `autoAdjust` 境界、`allocations=[]` クリア、監査ログをカバー
     - allocations の `purchaseOrderLineId` 異常系（PO未紐づけ=400 / 別PO line=400 / 不存在line=404）をカバー
   - PR: #1054, #1057, #1059（main 反映済み）
3. モバイル回帰（375x667）
   - 対応: `packages/frontend/e2e/frontend-mobile-smoke.spec.ts`
   - 範囲: Invoices / VendorDocuments / AdminJobs / AuditLogs / PeriodLocks
   - PR: #1056（main 反映済み）

## 次PR候補（小粒）

- 高優先4ドメインの直近ギャップは解消済み
- 次段は `docs/manual/manual-test-checklist.md` の未消化項目から低優先項目を分割する

## 備考

- 現時点では高優先4ドメインの「機能自体の回帰防止」は成立。
- 以降は UI 遷移品質と境界条件の取りこぼしを埋める段階。

# 2026-02-16 仕様実装トレーサビリティ（初回棚卸）

Issue: #993  
対象: 主要8仕様（workflow / notifications / vendor-doc-linking / chat / access-control / delivery-invoice-flow / estimate-invoice-po-ui / ack-workflow-linking）

## 要約

- backend / frontend ともに主要仕様の実装は存在
- ただし E2E は「作成・基本操作」の網羅が中心で、管理系・例外系・ポリシー変更反映の検証が不足
- 次優先は「ack-workflow-linking」「vendor-doc-linking」「workflow policy変更反映」の3系統

## マッピング（初回）

### 1) workflow

- backend: `packages/backend/src/services/approval.ts`, `packages/backend/src/services/approvalLogic.ts`, `packages/backend/src/routes/approvalRules.ts`, `packages/backend/src/services/actionPolicy.ts`
- frontend: `packages/frontend/src/sections/Approvals.tsx`, `packages/frontend/src/sections/AdminSettings.tsx`
- tests: `packages/backend/test/approvalLogic.test.js`, `packages/backend/test/actionPolicy.test.js`, `packages/frontend/e2e/frontend-smoke.spec.ts`（workflow evidence）
- gap:
  - 管理画面で policy/guard を変更した後の UI/E2E 検証が不足
  - guard failure 時の画面表示と理由入力の検証不足

### 2) notifications

- backend: `packages/backend/src/services/appNotifications.ts`, `packages/backend/src/services/notificationDeliveries.ts`, `packages/backend/src/services/notificationPushes.ts`, `packages/backend/src/routes/notifications.ts`
- frontend: `packages/frontend/src/sections/Dashboard.tsx`, `packages/frontend/src/sections/CurrentUser.tsx`
- tests: `packages/backend/test/notificationPreferences.test.js`, `packages/backend/test/notificationSuppressionRules.test.js`, `packages/frontend/e2e/backend-notification-suppression.spec.ts`
- gap:
  - 通知設定UI（digest/emailMode）の E2E が不足
  - ミュート操作の失敗系 UI 検証不足

### 3) vendor-doc-linking

- backend: `packages/backend/src/routes/vendorDocs.ts`, `packages/backend/src/services/vendorInvoiceAllocations.ts`, `packages/backend/src/services/vendorInvoiceLines.ts`, `packages/backend/src/services/vendorInvoiceLineReconciliation.ts`
- frontend: `packages/frontend/src/sections/VendorDocuments.tsx`
- tests: `packages/backend/test/vendorInvoiceAllocations.test.js`, `packages/backend/test/vendorInvoiceLines.test.js`, `packages/backend/test/vendorInvoiceLineReconciliation.test.js`, `packages/frontend/e2e/frontend-smoke.spec.ts`（vendor docs create）
- gap:
  - paid/admin例外（理由必須）と監査表示の E2E 不足
  - 数量整合の UI 経由検証不足

### 4) chat / project-chat

- backend: `packages/backend/src/routes/chat.ts`, `packages/backend/src/routes/chatRooms.ts`, `packages/backend/src/services/chatAckNotifications.ts`, `packages/backend/src/services/chatMentionRecipients.ts`
- frontend: `packages/frontend/src/sections/ProjectChat.tsx`, `packages/frontend/src/sections/RoomChat.tsx`
- tests: `packages/backend/test/chatAckReminders.test.js`, `packages/backend/test/chatMentionNotifications.test.js`, `packages/frontend/e2e/frontend-smoke.spec.ts`（room chat 系）
- gap:
  - ack テンプレ/理由必須/期限超過系の画面検証が不足
  - break-glass 操作の E2E 不足

### 5) access-control

- backend: `packages/backend/src/services/rbac.ts`, `packages/backend/src/plugins/auth.ts`, `packages/backend/src/services/actionPolicy.ts`
- frontend: `packages/frontend/src/sections/AccessReviews.tsx`, `packages/frontend/src/sections/GroupManagementCard.tsx`
- tests: `packages/backend/test/rbac.test.js`, `packages/backend/test/actionPolicy.test.js`, `packages/frontend/e2e/backend-project-access-guard.spec.ts`
- gap:
  - UIからのポリシー変更後の権限反映 E2E が不足
  - AccessReview画面の結果検証が浅い

### 6) delivery-invoice-flow

- backend: `packages/backend/src/routes/estimates.ts`, `packages/backend/src/routes/invoices.ts`, `packages/backend/src/routes/purchaseOrders.ts`, `packages/backend/src/services/numbering.ts`
- frontend: `packages/frontend/src/sections/Estimates.tsx`, `packages/frontend/src/sections/InvoiceDetail.tsx`
- tests: `packages/frontend/e2e/frontend-smoke.spec.ts`（請求詳細の一部）
- gap:
  - 見積->請求連携、send/mark-paid を UI で通す E2E が不足
  - 納品連携フローの一貫シナリオ不足

### 7) estimate-invoice-po-ui

- backend: `packages/backend/src/routes/estimates.ts`, `packages/backend/src/routes/invoices.ts`, `packages/backend/src/routes/purchaseOrders.ts`
- frontend: `packages/frontend/src/sections/Estimates.tsx`, `packages/frontend/src/sections/Invoices.tsx`, `packages/frontend/src/sections/VendorDocuments.tsx`
- tests: `packages/frontend/e2e/frontend-smoke.spec.ts`（基本作成系）
- gap:
  - フィルタ/検索/ページングの E2E 不足
  - 承認ステップ表示や一覧系 UX の回帰検証不足

### 8) ack-workflow-linking

- backend: `packages/backend/src/routes/chatAckLinks.ts`, `packages/backend/src/services/chatAckLinkTargets.ts`, `packages/backend/src/services/actionPolicy.ts`
- frontend: `packages/frontend/src/sections/Approvals.tsx`, `packages/frontend/src/sections/RoomChat.tsx`
- tests: `packages/backend/test/chatAckLinkTargets.test.js`, `packages/backend/test/chatAckRecipients.test.js`, `packages/frontend/e2e/backend-action-policy-ack-guard.spec.ts`
- gap:
  - UI からの ack link 作成->参照->解除のライフサイクル E2E 不足
  - guard 失敗時の理由入力誘導の UI 検証不足

## 次アクション（#993 の Lane C 優先）

1. `ack-workflow-linking` の UIライフサイクル E2E 追加（優先度A）
2. `vendor-doc-linking` の admin例外/監査表示 E2E 追加（優先度A）
3. workflow policy変更反映（AdminSettings -> Approvals）の E2E 追加（優先度A）

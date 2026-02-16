# 品質向上R2: Lane D/E 調査結果（2026-02-17）

対象 Issue: #1001

## 1. Lane D（ホットスポットリファクタ）

### 1-1. 現状計測
- `packages/frontend/src/sections/VendorDocuments.tsx`: 3,774 lines
  - `useState`: 58
  - `useCallback`: 11
  - 主責務が混在（PO/仕入見積/仕入請求の一覧・作成、POリンク、配賦明細、請求明細、送信履歴、注釈ダイアログ）
- `packages/frontend/src/sections/AdminSettings.tsx`: 3,518 lines
  - `useState`: 37
  - `useCallback`: 14
  - 主責務が混在（アラート、承認ルール、ActionPolicy、Ackテンプレ、テンプレ設定、連携、配信、監査履歴）
- backend chat routes
  - `packages/backend/src/routes/chatRooms.ts`: 3,188 lines
  - `packages/backend/src/routes/chat.ts`: 2,031 lines
  - 同種ユーティリティの重複実装あり（例: `parseDateParam`, `parseLimit`, `normalizeStringArray`, `parseLimitNumber`, `parseNonNegativeInt`, `normalizeMentions`）

### 1-2. 分割/共通化の推奨設計

#### A. `VendorDocuments.tsx` 分割案
1. `VendorDocumentsPage.tsx`（コンテナ）
   - タブ状態・共通メッセージ・共通マスタ（project/vendor）を保持
2. `vendor-documents/purchase-orders/*`
   - `PurchaseOrderCreateForm`
   - `PurchaseOrderListSection`
   - `PurchaseOrderSendLogsDialog`
3. `vendor-documents/vendor-quotes/*`
   - `VendorQuoteCreateForm`
   - `VendorQuoteListSection`
4. `vendor-documents/vendor-invoices/*`
   - `VendorInvoiceCreateForm`
   - `VendorInvoiceListSection`
   - `VendorInvoicePoLinkDialog`
   - `VendorInvoiceAllocationDialog`
   - `VendorInvoiceLinesDialog`
5. カスタムフック
   - `useVendorDocumentsMasterData`
   - `useVendorInvoiceDialogs`
   - `useVendorInvoiceLineValidation`

受け入れ条件:
- 既存E2E（vendor documents系）が全緑
- 既存API I/F（payload/endpoint）無変更
- タブ切替/検索/保存済みビュー/ダイアログ遷移のUI挙動不変

#### B. `AdminSettings.tsx` 分割案
1. `AdminSettingsPage.tsx`（コンテナ）
2. セクション単位のカード分割
   - `admin-settings/AlertSettingsCard`
   - `admin-settings/ApprovalRulesCard`
   - `admin-settings/ActionPoliciesCard`
   - `admin-settings/ChatAckTemplatesCard`
   - `admin-settings/TemplateSettingsCard`
   - `admin-settings/IntegrationSettingsCard`
   - `admin-settings/ReportSubscriptionsCard`
3. 監査履歴UIを再利用可能化
   - `admin-settings/AuditHistoryPanel`（承認ルール/ActionPolicyで共通）
4. カスタムフック
   - `useAdminSettingsDataLoaders`
   - `useAlertSettingsDraft`

受け入れ条件:
- 既存E2E（admin settings / alert settings / approval rules / chat settings）が全緑
- JSON入力バリデーションの挙動不変
- 監査履歴表示の差分なし

#### C. backend chat routes 共通化案
1. `packages/backend/src/routes/chat/shared/routeInput.ts`
   - `parseDateParam`
   - `parseLimit`
   - `parseLimitNumber`
   - `parseNonNegativeInt`
   - `normalizeStringArray`
2. `packages/backend/src/routes/chat/shared/mentions.ts`
   - `normalizeMentions`
   - `buildAllMentionBlockedMetadata`
3. 役割定義の一元化
   - `CHAT_ROLES` / `CHAT_ADMIN_ROLES` を shared constants 化
4. 段階導入
   - Step1: ヘルパー抽出のみ（挙動不変）
   - Step2: `chat.ts` と `chatRooms.ts` へ適用
   - Step3: `chatBreakGlass.ts`, `chatAckTemplates.ts`, `chatAckLinks.ts` へ適用

受け入れ条件:
- backend test 全緑
- 既存ルートのHTTPステータス/エラーコード不変
- 監査ログ作成点（action/metadata）不変

### 1-3. 推奨実施順序（PR順）
1. backend chat shared helpers 抽出（最小差分）
2. `AdminSettings.tsx` の監査履歴パネル共通化
3. `AdminSettings.tsx` セクション分割
4. `VendorDocuments.tsx` ダイアログ（POリンク/配賦/請求明細）分割
5. `VendorDocuments.tsx` タブ別セクション分割

理由:
- backend helper 抽出は依存範囲が狭く競合が少ない
- `AdminSettings` は既に一部Card化済みで段階分割しやすい
- `VendorDocuments` は業務ロジック密度が高く後段で実施した方が回帰管理しやすい

## 2. Lane E（非機能/運用）

### 2-1. low 脆弱性トリアージ（2026-02-17）
実行コマンド:
- `npm audit --prefix packages/backend --audit-level=low --json`
- `npm audit --prefix packages/frontend --audit-level=low --json`

結果:
- frontend: 0 件
- backend: low 1件 / moderate 7件

low 1件の詳細:
- package: `qs`
- advisory: `GHSA-w7fw-mjwx-w883`
- range: `>=6.7.0 <=6.14.1`
- 依存経路: `googleapis -> googleapis-common -> qs@6.14.1`

トリアージ判断:
- low 1件は修正対象（`qs` を patched に引き上げ）
- moderate 7件は `prisma` 系のメジャー更新を伴うため、別Issueで計画的に対応

### 2-2. #914 readiness 監視記録更新（2026-02-17）
実行コマンド:
- `make eslint10-readiness-check`

結果:
- `@typescript-eslint/eslint-plugin@8.56.0` peer: `^8.57.0 || ^9.0.0 || ^10.0.0`
- `@typescript-eslint/parser@8.56.0` peer: `^8.57.0 || ^9.0.0 || ^10.0.0`
- `ready: true`

判断:
- #914 の再開条件は充足済み
- 次アクションは #914 の未完了TODO（ignore解除 + Dependabot再開）を実施

## 3. 次アクション
- [ ] low脆弱性（qs）修正PRを作成
- [ ] #914 未完了TODOを実施するPRを作成
- [ ] Lane D の実装PRを上記順序で着手

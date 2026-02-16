# E2E Frontend Smoke 分割計画（R2 / Lane C）

## 背景
- 対象: `packages/frontend/e2e/frontend-smoke.spec.ts`
- 現状: 1ファイル 2,659行、15シナリオ（`@core` 1件 + `@extended` 14件）
- 課題:
  - 単一ファイル肥大化により、失敗時の影響範囲とレビュー負荷が大きい
  - `.first()` / `nth()` を起点にしたセレクタが散在し、将来のUI変更で不安定化しやすい

## 現状シナリオ棚卸し
- `frontend smoke core @core`
- `frontend smoke invoice send and mark-paid lifecycle @extended`
- `frontend smoke workflow evidence chat references @extended`
- `frontend smoke approval ack link lifecycle @extended`
- `frontend smoke approvals ack guard requires override reason @extended`
- `frontend smoke vendor approvals @extended`
- `frontend smoke vendor docs create @extended`
- `frontend smoke reports masters settings @extended`
- `frontend smoke current-user notification settings @extended`
- `frontend smoke chat hr analytics @extended`
- `frontend smoke room chat (private_group/dm) @extended`
- `frontend smoke room chat external summary @extended`
- `frontend smoke external chat invited rooms @extended`
- `frontend smoke additional sections @extended`
- `frontend smoke admin ops @extended`

## 分割方針（責務単位）
1. `frontend-smoke-core.spec.ts`
   - `@core` のみを保持（PR/CI の最短回帰確認を優先）
2. `frontend-smoke-billing.spec.ts`
   - 請求・送信・入金確認・workflow evidence
3. `frontend-smoke-approvals.spec.ts`
   - 承認リンク・ack guard・vendor approvals
4. `frontend-smoke-vendor-docs.spec.ts`
   - vendor docs create（PO紐づけ/解除、配賦・請求明細）
5. `frontend-smoke-chat.spec.ts`
   - room chat 系（private_group/dm / external / invited rooms）
6. `frontend-smoke-admin.spec.ts`
   - reports/masters/settings、admin ops、additional sections
7. `frontend-smoke-user-notifications.spec.ts`
   - current-user notification settings、chat hr analytics

## 互換維持ルール
- 既存タグ（`@core` / `@extended`）は維持
- 既存ヘルパー（`prepare` / `navigateToSection` / `ensureOk` 等）は
  `e2e/helpers/frontend-smoke-helpers.ts` に抽出し重複を削減
  （従来は `packages/frontend/e2e/*.ts` 直置きだったが、本計画では
  `helpers/` サブディレクトリ導入を許容する）
- 仕様変更は行わず、ファイル再配置＋セレクタ安定化に限定

## Flaky低減の優先修正候補（先行）
- `locator(...).first()` 依存（例: `frontend-smoke.spec.ts:713`, `:929`, `:1895`, `:2281`）
- `nth(1)` 依存（例: `frontend-smoke.spec.ts:1991`）
- 行選択はテキスト+ロール（`row` + `button`）を優先し、index依存を回避

## 段階導入（推奨順）
1. Phase 1: helper抽出 + `core` の独立（最小差分）
2. Phase 2: vendor-docs / approvals / billing を分割
3. Phase 3: chat / admin / user-notifications を分割
4. Phase 4: `.first()` / `nth()` の残件を段階除去

## 完了判定
- 分割後も `E2E_SCOPE=core` / `E2E_SCOPE=full` が緑
- 既存シナリオ名・タグが維持される
- `frontend-smoke.spec.ts` は廃止、または `@core` だけの薄いエントリに縮退

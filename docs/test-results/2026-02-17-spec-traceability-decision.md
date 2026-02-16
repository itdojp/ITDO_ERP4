# 2026-02-17 仕様⇔実装トレーサビリティ差分対応方針（Issue #993）

Issue: #993  
入力: `docs/test-results/2026-02-16-spec-traceability-initial.md`

## 結論

- Critical/High の差分は「修正実装」で対応する。
- Medium 以下で Phase 分割済みの差分は「仕様明記 + 後続Issue管理」で対応する。
- 2026-02-17 時点で、#993 の初回棚卸で優先度Aに置いた3件は実装またはテスト追加で解消済み。

## 差分対応方針（領域別）

| 領域 | 初回差分 | 方針 | 現在状態 |
| --- | --- | --- | --- |
| workflow | policy/guard変更後のUI検証不足 | 実装維持 + テスト補強（backend guardを先行） | 対応済み（`packages/frontend/e2e/backend-action-policy-ack-guard.spec.ts` + `packages/frontend/e2e/frontend-smoke.spec.ts` の `approvals ack guard requires override reason`） |
| notifications | digest/emailMode UI/E2E不足 | テスト補強 | 対応済み（`packages/frontend/e2e/frontend-smoke.spec.ts` の current-user notification settings） |
| vendor-doc-linking | admin例外/監査表示E2E不足 | テスト補強 | 対応済み（`packages/frontend/e2e/backend-vendor-invoice-linking.spec.ts`） |
| chat/ack | ack linkライフサイクルUI不足 | テスト補強 | 対応済み（`packages/frontend/e2e/frontend-smoke.spec.ts` の approval ack link lifecycle） |
| access-control | UIからの反映確認が浅い | backend権限制御テストを先行、UIは後続Issueで補強 | 進行中（`packages/frontend/e2e/backend-project-access-guard.spec.ts`） |
| delivery-invoice-flow | send/mark-paid一貫シナリオ不足 | テスト補強 | 対応済み（`packages/frontend/e2e/backend-time-invoice.spec.ts` + `packages/frontend/e2e/frontend-smoke.spec.ts` の `invoice send and mark-paid lifecycle`） |
| estimate-invoice-po-ui | 一覧UX回帰（検索/ページング）不足 | 仕様更新 + 後続IssueでE2E追加 | 後続（#543, #544 に集約） |
| ack-workflow-linking | guard失敗時UI誘導不足 | テスト補強 | 対応済み（`packages/frontend/e2e/backend-action-policy-ack-guard.spec.ts`） |

## 補足（#993 で追加で検出した差分）

### 1) Security（Critical）
- 差分: productionで header auth fallback が有効化されると、プロキシ設定次第でヘッダ偽装リスクが残る。
- 方針: 修正実装。
- 対応: PR #995（`AUTH_ALLOW_HEADER_FALLBACK_IN_PROD` 導入、production guard 追加、`docs/ops/configuration.md` 更新）。

### 2) E2E運用（Medium）
- 差分: 起動待機 40 秒固定と短い既定UIタイムアウトにより、遅い環境で不安定化しうる。
- 方針: 修正実装。
- 対応: PR #996（`E2E_SERVICE_READY_TIMEOUT_SEC`/`E2E_SERVICE_READY_INTERVAL_SEC`、`E2E_ACTION_TIMEOUT_MS` 既定見直し、手入力JSON validation ノイズ抑制）。

## 判定

- 差分対応方針（実装 or 仕様更新）の決定は完了。
- 未着手差分は後続Issueに集約し、#993 のスコープでは Critical/High を優先的に収束させる。

# Agent-First MVP 検証計画

更新日: 2026-02-23  
関連Issue: #1210, #1200

## 目的

Issue #1200 で定義した MVP 受け入れ条件を、自動テストで再現可能な形に落とし込む。

## 受け入れ条件と検証シナリオ

| 受け入れ条件 | 検証シナリオ | 自動テスト |
| --- | --- | --- |
| UI非依存で Project/Billing の状況を説明できる | `project-360` / `billing-360` を API 呼び出しで取得し、主要サマリを検証する | `packages/frontend/e2e/backend-agent-first-mvp.spec.ts`（`agent read api: ...`） |
| 請求ドラフト生成→承認→送信を理由・証跡付きで追跡できる | 請求作成（draft）→ submit → approval approve → send を通し実行し、send log と承認監査を確認する | `packages/frontend/e2e/backend-agent-first-mvp.spec.ts`（`agent mvp: ...`） |
| エージェント実行を監査から再現できる（権限主体・根拠・実行API） | 監査ログの `_request.id` / `_request.source` / `_auth.principalUserId` / `_auth.actorUserId` を検証する | E2E: `packages/frontend/e2e/backend-agent-first-mvp.spec.ts` + backend integration: `packages/backend/test/auditContextAgent.test.js`, `packages/backend/test/authDelegated.test.js` |

## 実行コマンド

```bash
# backend integration
npm run test:ci --prefix packages/backend -- test/agent360Routes.test.js test/authDelegated.test.js test/auditContextAgent.test.js

# e2e（対象シナリオのみ）
E2E_SCOPE=core E2E_GREP="agent read api|agent mvp" E2E_CAPTURE=0 ./scripts/e2e-frontend.sh
```

## 補足

- E2E 実行基盤は `AUTH_MODE=header` 固定のため、delegated JWT の境界は backend integration で補完している。
- delegated JWT のフルE2Eは別タスクとして追加検討する。

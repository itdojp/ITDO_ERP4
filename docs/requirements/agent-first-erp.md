# Agent-First ERP 方針（RFC確定版）

更新日: 2026-02-23  
元Issue: #1200

## 1. 目的

ERP4を「人間向けUI中心」から「エージェント向けAPI/ツール中心」に再定義する。  
UIは、決裁・例外処理・監査確認のための導線に集中させる。

## 2. 確定した原則

1. API is the product  
   一次インターフェースを API/ツールに置く。
2. Safe-by-default  
   Read は広く、Write は狭く。高リスク操作は承認必須。
3. Policy + Approval + Evidence  
   書き込みは ActionPolicy・理由・証跡・承認に紐づける。
4. System of Record  
   実行履歴（何をしたか）と意思決定（なぜしたか）を再現可能に保持する。
5. Composability  
   ドメイン横断の集約API（360ビュー）を提供する。

## 3. 非ゴール

- GUI完全撤廃は行わない。
- 人間承認なしの高リスク不可逆実行を許可しない。
- LLM出力を真実データとして保存しない。

## 4. オープンクエスチョンの扱い（確定）

- 委任認証は専用Issueで設計確定する（#1208）。
- 委任認証の確定仕様: `docs/requirements/agent-delegated-auth.md`
- AgentRun/DecisionRequest は比較検討Issueで方式決定する（#1209）。
- AgentOpsログモデル決定: `docs/requirements/agentops-log-model.md`
- ActionPolicy必須化は高リスクAPIから段階導入する（#1206）。
- 360ビューの最小セットは Project 360 / Billing 360 とする（#1205）。
- MVP受け入れ条件は検証計画IssueでE2E化する（#1210）。

## 5. フェーズ別実装バックログ

### Phase 1: Read-only Agent

- 実装Issue: #1205
- 主要成果物:
  - OpenAPI整合性ルールとCI検証（`docs/requirements/openapi-contract-rules.md`）
  - Agent利用ガイド（`docs/manual/agent-read-api-guide.md`）
  - Project 360 / Billing 360
  - 監査メタ標準化（source=agent, requestId, principal, actor）

### Phase 2: Draft + Approval

- 実装Issue: #1206
- 主要成果物:
  - Draft生成API
  - 高リスクmutating APIへのActionPolicy必須化
  - 承認と証跡必須化
  - 標準エラーコード（`REASON_REQUIRED` / `ACTION_POLICY_DENIED` / `APPROVAL_REQUIRED`）

### Phase 3: External Integrations

- 実装Issue: #1207
- 主要成果物:
  - IntegrationSetting/Run運用強化
  - 代表コネクタPoC
  - 外部入力の信頼境界対策

## 6. 受け入れ条件（MVP）

検証Issue: #1210

- UI非依存で Project 360 を取得し説明可能である。
- 請求ドラフト生成→承認→送信を理由・証跡付きで追跡可能である。
- エージェント実行を監査から再現可能である（権限主体・根拠・実行API）。
- 検証計画: `docs/quality/agent-first-mvp-test-plan.md`

## 7. 実施順序（推奨）

1. #1208（委任認証）
2. #1205（Phase 1）
3. #1209（AgentOpsログ方式決定）
4. #1206（Phase 2）
5. #1210（MVP検証）
6. #1207（Phase 3）

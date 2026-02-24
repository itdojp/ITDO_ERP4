# Phase 2: 高リスクAPIカタログと ActionPolicy テンプレート

更新日: 2026-02-23  
関連Issue: #1206

## 1. 目的

Phase 2（Draft + Approval）で「どの mutating API を優先してガード対象にするか」を固定し、  
`requireReason` / `guards` / `stateConstraints` の適用テンプレートを共通化する。

## 2. Draft生成APIの初期対象（v1）

Phase 2 で先行する Draft は以下を対象とする。

1. 請求送信ドラフト（invoice send draft）
   - 宛先・件名・本文・添付・送信理由の下書きを生成
2. 承認依頼ドラフト（approval request draft）
   - 承認依頼時の理由文・証跡要約・差分サマリを生成
3. 定期通知ドラフト（notification/report draft）
   - レポート配信文面・送付対象の下書きを生成

注記:

- Draft は「下書き」扱いであり、実行（送信/確定）は必ず別APIで承認ガードを通す。
- 生成物そのものは Evidence として保持可能だが、真実データ（SoR）は既存業務テーブルを正とする。

### Draft API v1（実装）

- `POST /drafts`
  - 目的: 下書き作成
  - kind: `invoice_send` / `approval_request` / `notification_report`
- `POST /drafts/regenerate`
  - 目的: 下書き再生成
  - 旧下書き（`previous`）を受け取り、差分を返す
- `POST /drafts/diff`
  - 目的: 下書き同士の差分比較

注記:

- v1 は「生成/再生成/差分比較」に限定し、実行（送信/確定）は既存の高リスクAPI経路で承認ガードを適用する。

## 3. 高リスクmutating APIカタログ（Phase 2 対象）

詳細パスは各 route 実装を正とする（`packages/backend/src/routes/*.ts`）。

| ドメイン           | 代表操作（高リスク）                            | 優先テンプレート | 現状                                        |
| ------------------ | ----------------------------------------------- | ---------------- | ------------------------------------------- |
| 請求/見積/発注送信 | submit / approve / send / retry-send            | T1               | ActionPolicy 適用済み（段階導入）           |
| 経費               | submit / qa-checklist / mark-paid / unmark-paid | T1 / T2          | ActionPolicy 適用済み（段階導入）           |
| 工数/休暇          | submit / approve / reject                       | T2               | ActionPolicy 適用済み（段階導入）           |
| 仕入見積/仕入請求  | submit / approve / reject / link変更            | T1 / T2          | ActionPolicy 適用済み（段階導入）           |
| 承認ルール設定     | create / patch / simulate                       | T3               | ActionPolicy 適用済み（段階導入）           |
| 外部連携実行       | integration run / retry                         | T1               | Integration 設計に合わせて継続拡張（#1207） |

## 4. ActionPolicy テンプレート

注記:

- 以下の `guards` 名はテンプレート上の概念名を含む。
- 現行実装で利用中の guard type は `approval_open` / `project_closed` / `period_lock` / `editable_days` / `chat_ack_completed`。
- ステータス・ロール・スコープの判定は、現時点では `stateConstraints` や route 側の `requireRole`、subjects matching で表現する。

### T1: Approval-gated irreversible

- 目的: 送信・支払確定・外部連携実行など不可逆寄りの操作
- `requireReason`: 必須
- `guards`:
  - `approval_open`（有効な承認インスタンスが存在）
  - ステータスに基づくガードの例（対象状態が実行可能かを確認。現状は `stateConstraints` で表現）
  - ロールに基づくガードの例（admin/mgmt など。現状は route 側の `requireRole` で表現）
- `stateConstraints`:
  - 終端状態（paid/sent/cancelled 等）では拒否
  - 例外上書き時は管理ロール + 理由必須 + 監査ログ必須

### T2: Approval-gated reversible

- 目的: 差戻し・再申請・一部更新など可逆操作
- `requireReason`: 推奨（監査対象）
- `guards`:
  - `approval_open`（承認が必要な操作）
  - 承認不要な操作は approval 系 guard を付与しない
  - 状態遷移の可否は専用 guard ではなく `stateConstraints`（`statusIn` / `statusNotIn`）で表現
- `stateConstraints`:
  - 遷移前後の整合（例: `approved -> draft` は取消理由必須）

### T3: Configuration change

- 目的: 承認ルール/通知ルール/権限設定の変更
- `requireReason`: 必須
- `guards`:
  - ロールに基づくチェック（admin/mgmt。現状は route 側の `requireRole` で表現）
  - 適用範囲一致チェック（例: subjects matching による scope 検証）
- `stateConstraints`:
  - 有効期間・重複定義・段階整合（step order / quorum）を検証

## 5. 標準エラーコード運用

| code                   | 意味                | 代表対処                   |
| ---------------------- | ------------------- | -------------------------- |
| `REASON_REQUIRED`      | 理由入力不足        | 理由を補完して再実行       |
| `ACTION_POLICY_DENIED` | Policy/guard 不一致 | 権限・状態・承認条件を修正 |
| `APPROVAL_REQUIRED`    | 承認未了/承認必須   | 承認フローを完了して再実行 |

注記:

- `approval_open` 系 guard 失敗は `APPROVAL_REQUIRED` に正規化する。
- それ以外の policy deny は `ACTION_POLICY_DENIED` に統一する。

## 6. Approval + Evidence 必須化（段階導入）

送信系（`estimate:send` / `invoice:send` / `purchase_order:send`）は、  
`APPROVAL_EVIDENCE_REQUIRED_ACTIONS`（`flowType:actionKey` 形式）で段階的に有効化する。

- `APPROVAL_REQUIRED`: 対象の approved な ApprovalInstance が存在しない
- `EVIDENCE_REQUIRED`: approved な ApprovalInstance はあるが EvidenceSnapshot が存在しない

初期導入は feature flag で制御し、既存運用を壊さずに段階展開する。

## 7. 実装時チェックリスト（Phase 2）

- 対象APIの pre-action で ActionPolicy を評価している
- 高リスクAPIは `ACTION_POLICY_REQUIRED_ACTIONS`（`flowType:actionKey` 形式）で段階的に「policy未定義時deny」へ切り替え可能
- 送信系は `APPROVAL_EVIDENCE_REQUIRED_ACTIONS` で「承認＋証跡」の必須化を段階導入できる
- deny 時に標準エラーコードを返している
- 成功時に reason/evidence/approval 情報を監査ログへ残している
- E2E で「ドラフト生成 -> 承認 -> 実行」の監査再現を検証している

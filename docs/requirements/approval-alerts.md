# 承認フローとアラート設定（ドラフト）

目的: 見積/請求/経費/休暇/工数の承認ステートと、予算超過/残業/承認遅延アラートの設定項目を明確にする。小額/定期案件のスキップ条件を管理画面で設定可能にする。

## 承認フロー（ステートと遷移）

### 見積 / 請求
- ステート: `draft` → `pending_qa`(管理部) → `pending_exec`(経営) → `approved` → `sent`(請求のみ) → `paid` / `rejected` / `cancelled`
- 小額/定期スキップ: approval_rule 条件で `pending_exec` をバイパスし `approved` へ。条件は金額上限・定期フラグ等を管理画面で設定。
- 差戻し: どのステップからも `returned` → 修正後 `pending_*` へ再申請。

### 経費
- ステート: `draft` → `pending_qa`(管理部 or 経理) → `pending_exec`(金額閾値超の場合) → `approved` / `rejected`。
- 共通経費は is_shared=true で期別疑似案件に紐付け。

### 休暇
- ステート: `draft` → `pending_manager` → `approved` / `rejected`。
- タイムシートと重複する場合はバリデーションで警告/ブロック。

### タイムシート
- ステート: デフォルトは承認なしで記録する（`submitted` 相当で完了）。修正時のみ承認フローを走らせる。
- 修正承認: `submitted` → `pending_review`(管理部グループ設定) → `approved` / `rejected`。
- 追加段（PM承認など）が必要な場合に備え、承認ルールで段数を拡張できるようにする。

### 共通要素
- approval_rules: `flow_type`, `conditions`(min/max, recurring flag, project tags), `steps`(group/user, allow_skip)。
- approval_instances: 申請ごとにステップを生成し、状態・担当・期限を保持。監査ログに遷移を記録。
- 閲覧範囲: admin/mgmt/exec + 申請者本人 + プロジェクトメンバー。

### conditions / steps のJSON例
- conditions: `amountMin`/`amountMax`/`skipUnder`/`execThreshold`/`isRecurring`/`projectType`/`customerId`/`orgUnitId`/`flowFlags`。
- flowFlags はフロー横断ルール向けのフラグ（未設定なら flow_type のみで適用）。
- steps は `stepOrder` 明示で順序固定、`parallelKey` が同じものは並列承認（同一 stepOrder 扱い）。
- projectType/customerId/orgUnitId は projectId から参照して評価する（payloadに無い場合は補完）。

```json
{
  "conditions": {
    "amountMin": 0,
    "amountMax": 1000000,
    "skipUnder": 30000,
    "execThreshold": 300000,
    "isRecurring": false,
    "projectType": "maintenance",
    "customerId": "customer-uuid",
    "orgUnitId": "org-uuid",
    "flowFlags": { "estimate": true, "invoice": true, "expense": false, "time": false, "leave": false, "po": true }
  },
  "steps": [
    { "stepOrder": 1, "approverGroupId": "mgmt" },
    { "stepOrder": 2, "approverGroupId": "exec" }
  ]
}
```

```json
{
  "steps": [
    { "parallelKey": "doublecheck", "approverGroupId": "mgmt" },
    { "parallelKey": "doublecheck", "approverUserId": "user-uuid" },
    { "stepOrder": 2, "approverGroupId": "exec" }
  ]
}
```
## アラート設定
- 対象: `budget_overrun`, `overtime`, `approval_delay`, `delivery_due`。
- 設定項目: `threshold`(金額/率/時間), `period`(day/week/month), `scope`(全体/プロジェクト), `recipients`(emails/roles/users), `channels`(email, dashboard; 将来: slack/webhook)。
- 発火例: 予算消化率 > X%、残業時間 > Yh/週、承認待ちが Z 時間超、納期超過のマイルストーンに請求が紐付いていない。
- 通知: 初期はメール+ダッシュボード。履歴を `alerts` テーブルに保存し、確認/クローズ操作を持たせる。

### 初期閾値（管理画面で変更可能）
- 予算超過: 消化率 110%（+10%）。
- 残業: 1h/日 または 5h/週。
- 承認遅延: 24h 超。
- 納期超過未請求: 1件以上（threshold=0 で発火）。

## 設定UIの粒度（初版）
- 承認ルール: フロー別に「金額閾値」「定期案件フラグ」「ステップ順序」「ダブルチェック(同一グループ内別担当)」「スキップ許可」を設定。
- アラート: 閾値・期間・通知先・チャネルを設定。無効化/有効化スイッチを持つ。

### UI項目の例（初期値案込み）
- 見積/請求ルール: `金額閾値`(例 300,000 JPY)、`定期案件フラグ`(on/off)、`経営承認スキップ`(bool)、`ダブルチェック`(bool)、`承認期限`(例 24h; 将来エスカレーション)、`承認グループ`(管理部, 経営)。
- 経費ルール: `金額閾値`(例 50,000 JPY)、`共通経費のみ経営承認`(bool)、`領収書必須`(bool)。
- タイムシート修正ルール: `承認要否`(修正時のみデフォルト true)、`承認グループ`(管理部)。
- 休暇ルール: `承認者`(上長グループ)、`期間上限`(日数)、`重複検知`(タイムシートと突き合わせ)。
- アラート設定: `予算超過閾値`(110%)、`残業閾値`(1h/日 または 5h/週)、`承認遅延閾値`(24h)、`納期超過未請求`(1件以上)、`通知先`(メール/ダッシュボード/ロール指定)。

## 監査
- 申請の状態遷移ログ: from/to, user, timestamp, reason。
- ルール変更ログ: 変更者、変更箇所、旧値/新値。
- アラート発火ログ: 条件、対象、送信結果。
- (追記) 承認ステップ単位の監査: approval_steps に acted_by/acted_at を残し、変更理由(reason)をパラメータで受けられるようにする。申請単位の change_log テーブルを用意し、from_state/to_state/reason/user/timestamp を保存。

## 今後の詰めポイント
- 請求書の `sent` → `paid` 入力の権限/責務（経理ロール前提）。
- 承認期限と自動エスカレーション（後続スコープ）。
- タイムシート承認の例外フロー（PM不在など）の扱い。

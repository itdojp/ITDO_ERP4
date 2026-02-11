# 合意形成（ack required）と業務ワークフローの連携設計（案）

Refs: #783, #675, #717

## 目的

- 業務アクション（submit/approve/差戻し等）と合意形成（ack required）を参照・統制できるようにする
- 段階導入で、手戻りを抑えつつ最小機能から拡張可能にする

## 前提

- ack required は `ChatAckRequest` / `ChatAck` により実装済み
- WorkflowDefinition/ActionPolicy は後続で汎用化予定（#717）
- まずは「参照リンク」を最小機能として提供する

## 段階導入

### Phase 1: 参照リンク（最小）

- Workflow/Approval のUIや監査ログから、関連する chat message（ack required）へ遷移できる
- 連携は参照のみ（操作可否のガードにはしない）

#### 推奨データモデル（案B: 中間テーブル）

- `ChatAckLink`（仮）
  - `id`
  - `ackRequestId`（FK: ChatAckRequest）
  - `messageId`（FK: ChatMessage）
  - `targetTable` / `targetId`（業務エンティティの参照）
  - `flowType` / `actionKey`（任意。Workflow連携用）
  - `createdBy` / `createdAt` / `updatedAt`
- 長所: ChatAckRequest を直接変更せずに連携を段階導入できる
- 短所: 追加クエリが必要

#### 参照API（案）

- `GET /chat-ack-links?targetTable=...&targetId=...`
- `GET /chat-ack-links?ackRequestId=...`
- `GET /chat-ack-requests/:id` は `ChatAckRequest` 本体に加えて `ChatAckLink` を LEFT JOIN し、存在する場合はリンク情報を返す
- `POST /chat-ack-links`（作成） / `DELETE /chat-ack-links/:id`（解除）
  - 作成時は `ackRequestId` or `messageId` を指定
  - 権限は admin/mgmt を想定（運用次第で拡張）

#### UI/UX（案）

- 承認詳細/業務詳細に「関連する合意形成」セクション
- `開く` で chat message deep link を開く

---

### Phase 2: Guard（ActionPolicy 連携）

- ActionPolicy Guard として「ack required 完了」を評価し、未完了の場合はアクションを拒否

#### Guard 仕様（案）

- `guards: [{ type: "chat_ack_completed" }]`
- `targetTable=approval_instances` / `targetId=approvalInstanceId` から `ChatAckLink` を解決

#### 評価ルール

- requiredUserIds 全員の ack 完了で OK
- `canceledAt` / `expired`（`dueAt` < now かつ未完了）は未完了扱い
- link 未設定は失敗（reason: missing_link）
- admin/mgmt は理由必須で例外許可（監査ログに guardFailures を記録）

---

### Phase 3: 運用拡張

- actionKey ごとのテンプレ（合意形成の自動作成）
- エスカレーション/リマインドの強化
- 監査ログの可視化（履歴UI）

#### 実装メモ（暫定）
- `chat-ack-templates` でテンプレを管理（flowType/actionKey/本文/対象/期限/エスカレーション）
- approval_instances の `approve/reject` を起点にテンプレが自動適用される
- 期限経過後はテンプレ設定に応じてエスカレーション通知を追加送信する

## chat ack template 運用標準（#922）

### 命名規約

- `flowType`: 既存 `FlowType` enum を使用（例: `invoice`, `purchase_order`, `vendor_invoice`）
- `actionKey`: `domain.action_ack.vN` 形式（例: `invoice.submit_ack.v1`）
  - 互換性を壊さない修正（文面微調整、対象追加）は同一 `actionKey` で更新
  - ガード条件や対象範囲を変更する破壊的変更は `vN` を繰り上げて新規作成
- `messageBody`: 1行目を「目的」、2行目以降を「確認観点」で統一し、期限/エスカレーション条件を明示する

### テンプレ台帳（owner/review周期）

- 台帳は `docs/requirements/chat-ack-template-ledger.csv` を使用する
- 必須カラム:
  - `ownerRole`, `ownerUserId`: 運用責任者
  - `reviewCycleDays`: 棚卸し周期（日）
  - `lastReviewedAt`, `nextReviewAt`: 最終レビュー日と次回レビュー日
  - `status`: `active` / `deprecated` / `retired`
  - `replacedBy`: 置換先テンプレID（該当時のみ）
- 棚卸し運用:
  - 月次で `nextReviewAt <= today` のテンプレをレビュー対象として抽出
  - 重複（同一 `flowType` + 同一 `actionKey` で複数 `active`）を禁止

### 非推奨/廃止フロー

1. 新仕様が必要な場合は後継テンプレを新規作成し、承認ルール/業務導線を後継へ切替
2. 旧テンプレを `deprecated` として台帳更新（`replacedBy` を設定）
3. 移行完了後、旧テンプレの `isEnabled=false` に更新し `retired` へ変更
4. 監査ログ（`chat_ack_template_created/updated`）と台帳更新日時を突合し、履歴の欠落を確認

## 決定事項

- 連携キー: 中間テーブル（案B: ChatAckLink）を採用
- 連携の方向性: Phase 1 は「業務側で参照リンクを管理」する（管理者がリンク作成/解除）
- 権限/監査: admin/mgmt のみ。監査ログは必須（理由は Phase 1 では任意）
- Guard 評価ルール: canceled/expired は未完了として扱う（Phase 2）
- 対象の allowlist: Phase 1 は `approval_instances` のみを許可し、対象の存在確認を必須にする
- 参照リンク UI: Phase 1 は「業務詳細 + 監査ログ」に設置し、チャット側は参照のみ
- Phase 2 Guard: requiredUserIds 全員の ack 完了を条件とし、admin/mgmt の例外は理由必須 + 監査ログ

## 設計論点（未確定）

- なし（Phase 1 の未決事項は解消済み）

## 受入条件（DoD）

- Phase 1 の参照リンクが実運用で使える
- Phase 2 に無理なく拡張できる設計である
- 監査ログに連携作成/解除が残る

## 関連

- `docs/requirements/approval-ack-messages.md`
- `docs/requirements/workflow-generic.md`
- `docs/requirements/action-policy.md`（存在する場合）
- `docs/requirements/chat-ack-template-ledger.csv`

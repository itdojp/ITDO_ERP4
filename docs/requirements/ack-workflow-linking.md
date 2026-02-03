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

#### UI/UX（案）
- 承認詳細/業務詳細に「関連する合意形成」セクション
- `開く` で chat message deep link を開く

---

### Phase 2: Guard（ActionPolicy 連携）
- ActionPolicy Guard として「ack required 完了」を評価し、未完了の場合はアクションを拒否

#### Guard 仕様（案）
- `guards: [{ type: "chat_ack_completed", ackRequestId: "..." }]`
- または `targetTable/targetId` から関連 ack を解決

#### 評価ルール（案）
- `ChatAckRequest.canceledAt` / `expired` 状態（`dueAt` と現在時刻で算出）の扱いはポリシーで制御
  - 例: `requireCompleted` or `allowCanceled`

---

### Phase 3: 運用拡張
- actionKey ごとのテンプレ（合意形成の自動作成）
- エスカレーション/リマインドの強化
- 監査ログの可視化（履歴UI）

## 設計論点（未確定）
- 連携キー: ChatAckRequest 直付け（案A） vs 中間テーブル（案B）
- 連携の方向性: 業務側から合意形成を作る/参照する、チャット側から業務参照を作る
- 権限/監査: 連携作成/解除の権限、理由必須、監査ログの粒度
- 期限/状態遷移: canceled/expired（`dueAt` 算出）を Guard 評価に含めるか

## 受入条件（DoD）
- Phase 1 の参照リンクが実運用で使える
- Phase 2 に無理なく拡張できる設計である
- 監査ログに連携作成/解除が残る

## 関連
- `docs/requirements/approval-ack-messages.md`
- `docs/requirements/workflow-generic.md`
- `docs/requirements/action-policy.md`（存在する場合）

# 仕様・実装整合レビュー（2026-02-10）

対象: #669（通知体系）, #768/#769（PO↔VI配賦）, #783/#832（ack required×Workflow）, #893（design-system適用）

## 1. 結論（要約）

- 対象範囲の「設計上の未決事項」は現時点でありません（運用ルールを含め決定済み）。
- 未実装は「Phase 2 以降の拡張」または「運用・証跡の仕上げ」に集約されています。
- 直近の優先対象は、`PO↔VI厳密整合（Phase 2）`、`通知抑制ルール統一`、`design-system適用後の回帰証跡` です。

## 2. 判定基準

- 仕様一次ソース:
  - `docs/requirements/notifications.md`
  - `docs/requirements/vendor-doc-linking.md`
  - `docs/requirements/ack-workflow-linking.md`
  - `docs/requirements/non-chat-spec-index.md`
- 実装確認:
  - Backend: `packages/backend/src/routes/*.ts`, `packages/backend/src/services/*.ts`
  - Frontend: `packages/frontend/src/sections/*.tsx`, `packages/frontend/src/main.tsx`
- 関連Issue状態:
  - close: #669, #768, #769, #783, #832, #833, #834, #893
  - open: #886, #914

## 3. 領域別の整合結果

### 3.1 通知体系（#669 / #833）

実装済み:
- AppNotification（chat/approval/leave/project/expense/daily-report）の主要イベントは実装済み。
- メール通知は `NOTIFICATION_EMAIL_KINDS` とユーザ設定（`realtime`/`digest`/間隔）で運用可能。
- 通知抑制（全体/ルーム単位ミュート、全投稿/メンション切替）は実装済み。
- AppNotification起点のPush自動配信（allowlist制御 + 失効購読の自動無効化）は実装済み。

未実装・後続:
- Push専用の再送キュー/バックオフ制御は未実装。
- Push対象の全通知種別展開は後続（現状は allowlist による段階導入）。
- AppNotification起点のSlack/Webhook連携は未実装（現状はアラート系中心）。
- 一部通知種別の抑制ルール統一は後続（現状は chat 系が中心）。

判定:
- 仕様どおり段階導入の状態。MVPとしては整合。運用拡張は未完。

### 3.2 PO↔VIリンク/配賦（#768 / #769 / #834）

実装済み:
- VI の POリンク変更/解除（status/権限制約 + 監査）を実装済み。
- 配賦明細（案件/税率別、任意 `purchaseOrderLineId`）の取得/更新/クリアを実装済み。
- UIは「PDF表示 + 必要時のみ配賦明細入力」に準拠。
- 多対1（複数PO→1VI）は採用せず、同一請求書の分割登録運用（合計整合必須）で確定済み。

未実装・後続:
- PO明細↔請求書明細の厳密整合（数量/単価/部分請求）は未実装（Phase 2）。
- 配賦データの原価集計への本格反映は後続検討。

判定:
- 現行仕様（MVP/Phase1）には整合。厳密会計連携は別フェーズの計画実装が必要。

### 3.3 ack required × Workflow（#783 / #832）

実装済み:
- `chat_ack_links` による業務エンティティ（`approval_instances`）との参照連携を実装済み。
- `chat_ack_completed` guard と admin/mgmt override（理由 + 監査）を実装済み。
- テンプレ連動（flowType/actionKey）による自動ack作成、リマインド/エスカレーションを実装済み。

未実装・後続:
- guard連携対象は現状 `approval_instances` が中心。対象拡張は要件化が必要。
- 運用面ではテンプレ過多時の棚卸し/標準化ルール（命名・廃止手順）を明文化余地あり。

判定:
- #783で定義した Phase1-3 は実装済み。残件は横展開と運用標準化。

### 3.4 design-system適用（#893）

実装済み:
- `@itdo/design-system@1.0.3` 導入と `styles.css` 読み込みは実装済み。
- 主要画面（Invoices/VendorDocuments/AuditLogs/PeriodLocks/AdminJobs）は適用済み。

未実装・後続:
- モバイル幅の回帰確認を明示した証跡が不足（docs上で個別確認結果が追いにくい）。
- 運用マニュアル/テスト証跡の更新判定は実施済みだが、画面単位の差分記録は増強余地あり。

判定:
- 実装は到達。品質保証（証跡の粒度）を補強すると保守性が上がる状態。

## 4. 現時点の未実装一覧（優先度）

優先度A:
- PO↔VI厳密整合のPhase 2要件化（数量/単価/部分請求）
- Push専用の再送キュー/バックオフ制御

優先度B:
- AppNotification種別の抑制ルール統一（chat以外も同様に適用）
- Push対象通知種別の拡張ルール整備（allowlist運用から段階拡張）
- ack template運用標準（命名規約・棚卸し・廃止フロー）の明文化

優先度C:
- design-system適用画面のモバイル回帰証跡テンプレ化
- UIマニュアルの画面差分記録フォーマット統一

## 5. 参考（今回スコープ外だが open の関連Issue）

- #886: チャット添付AVスキャンの本番有効化方針
- #914: eslint@10系 Dependabot PR再開条件の管理

## 6. 更新ルール

- 本レビューは「仕様決定の有無」と「実装到達」を分けて記載する。
- 仕様変更を伴う場合は必ず各一次ソース（`notifications.md`/`vendor-doc-linking.md`/`ack-workflow-linking.md`）を先に更新する。

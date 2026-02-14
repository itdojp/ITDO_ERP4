# Workflowエビデンス（Issue #953）実装状況

最終更新: 2026-02-14

## 判定サマリ

- Issue #953 の Phase 1 / Phase 2 は実装済み
- Phase 3 は「権限検証」「参照失効の可視化/差し替え導線」を実装済み
- Phase 3 の「Evidence Pack（スナップショット/監査出力）」は未実装（Issue #953上も「必要なら」扱い）

## チェックリスト対応

### Phase 1: 申請画面内での選択

- [x] EvidencePicker（`ChatEvidencePicker`）で `chat_message` を検索して追加できる
- [x] `AnnotationsCard` に `エビデンス追加` 導線を実装
- [x] 候補に案件/ルーム/時刻/投稿者/抜粋を表示（`/ref-candidates` の label/meta を利用）
- [x] 利用者向け運用ドキュメントを更新

### Phase 2: 承認時の確認性

- [x] 承認画面に `エビデンス（注釈）` 表示を実装
- [x] 承認画面内で `chat_message` 抜粋プレビューを確認可能
- [x] guard失敗（`chat_ack_completed` 等）の説明を画面メッセージで表示

### Phase 3: 統制・監査

- [x] `chat_message` 追加時の参照可否チェック（権限不足/不存在の事前検知）
- [x] `参照状態を確認` による失効可視化（参照可能/権限不足/発言なし/確認失敗）
- [ ] Evidence Pack（スナップショット保持・監査向け出力）

## テスト対応

- 既存: `packages/frontend/e2e/frontend-smoke.spec.ts` のチャット/ack required シナリオ
- 追加: `packages/frontend/e2e/frontend-smoke.spec.ts` の `frontend smoke workflow evidence chat references @extended`
  - 注釈の `エビデンス追加`（検索/追加/メモ挿入）
  - `参照状態を確認` の表示
  - 承認画面 `エビデンス（注釈）` の件数・メモ・外部URL・チャット抜粋確認

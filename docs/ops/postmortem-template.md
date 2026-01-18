# Postmortem テンプレート

## 概要
- 障害ID/Issue: #
- 発生日: YYYY-MM-DD
- SEV: SEV1 / SEV2 / SEV3
- 概要（1〜3行）:

## 影響（Impact）
- 影響期間: YYYY-MM-DD HH:MM 〜 HH:MM（JST）
- 影響範囲（ユーザ/機能/データ）:
- 事業影響（可能なら定量）:

## 時系列（Timeline）
時刻はJSTで統一する。
- HH:MM 検知
- HH:MM 一次対応開始
- HH:MM 暫定対処（例: Feature Flag OFF / ロールバック）
- HH:MM 復旧
- HH:MM 監視安定化確認

## 原因（Root Cause）
- 直接原因:
- 根本原因（プロセス/設計/テスト/運用の観点）:
- 再発可能性:

## 検知（Detection）
- どのシグナルで検知したか（アラート/ユーザ申告/ログ等）:
- 検知までの時間（MTTD）:
- 検知の改善点:

## 対応（Response）
- 実施した対応:
- 有効だった対応:
- うまくいかなかった対応:
- 復旧までの時間（MTTR）:

## 再発防止（Action Items）
必ず Issue 化し、担当者/期限を設定する。

| 優先度 | 対応 | オーナー | 期限 | Issue |
|---|---|---|---|---|
| P0 |  |  |  | # |
| P1 |  |  |  | # |
| P2 |  |  |  | # |

## 学び（What went well / What went wrong）
- 良かった点:
- 改善点:

## 参考（Evidence）
- request-id（代表例）:
- 直近デプロイSHA/tag:
- 関連ログ/ダッシュボード/スクリーンショット:


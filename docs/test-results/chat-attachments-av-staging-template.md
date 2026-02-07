# チャット添付AV（Staging）検証テンプレート

## 目的
- `Issue #886` の有効化判定に必要なステージング検証結果を、同じ観点で記録する。

## 実行情報
- 実行日:
- 実行者:
- 環境:
- backend revision:
- clamd image / tag:
- 実行コマンド: `bash scripts/smoke-chat-attachments-av.sh`

## 前提
- `CHAT_ATTACHMENT_AV_PROVIDER=clamav`
- `CLAMAV_HOST` / `CLAMAV_PORT` 設定済み
- clamd 起動済み（TCP 到達可能）
- 補助: `ENV_NAME=staging bash scripts/record-chat-attachments-av-smoke.sh` で記録下書きを生成可能

## 結果サマリ
- clean 添付（clamd 稼働中）:
- EICAR 添付（clamd 稼働中）:
- clean 添付（clamd 停止後）:
- 結論:

## 実行ログ（要点）
```text
[4/7] start backend (PORT=...)
...
```

## 監視観点の確認
- clamd 死活監視が発火すること:
- `chat_attachment_scan_failed` の記録確認:
- 添付 API 503 比率の確認:
- スキャン遅延（タイムアウト）傾向:

## 判定
- 本番有効化可否:
- 懸念/残課題:
- 次アクション:

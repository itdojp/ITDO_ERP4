# チャット添付AV（ClamAV/clamd）再検証（r2）

## 目的
- Issue #886 の「有効化する場合の検証」項目に対して、現行スモークを再実行し挙動を確認する。

## 実行情報
- 実行日: 2026-02-06
- 実行コマンド: `bash scripts/smoke-chat-attachments-av.sh`
- 前提:
  - Podman が利用可能
  - backend build 実行済み（スクリプト内で不足時に実行）
  - `CHAT_ATTACHMENT_AV_PROVIDER=clamav`

## 結果サマリ
- clean 添付（clamd 稼働中）: `200`
- EICAR 添付（clamd 稼働中）: `422` / `VIRUS_DETECTED`
- clean 添付（clamd 停止後）: `503`
- 結論: 期待通り（`FOUND` は拒否、スキャナ停止時は fail closed）

## 実行ログ（要点）
```text
[4/7] start backend (PORT=3003)
backend ready
[5/7] create private group room
room_id=cd3fb9f6-ade4-46a7-a549-19e5864a7027
[6/7] post message
message_id=c03808e3-2f0e-4f52-a37b-11d05f1d08fb
[7/7] attachment scan cases
upload clean (clamd up): status=200
upload eicar (clamd up): status=422
error_code=VIRUS_DETECTED
stop clamd and expect 503
upload clean (clamd down): status=503
smoke ok
```

## 補足
- 再検証時に `scripts/smoke-chat-attachments-av.sh` の `DATABASE_URL` が `npm run prisma:generate` へ伝播しない不具合を確認したため、`DATABASE_URL` を export する修正を適用した。

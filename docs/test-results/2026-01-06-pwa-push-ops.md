# PWA/Push 運用検証（2026-01-06）

## 目的
- オフライン送信キューの挙動を自動テストで確認する。

## 環境
- E2E: `scripts/e2e-frontend.sh`
- 実行: `E2E_GREP="offline queue" E2E_CAPTURE=1 scripts/e2e-frontend.sh`

## 実施内容と結果
### オフライン送信キュー
- オフライン状態で日報を送信 → 「オフラインのため送信待ちに保存しました」を確認
- 送信待ち件数が 1 以上になることを確認
- オンライン復帰で「送信待ちを処理しました」を確認
- エビデンス: `docs/test-results/2026-01-06-frontend-e2e/14-offline-daily-queue.png`
- エビデンス: `docs/test-results/2026-01-06-frontend-e2e/15-offline-queue-retry.png`

## 未実施
- 競合/重複の実検証
- Push 同意/解除/再登録（VAPID鍵が必要）
- Service Worker 更新/キャッシュ破棄の実検証

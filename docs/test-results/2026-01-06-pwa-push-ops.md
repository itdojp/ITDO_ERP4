# PWA/Push 運用検証（2026-01-06）

## 目的
- オフライン送信キューの挙動を自動テストで確認する。

## 環境
- E2E: `scripts/e2e-frontend.sh`
- 実行: `E2E_GREP="@pwa" VITE_ENABLE_SW=true E2E_CAPTURE=1 scripts/e2e-frontend.sh`
- Push 用 VAPID 公開鍵: ローカルで生成し `VITE_PUSH_PUBLIC_KEY` に設定（鍵はリポジトリ未保存）

## 実施内容と結果
### オフライン送信キュー
- オフライン状態で日報を送信 → 「オフラインのため送信待ちに保存しました」を確認
- 送信待ち件数が 1 以上になることを確認
- オンライン復帰で「送信待ちを処理しました」を確認
- エビデンス: `docs/test-results/2026-01-06-frontend-e2e/14-offline-daily-queue.png`
- エビデンス: `docs/test-results/2026-01-06-frontend-e2e/15-offline-queue-retry.png`

### 競合/重複（オフライン重複送信）
- オフラインで同一条件の工数を 2 回追加 → キュー件数が 2 になることを確認
- オンライン復帰後に処理され、工数一覧に重複登録されることを確認
- 備考: 現状は重複排除なし。運用で重複入力に注意する
- エビデンス: `docs/test-results/2026-01-06-frontend-e2e/16-offline-duplicate-time-entry.png`

### Push 同意/解除/再登録
- 配信条件 + 同意チェック → 購読登録が完了することを確認
- テスト通知を送信し、通知イベントが発火することを確認
- 購読解除後に「未登録」表示となることを確認
- 再登録で「登録済み」に戻ることを確認
- 備考: headless 検証のため PushManager.subscribe をモック（実機/実ブラウザでの最終確認は別途）
- エビデンス: `docs/test-results/2026-01-06-frontend-e2e/17-push-registered.png`
- エビデンス: `docs/test-results/2026-01-06-frontend-e2e/18-push-unsubscribed.png`
- エビデンス: `docs/test-results/2026-01-06-frontend-e2e/19-push-resubscribed.png`

### Service Worker 更新/キャッシュ破棄
- Service Worker 登録後に `erp4-pwa-v1` キャッシュが作成されることを確認
- キャッシュ削除後に `erp4-pwa-v1` が消えることを確認
- リロードで `erp4-pwa-v1` が再作成されることを確認
- エビデンス: `docs/test-results/2026-01-06-frontend-e2e/20-sw-cache-refresh.png`

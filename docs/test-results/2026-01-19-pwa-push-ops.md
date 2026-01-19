# PWA/Push 運用検証（2026-01-19）

## 目的
- Push 同意/解除/再登録の導線を自動テストで確認し、証跡（画面キャプチャ）を取得する

## 実行コマンド（例）
Push 用の VAPID 公開鍵はローカルで生成し、`VITE_PUSH_PUBLIC_KEY` に設定します（鍵はリポジトリに保存しない）。

```bash
PUB=$(node -e "const webpush = require('./packages/backend/node_modules/web-push'); console.log(webpush.generateVAPIDKeys().publicKey);")

VITE_ENABLE_SW=true \
VITE_PUSH_PUBLIC_KEY="$PUB" \
E2E_CAPTURE=1 \
E2E_GREP="pwa push subscribe flow" \
E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-01-19-frontend-e2e-pwa-push" \
E2E_SKIP_PLAYWRIGHT_INSTALL=1 \
./scripts/e2e-frontend.sh
```

## 実施内容と結果
- Push通知（購読登録/解除/再登録）: 1 passed

## エビデンス
- `docs/test-results/2026-01-19-frontend-e2e-pwa-push/17-push-registered.png`
- `docs/test-results/2026-01-19-frontend-e2e-pwa-push/18-push-unsubscribed.png`
- `docs/test-results/2026-01-19-frontend-e2e-pwa-push/19-push-resubscribed.png`


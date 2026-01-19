# E2E（Playwright）と証跡（画面キャプチャ）取得手順

## 目的
- 操作を伴うUIテストを自動化し、証跡（画面キャプチャ）を再現可能にする

## 参照
- E2E 実行スクリプト: [scripts/e2e-frontend.sh](../../scripts/e2e-frontend.sh)
- 証跡保存先: [docs/test-results](../test-results/)
- UI マニュアル（スクショ参照）: [ui-manual-user](ui-manual-user.md) / [ui-manual-admin](ui-manual-admin.md)

## 実行モード
### core / extended / full
- `E2E_SCOPE=core`: PRの必須導線（短時間）
- `E2E_SCOPE=extended`: 追加導線（任意）
- `E2E_SCOPE=full`: 全体（main/schedule向け）

CI では `E2E_CAPTURE=0`（証跡なし）で実行します。

## ローカルでの実行（証跡あり）
```bash
# DBは既定で Podman を利用（E2E_DB_MODE=podman）
E2E_CAPTURE=1 E2E_SCOPE=core ./scripts/e2e-frontend.sh
```

保存先（既定）:
- `docs/test-results/<YYYY-MM-DD>-frontend-e2e/`

任意で保存先を固定する場合:
```bash
E2E_CAPTURE=1 E2E_SCOPE=core \
E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-01-19-frontend-e2e-r3" \
./scripts/e2e-frontend.sh
```

## 差分比較（最小）
- 画面キャプチャは Git の差分で追跡する（更新時は PR で履歴を残す）
- 重要導線（Dashboard/日報/工数/請求/承認/チャット）を優先して更新する

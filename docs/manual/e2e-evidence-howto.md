# E2E（Playwright）と証跡（画面キャプチャ）取得手順

## 目的
- 操作を伴うUIテストを自動化し、証跡（画面キャプチャ）を再現可能にする

## 参照
- E2E 実行スクリプト: [scripts/e2e-frontend.sh](../../scripts/e2e-frontend.sh)
- UI証跡（簡易手順）: [ui-evidence-quickstart](ui-evidence-quickstart.md)
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

簡易手順（UI証跡用）:
```bash
./scripts/e2e-ui-evidence.sh
```

Makefile を使う場合:
```bash
make ui-evidence
```

補足:
- Podman DB のポート（既定: 55433）が使用中、または Podman の既存コンテナにより予約されている場合、`E2E_PODMAN_HOST_PORT` 未指定なら空きポートへ自動フォールバックします。
- ポートを固定したい場合は `E2E_PODMAN_HOST_PORT=55435` のように明示指定します（競合時はエラーで停止）。

保存先（既定）:
- `docs/test-results/<YYYY-MM-DD>-frontend-e2e/`

任意で保存先を固定する場合:
```bash
E2E_CAPTURE=1 E2E_SCOPE=core \
E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-02-05-frontend-e2e-r1" \
./scripts/e2e-frontend.sh
```

## 失敗ケースだけ再実行（E2E_GREP）
例: vendor docs の smoke（extended）のみ再実行
```bash
E2E_GREP="vendor docs create" E2E_CAPTURE=0 ./scripts/e2e-frontend.sh
```

## DB を direct で使う（E2E_DB_MODE=direct）
`psql` が利用できるローカルDBがある場合:
```bash
E2E_DB_MODE=direct DATABASE_URL="postgresql://..." \
E2E_CAPTURE=0 E2E_SCOPE=core ./scripts/e2e-frontend.sh
```

## Playwright install をスキップ（任意）
Playwright のブラウザが既にインストール済みであれば:
```bash
E2E_SKIP_PLAYWRIGHT_INSTALL=1 E2E_CAPTURE=0 E2E_SCOPE=core ./scripts/e2e-frontend.sh
```

## 失敗時の診断（最小）
- 起動失敗やAPI例外は `tmp/e2e-backend.log` / `tmp/e2e-frontend.log` を確認
- 該当ケースだけ再実行する場合は `E2E_GREP` で対象を絞る
- 画面の証跡が必要な場合は `E2E_CAPTURE=1` で再実行し、`docs/test-results/` の画像を確認
- API側の切り分けは `scripts/smoke-backend.sh` を併用（任意）

## 差分比較（最小）
- 画面キャプチャは Git の差分で追跡する（更新時は PR で履歴を残す）
- 重要導線（Dashboard/日報/工数/請求/承認/チャット）を優先して更新する

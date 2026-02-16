# UI証跡（スクショ）取得: 簡易手順

## 目的
- UI マニュアルやレビューで参照する「画面キャプチャ（証跡）」を、1コマンドで再取得できるようにする

## 参照
- 詳細手順: [e2e-evidence-howto](e2e-evidence-howto.md)
- 証跡インデックス: [docs/test-results/README.md](../test-results/README.md)

## 実行（既定）
```bash
./scripts/e2e-ui-evidence.sh
```

Makefile を使う場合:
```bash
make ui-evidence
```

生成物:
- `docs/test-results/<YYYY-MM-DD>-frontend-e2e-rN/`（証跡ディレクトリ）
- `docs/test-results/<YYYY-MM-DD>-frontend-e2e-rN.md`（実行ログ）

## 代表的なオプション
同日に複数回実行する（run番号を固定）:
```bash
E2E_RUN=r2 ./scripts/e2e-ui-evidence.sh
```

対象テストを絞る（例: smokeのみ）:
```bash
E2E_GREP="frontend smoke" ./scripts/e2e-ui-evidence.sh
```

タイムアウトを伸ばす（環境が重い場合）:
```bash
E2E_ACTION_TIMEOUT_MS=30000 make ui-evidence
```

起動待機時間も調整する（バックエンド/フロントの立ち上がりが遅い場合）:
```bash
E2E_SERVICE_READY_TIMEOUT_SEC=120 E2E_SERVICE_READY_INTERVAL_SEC=2 make ui-evidence
```

## 注意
- 既存の証跡を上書きしない方針です（同名が存在する場合はエラーになります）
- 取得した証跡を UI マニュアルに反映する場合は、`docs/manual/ui-manual-*.md` の参照先（画像パス）も更新してください

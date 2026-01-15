# フロントE2E（full + UIエビデンス r2）

## 実行日時
- 2026-01-15

## 実行コマンド
```bash
E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-01-15-frontend-e2e-r2" \
E2E_CAPTURE=1 \
E2E_SCOPE=full \
E2E_SKIP_PLAYWRIGHT_INSTALL=1 \
./scripts/e2e-frontend.sh
```

## 実行条件（主要）
- DB: Podman（`E2E_DB_MODE=podman`、デフォルト）
- 証跡: 取得あり（`E2E_CAPTURE=1`）
- 外部LLM: stub（`CHAT_EXTERNAL_LLM_PROVIDER=stub`、デフォルト）
- 画面ベースURL: `http://localhost:5173`（デフォルト）

## 結果
- 31 passed / 1 skipped
- skip: `pwa push subscribe flow @pwa`（`VITE_PUSH_PUBLIC_KEY` 未設定のため）

## エビデンス格納先
- `docs/test-results/2026-01-15-frontend-e2e-r2/`

### 追加/更新キャプチャ（運用系）
- `25-admin-jobs.png`（運用ジョブ）
- `26-document-send-logs.png`（ドキュメント送信ログ）
- `27-pdf-files.png`（PDFファイル一覧）
- `28-access-reviews.png`（アクセス棚卸し）
- `29-audit-logs.png`（監査ログ）
- `30-period-locks.png`（期間締め）


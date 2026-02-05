# フロントE2E（UIエビデンス r1）

## 実行日時
- 2026-02-05

## 実行コマンド
```bash
E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-02-05-frontend-e2e-r1" \
E2E_CAPTURE=1 \
E2E_GREP="frontend smoke" \
./scripts/e2e-frontend.sh

E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-02-05-frontend-e2e-r1" \
E2E_CAPTURE=1 \
E2E_GREP="frontend offline queue" \
./scripts/e2e-frontend.sh

E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-02-05-frontend-e2e-r1" \
E2E_CAPTURE=1 \
E2E_GREP="pwa offline duplicate time entries" \
./scripts/e2e-frontend.sh

E2E_EVIDENCE_DIR="$PWD/docs/test-results/2026-02-05-frontend-e2e-r1" \
E2E_CAPTURE=1 \
E2E_GREP="pwa service worker cache refresh" \
./scripts/e2e-frontend.sh
```

## 実行条件（主要）
- DB: Podman（`E2E_DB_MODE=podman`、デフォルト）
- 証跡: 取得あり（`E2E_CAPTURE=1`）
- 外部LLM: stub（`CHAT_EXTERNAL_LLM_PROVIDER=stub`、デフォルト）
- 画面ベースURL: `http://localhost:5173`（デフォルト）

## 結果
- `frontend smoke`: 10 passed
- `frontend offline queue`: 1 passed
- `pwa offline duplicate time entries`: 1 passed
- `pwa service worker cache refresh`: 1 passed

## エビデンス格納先
- `docs/test-results/2026-02-05-frontend-e2e-r1/`


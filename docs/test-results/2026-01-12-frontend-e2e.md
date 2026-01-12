# フロントE2E（extended）

## 実行日時
- 2026-01-12

## 実行コマンド
```bash
E2E_CAPTURE=0 E2E_SCOPE=extended ./scripts/e2e-frontend.sh
```

## 実行条件（主要）
- DB: Podman（`E2E_DB_MODE=podman`、デフォルト）
- 証跡: 取得なし（`E2E_CAPTURE=0`）
- 外部LLM: stub（`CHAT_EXTERNAL_LLM_PROVIDER=stub`）

## 結果
- 10 passed

### 実行されたテスト（grep: `@extended`）
- `frontend offline queue @extended`
- `pwa offline duplicate time entries @pwa @extended`
- `pwa service worker cache refresh @pwa @extended`
- `frontend smoke vendor approvals @extended`
- `frontend smoke vendor docs create @extended`
- `frontend smoke reports masters settings @extended`
- `frontend smoke chat hr analytics @extended`
- `frontend smoke room chat (private_group/dm) @extended`
- `frontend smoke room chat external summary @extended`
- `frontend smoke external chat invited rooms @extended`

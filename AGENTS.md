# リポジトリ運用ガイド（Codex/開発者向け）

## 目的
- 変更前後の手順と最小限の品質チェックを統一する

## 前提
- Node.js / npm が利用可能であること
- DB は PoC 環境で Podman を利用（E2Eスクリプト既定）

## 最小コマンド（Makefile）
```bash
make lint
make format-check
make typecheck
make build
make test
make audit
make e2e
```

## 直接コマンド（Makefile未使用の場合）
### Lint / Format
```bash
npm run lint --prefix packages/backend
npm run format:check --prefix packages/backend
npm run lint --prefix packages/frontend
npm run format:check --prefix packages/frontend
```

### Typecheck / Build / Test
```bash
npm run typecheck --prefix packages/backend
npm run typecheck --prefix packages/frontend
npm run build --prefix packages/backend
npm run build --prefix packages/frontend
npm run test --prefix packages/backend
```

### Audit（npm audit）
```bash
npm audit --prefix packages/backend --audit-level=high
npm audit --prefix packages/frontend --audit-level=high
```

### E2E（Playwright）
```bash
E2E_SCOPE=core E2E_CAPTURE=0 ./scripts/e2e-frontend.sh
```

## PR作成前の最小チェック
- lint / format / typecheck / test を通す
- 依存更新がある場合、`make audit`（high/critical）を通す
- UI変更がある場合、`docs/manual/` と `docs/test-results/` の更新要否を確認する

## 作業規約（最小）
- 新規依存追加は「理由・影響・ロールバック」をPR本文に記載
- 仕様変更は `docs/requirements/` に反映する

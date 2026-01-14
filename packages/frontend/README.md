# ERP4 Frontend (PoC)

## 開発

```bash
cd packages/frontend
npm install
npm run dev
```

## itdo-design-system

このフロントエンドは `@itdojp/design-system` を利用します。

### GitHub Packages 認証（必要）

`@itdojp` scope は GitHub Packages（`npm.pkg.github.com`）から取得します（`.npmrc` 参照）。

ローカル実行では `NODE_AUTH_TOKEN` が必要です。

例:

```bash
gh auth refresh -s read:packages
export NODE_AUTH_TOKEN="$(gh auth token)"

cd packages/frontend
npm install
```

CI では `.github/workflows/ci.yml` で `packages: read` と `NODE_AUTH_TOKEN` を設定しています。


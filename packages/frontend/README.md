# ERP4 Frontend (PoC)

## 開発

```bash
cd packages/frontend
npm install
npm run dev
```

## itdo-design-system

このフロントエンドは `@itdojp/design-system` を利用します。

### 現状の導入方式

現状は GitHub Packages 側の公開・権限設定が未確定なため、`git+https` で
`itdo-design-system`（`v1.0.0`）を取得し、`postinstall` で `dist/` を生成します。

### （将来）GitHub Packages を使う場合

`.npmrc` は `@itdojp` scope を GitHub Packages（`npm.pkg.github.com`）へ向ける設定です。
切り替えた場合は `NODE_AUTH_TOKEN` が必要になります。

```bash
gh auth refresh -s read:packages
export NODE_AUTH_TOKEN="$(gh auth token)"

cd packages/frontend
npm install
```

CI 側は `.github/workflows/ci.yml` に `packages: read` と `NODE_AUTH_TOKEN` の下地があります。

# ERP4 Frontend (PoC)

## 開発

```bash
cd packages/frontend
npm install
npm run dev
```

## itdo-design-system

このフロントエンドは `@itdo/design-system` を利用します。

### 現状の導入方式

npm 公開版 `@itdo/design-system@1.0.3` を利用します。通常は `dist/` 同梱済みですが、
不足時のみ `postinstall` で `dist/` を補完生成します。

ERP4側の主な適用箇所:

- 依存: `packages/frontend/package.json` の `@itdo/design-system`
- グローバルCSS: `packages/frontend/src/main.tsx` で `@itdo/design-system/styles.css` を1回だけ import
- density: `packages/frontend/index.html` の `<html data-density="compact">`
- UIアダプタ: `packages/frontend/src/ui/index.ts` で re-export

### パッケージ公開確認

既定は npmjs registry を参照します。GitHub Packages で確認する場合は
`DESIGN_SYSTEM_REGISTRY=https://npm.pkg.github.com` を指定してください。

```bash
make design-system-package-check
DESIGN_SYSTEM_VERSION=1.0.3 make design-system-package-check
DESIGN_SYSTEM_REGISTRY=https://npm.pkg.github.com DESIGN_SYSTEM_PACKAGE=@itdojp/design-system DESIGN_SYSTEM_VERSION=1.0.2 make design-system-package-check
```

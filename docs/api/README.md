# API スキーマ（OpenAPI）

## 方針
- backend（Fastify）のルート定義から OpenAPI を生成し、`docs/api/openapi.json` を「契約（contract）」として扱う
- 破壊的変更は CI で検知し、原則として PR をブロックする

## 生成手順
1. backend を build
2. OpenAPI を生成して `docs/api/openapi.json` を更新

例:
```bash
npm run build --prefix packages/backend
node scripts/export-openapi.mjs --out docs/api/openapi.json
```

## 互換性チェック（CI）
PR（pull_request）では以下を実施する。
- `docs/api/openapi.json` が生成結果と一致すること（生成漏れを防ぐ）
- `main` と比較して破壊的変更がないこと（`openapi-diff`）

## 備考
- エラー応答の共通スキーマは `ApiErrorResponse` として `components.schemas` に定義する（後続で各エンドポイントへ適用範囲を拡大）


# テスト結果 2026-01-06 フロント簡易確認

## 実行日時
- 2026-01-06 10:57 JST

## 対象
- ブランチ: docs/bootstrap
- 変更: PR#312 マージ後

## 実行環境
- DB: Podman コンテナ erp4-pg-poc (Postgres 15)
- DB URL: postgresql://postgres:postgres@localhost:55432/postgres?schema=public
- Backend: node packages/backend/dist/index.js (PORT=3002, AUTH_MODE=header)
- Frontend: Vite dev server (PORT=5173)
- VITE_API_BASE: http://localhost:3002

## 手順
1. ./scripts/podman-poc.sh seed
2. Backend 起動 (PORT=3002)
3. Frontend 起動 (PORT=5173, VITE_API_BASE=http://localhost:3002)
4. http://localhost:5173 の HTML が 200 で返ることを確認
5. API 参照の疎通確認として /projects を取得

## 結果
- Frontend dev server 起動: 成功
- HTML 応答: 成功
- API疎通: 成功（seed済みのプロジェクトが取得できた）

## 追加メモ
- 画面操作を伴う手動チェックは未実施（CLI環境のため）。
- フロントの項目別チェックは別途ブラウザで実施が必要。

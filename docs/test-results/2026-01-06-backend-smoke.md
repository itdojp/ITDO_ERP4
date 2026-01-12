# テスト結果 2026-01-06 バックエンドスモーク

## 実行日時
- 2026-01-06 10:33 JST

## 対象
- ブランチ: docs/bootstrap
- 変更: PR#312 マージ後

## 実行環境
- DB: Podman コンテナ erp4-pg-poc (Postgres 15)
- DB URL: postgresql://postgres:postgres@localhost:55432/postgres?schema=public
- Backend: node packages/backend/dist/index.js (PORT=3002, AUTH_MODE=header)
- BASE_URL: http://localhost:3002

## 手順
1. backup_test テーブルが残っていたため削除
2. ./scripts/podman-poc.sh db-push
3. npm run prisma:generate --prefix packages/backend
4. npm run build --prefix packages/backend
5. Backend 起動 (PORT=3002)
6. BASE_URL=http://localhost:3002 ./scripts/smoke-backend.sh

## 結果
- db-push: 成功
- prisma:generate: 成功
- build: 成功
- smoke-backend: 成功

## ログ抜粋
```
[1/9] create project
project_id=2967f48f-d753-416e-a2ee-707cba5bd30f
[2/9] create vendor
vendor_id=4dd69212-5ad9-486d-b3f2-37e5ef6d4bf1
[3/9] create estimate and submit
estimate_id=77b5d5c3-0a31-4bd4-8380-4df8092804d6
[4/9] create invoice and submit/send
invoice_id=d146314f-3d54-4f83-99f2-da288b62e072
[5/9] create time entry
time_id=93cd9ba5-ec46-45f8-b6d6-4a5ec79b41e3
[6/9] create expense and submit
expense_id=68f29e04-be26-499b-ad3d-0184075c873d
[7/9] create purchase order and submit
purchase_order_id=6a1e6a65-edc4-473f-964d-a687c5e78631
[8/9] create vendor quote & invoice
[9/9] run alert job and approval check
smoke ok
```

## 追加メモ
- db-push 実行前に `backup_test` テーブルが残っていたため DROP してから同期。

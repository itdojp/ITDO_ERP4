# テスト結果 2026-01-08 バックエンドスモーク

## 実行日時
- 2026-01-08

## 実行方法
- DB準備: `scripts/podman-poc.sh db-push`
- データ投入: `scripts/podman-poc.sh seed`
- スモーク: `BASE_URL=http://localhost:3001 scripts/smoke-backend.sh`
- 整合チェック: `scripts/podman-poc.sh check`

## 結果
- 成功

## 主要ログ（抜粋）
```text
[1/9] create project
[2/9] create vendor
[3/9] create estimate and submit
[4/9] create invoice and submit/send
[5/9] create time entry
[6/9] create expense and submit
[7/9] create purchase order and submit
[8/9] create vendor quote & invoice
[9/9] run alert job and approval check
smoke ok
```

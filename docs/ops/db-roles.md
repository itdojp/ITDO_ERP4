# DBユーザ最小権限（アプリ用ロール分離）

## 目的
- アプリ実行ユーザの過剰権限を排除し、漏洩/誤操作の影響範囲を限定する
- マイグレーション（DDL）とアプリ実行（DML）を分離し、運用事故を減らす

## 推奨ロール設計（最小）
| ロール | LOGIN | 用途 | 権限の目安 |
|---|---:|---|---|
| `erp4_owner` | no | 所有ロール（任意） | DB/Schema の所有 |
| `erp4_migrator` | yes | Prisma migrate 実行 | DDL/DML（スキーマ所有または同等権限） |
| `erp4_app` | yes | アプリ実行 | DML（SELECT/INSERT/UPDATE/DELETE）+ sequence/function の必要最小 |

補足:
- `erp4_owner` を使わない場合は、`erp4_migrator` を所有ロールとして運用してもよい（要件: migrate と app を分離できること）。

## 運用上の分離（環境変数）
- アプリ実行: `DATABASE_URL` は **`erp4_app`** を利用する
- マイグレーション: `DATABASE_URL` は **`erp4_migrator`** を利用する（migrate 実行時のみ）

同一コンテナで「migrate + app」を動かさない前提（ジョブ分離）にすると事故率が下がります。

## セットアップ（SQL）
1. DBA/運用担当が、対象DBに対して `scripts/checks/postgres-roles.sql` を実行します。
2. `erp4_migrator` の `DATABASE_URL` で `prisma migrate deploy`（または段階に応じた手順）を実行します。
3. アプリは `erp4_app` の `DATABASE_URL` で起動します。

実行例（psql 変数で指定）:
```bash
psql "postgresql://postgres:postgres@localhost:5432/erp4" \
  -v ON_ERROR_STOP=1 \
  -v owner_role=erp4_owner \
  -v migrator_user=erp4_migrator \
  -v migrator_pass='__MIGRATOR_PASSWORD__' \
  -v app_user=erp4_app \
  -v app_pass='__APP_PASSWORD__' \
  -v schema_name=public \
  -f scripts/checks/postgres-roles.sql
```

## 確認（想定どおりの制限になっているか）
### appユーザで DDL ができないこと
```bash
psql "postgresql://erp4_app:__APP_PASSWORD__@localhost:5432/erp4" -c "create table should_fail(id int);"
```
- `permission denied for schema public` 等で失敗するのが期待値

### appユーザで DML ができること
既存テーブルに対して `select/insert/update/delete` ができることを確認します。

## ローテーション/棚卸し
- DBユーザの棚卸し・ローテーション方針は `docs/ops/secrets-and-access.md` を参照


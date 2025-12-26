# Migration PoC Load and Checks

This note describes a minimal PoC load using demo seed data and a basic integrity check.

## Steps
1. Prepare a local database and set `DATABASE_URL`.
2. Apply the demo seed:
   - `psql $DATABASE_URL -f scripts/seed-demo.sql`
3. Run integrity checks:
   - `psql $DATABASE_URL -f scripts/checks/poc-integrity.sql`
4. Compare results with the expected values in `scripts/checks/poc-integrity.sql`.

## Podman で実行する場合（psql が無い環境向け）
1. PostgreSQL コンテナを起動（workspace をマウント）:
   - `podman run -d --name erp4-pg-poc -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=postgres -v $PWD:/workspace:ro -p 55432:5432 docker.io/library/postgres:15`
2. スキーマ反映（Prisma をコンテナ内で実行）:
   - `podman run --rm --network container:erp4-pg-poc -v $PWD:/workspace -w /workspace -e DATABASE_URL="postgresql://postgres:postgres@localhost:5432/postgres?schema=public" docker.io/library/node:20-bookworm npx --prefix packages/backend prisma db push --schema=prisma/schema.prisma --skip-generate`
3. seed を適用:
   - `podman exec -e PGPASSWORD=postgres erp4-pg-poc psql -U postgres -d postgres -f /workspace/scripts/seed-demo.sql`
4. integrity check を実行:
   - `podman exec -e PGPASSWORD=postgres erp4-pg-poc psql -U postgres -d postgres -f /workspace/scripts/checks/poc-integrity.sql`
5. 後片付け:
   - `podman stop erp4-pg-poc && podman rm erp4-pg-poc`

## Output to Record
- project/estimate/invoice/time/expense counts
- invoice totals per project
- expense totals per project
- time minutes per project

## Notes
- This PoC uses demo data. Replace with real migration output when ready.
- If results do not match expectations, inspect source mapping and constraints.

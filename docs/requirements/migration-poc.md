# Migration PoC Load and Checks

This note describes a minimal PoC load using demo seed data and a basic integrity check.

## Steps
1. Prepare a local database and set `DATABASE_URL`.
2. Apply the demo seed:
   - `psql $DATABASE_URL -f scripts/seed-demo.sql`
3. Run integrity checks:
   - `psql $DATABASE_URL -f scripts/checks/poc-integrity.sql`
4. Compare results with the expected values in `scripts/checks/poc-integrity.sql`.

## Output to Record
- project/estimate/invoice/time/expense counts
- invoice totals per project
- expense totals per project
- time minutes per project

## Notes
- This PoC uses demo data. Replace with real migration output when ready.
- If results do not match expectations, inspect source mapping and constraints.

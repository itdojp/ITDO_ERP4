-- Additional seed data for performance benchmarking.
-- Intended for disposable environments only.
-- Usage (inside podman container):
--   psql -v ON_ERROR_STOP=1 -f /workspace/scripts/perf/seed-perf.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Reset perf-only data (repeatable runs)
DELETE FROM "TimeEntry" WHERE "userId" = 'perf-user';
DELETE FROM "Expense" WHERE "userId" = 'perf-user';
DELETE FROM "RateCard" WHERE role = 'perf';

-- Time entries (simulate workload)
INSERT INTO "TimeEntry" (
  id, "projectId", "userId", "workDate", minutes, status, "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'perf-user',
  (CURRENT_DATE - (gs % 180))::date,
  ((gs % 8) + 1) * 30,
  'submitted',
  now(),
  now()
FROM generate_series(1, 50000) AS gs;

-- Expenses
INSERT INTO "Expense" (
  id, "projectId", "userId", category, amount, currency, "incurredOn", status, "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'perf-user',
  'travel',
  (1000 + (gs % 9000))::numeric,
  'JPY',
  (CURRENT_DATE - (gs % 180))::date,
  'approved',
  now(),
  now()
FROM generate_series(1, 5000) AS gs;

-- Rate cards (for report cost calculation)
INSERT INTO "RateCard" (
  id, "projectId", role, "workType", "unitPrice", "validFrom", "validTo", currency
)
SELECT
  gen_random_uuid(),
  null,
  'perf',
  CASE WHEN (gs % 3) = 0 THEN 'dev' ELSE null END,
  10000::numeric,
  (date '2025-01-01' + (gs % 365)),
  null,
  'JPY'
FROM generate_series(1, 8000) AS gs;

INSERT INTO "RateCard" (
  id, "projectId", role, "workType", "unitPrice", "validFrom", "validTo", currency
)
SELECT
  gen_random_uuid(),
  '00000000-0000-0000-0000-000000000001',
  'perf',
  CASE WHEN (gs % 3) = 0 THEN 'dev' ELSE null END,
  12000::numeric,
  (date '2025-01-01' + (gs % 365)),
  null,
  'JPY'
FROM generate_series(1, 8000) AS gs;


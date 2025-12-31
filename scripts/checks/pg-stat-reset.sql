-- Reset pg_stat_statements counters.
-- Usage:
--   psql "$DATABASE_URL" -f scripts/checks/pg-stat-reset.sql

SELECT pg_stat_statements_reset();

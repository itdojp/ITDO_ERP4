-- pg_stat_statements report template for ITDO_ERP4.
-- Usage:
--   psql "$DATABASE_URL" -f scripts/checks/pg-stat-statements.sql
-- Requires:
--   - shared_preload_libraries includes pg_stat_statements
--   - CREATE EXTENSION pg_stat_statements;

\echo '== pg_stat_statements status =='
SELECT current_setting('shared_preload_libraries') AS shared_preload_libraries;

SELECT count(*) AS pg_stat_installed
FROM pg_extension
WHERE extname = 'pg_stat_statements';
\gset

\if :pg_stat_installed
\echo '== Top queries by total_exec_time =='
SELECT
  calls,
  total_exec_time,
  mean_exec_time,
  rows,
  query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

\echo '== Top queries by mean_exec_time =='
SELECT
  calls,
  total_exec_time,
  mean_exec_time,
  rows,
  query
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
\else
\echo 'pg_stat_statements is not enabled. Run: CREATE EXTENSION pg_stat_statements;'
\endif

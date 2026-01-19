-- DBユーザ最小権限（アプリ用ロール分離）
--
-- 前提:
-- - 対象DBに接続した状態で実行する（例: psql .../erp4 -f scripts/checks/postgres-roles.sql）
-- - 実行者は role/database/schema の変更権限を持つ（例: postgres/superuser）
--
-- 必須 psql 変数:
--   owner_role, migrator_user, migrator_pass, app_user, app_pass, schema_name
--
-- 例:
--   psql ".../erp4" -v ON_ERROR_STOP=1 \
--     -v owner_role=erp4_owner \
--     -v migrator_user=erp4_migrator -v migrator_pass='...' \
--     -v app_user=erp4_app -v app_pass='...' \
--     -v schema_name=public \
--     -f scripts/checks/postgres-roles.sql

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'owner_role') THEN
    EXECUTE format('CREATE ROLE %I NOLOGIN', :'owner_role');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrator_user') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', :'migrator_user', :'migrator_pass');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user') THEN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', :'app_user', :'app_pass');
  END IF;
END
$$;

-- 所有ロールを migrator に委譲（migrate 実行時に DDL が必要）
GRANT :"owner_role" TO :"migrator_user";

-- DB/Schema の最小化（public schema の CREATE を閉じる）
REVOKE ALL ON DATABASE current_database() FROM PUBLIC;
GRANT CONNECT ON DATABASE current_database() TO :"migrator_user", :"app_user";

ALTER SCHEMA :"schema_name" OWNER TO :"owner_role";
REVOKE ALL ON SCHEMA :"schema_name" FROM PUBLIC;
GRANT USAGE ON SCHEMA :"schema_name" TO :"migrator_user", :"app_user";

-- app: DML のみ（既存オブジェクト）
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA :"schema_name" TO :"app_user";
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA :"schema_name" TO :"app_user";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA :"schema_name" TO :"app_user";

-- migrator: migrate 用の最小（ここでは schema 使用のみ。DDL は所有/メンバー権限で実行する）
GRANT USAGE ON ALL SEQUENCES IN SCHEMA :"schema_name" TO :"migrator_user";

-- 既定権限（新規オブジェクトに app 権限を自動付与）
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA :"schema_name"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA :"schema_name"
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA :"schema_name"
  GRANT EXECUTE ON FUNCTIONS TO :"app_user";

ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA :"schema_name"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA :"schema_name"
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO :"app_user";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_user" IN SCHEMA :"schema_name"
  GRANT EXECUTE ON FUNCTIONS TO :"app_user";


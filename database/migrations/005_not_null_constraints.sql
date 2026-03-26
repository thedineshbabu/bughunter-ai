-- Migration 005: Enforce NOT NULL on foreign key columns + add schema_migrations tracking

BEGIN;

-- Track applied migrations
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(50) PRIMARY KEY,
  applied_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Record prior migrations as already applied
INSERT INTO schema_migrations (version) VALUES
  ('001_users'),
  ('002_apps'),
  ('003_test_runs'),
  ('004_bug_reports')
ON CONFLICT (version) DO NOTHING;

-- Enforce NOT NULL on apps.user_id
ALTER TABLE apps ALTER COLUMN user_id SET NOT NULL;

-- Enforce NOT NULL on test_runs FK columns
ALTER TABLE test_runs ALTER COLUMN app_id  SET NOT NULL;
ALTER TABLE test_runs ALTER COLUMN user_id SET NOT NULL;

-- Enforce NOT NULL on bug_reports FK columns
ALTER TABLE bug_reports ALTER COLUMN run_id SET NOT NULL;
ALTER TABLE bug_reports ALTER COLUMN app_id SET NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('005_not_null_constraints')
ON CONFLICT (version) DO NOTHING;

COMMIT;

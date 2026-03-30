-- Migration 008: Add 'paused' and 'cancelled' to run_status enum
-- The stop/pause feature requires these values but they were missing from the original enum.

BEGIN;

ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'paused';

INSERT INTO schema_migrations (version) VALUES ('008') ON CONFLICT DO NOTHING;

COMMIT;

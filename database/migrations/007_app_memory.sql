-- Migration 007: App-level persistent memory for smarter consecutive test runs.
-- One row per app stores a JSONB blob with login steps, page scores, and known bugs.

BEGIN;

CREATE TABLE app_memory (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  app_id     UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce exactly one memory record per app
CREATE UNIQUE INDEX idx_app_memory_app_id ON app_memory (app_id);

INSERT INTO schema_migrations (version) VALUES ('007_app_memory')
ON CONFLICT (version) DO NOTHING;

COMMIT;

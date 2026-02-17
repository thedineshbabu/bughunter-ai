-- Migration 003: Create test_runs table
CREATE TYPE run_status AS ENUM ('pending', 'running', 'completed', 'failed');

CREATE TABLE test_runs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  app_id       UUID REFERENCES apps(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  status       run_status DEFAULT 'pending',
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  summary      JSONB,
  error        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_test_runs_user_id ON test_runs (user_id);
CREATE INDEX idx_test_runs_app_id  ON test_runs (app_id);
CREATE INDEX idx_test_runs_status  ON test_runs (status);

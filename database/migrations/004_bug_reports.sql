-- Migration 004: Create bug_reports table
CREATE TYPE bug_severity AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE bug_status   AS ENUM ('open', 'confirmed', 'fixed', 'wontfix');

CREATE TABLE bug_reports (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id              UUID REFERENCES test_runs(id) ON DELETE CASCADE,
  app_id              UUID REFERENCES apps(id) ON DELETE CASCADE,
  title               VARCHAR(500) NOT NULL,
  description         TEXT,
  steps_to_reproduce  TEXT,
  expected_behavior   TEXT,
  actual_behavior     TEXT,
  severity            bug_severity DEFAULT 'medium',
  status              bug_status DEFAULT 'open',
  screenshot_url      TEXT,
  page_url            TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bug_reports_run_id   ON bug_reports (run_id);
CREATE INDEX idx_bug_reports_app_id   ON bug_reports (app_id);
CREATE INDEX idx_bug_reports_severity ON bug_reports (severity);
CREATE INDEX idx_bug_reports_status   ON bug_reports (status);

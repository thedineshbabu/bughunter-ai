-- Migration 002: Create apps table
CREATE TABLE apps (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  url         TEXT NOT NULL,
  credentials JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_apps_user_id ON apps (user_id);

-- 007_agent_memory.sql
-- Adds tables for agent self-improvement: memory (per-app run history)
-- and skills (reusable learned patterns).

-- Per-app run memory: summarized learnings from each completed run
CREATE TABLE IF NOT EXISTS agent_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    run_id UUID NOT NULL REFERENCES test_runs(id) ON DELETE CASCADE,
    buggy_pages JSONB DEFAULT '[]',
    effective_strategies JSONB DEFAULT '[]',
    navigation_map JSONB DEFAULT '{}',
    security_findings JSONB DEFAULT '[]',
    run_summary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_app_id ON agent_memory(app_id);
CREATE INDEX IF NOT EXISTS idx_agent_memory_created_at ON agent_memory(created_at DESC);

-- Reusable skills: learned patterns (app-specific or global)
CREATE TABLE IF NOT EXISTS agent_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    app_id UUID REFERENCES apps(id) ON DELETE CASCADE,  -- NULL = global skill
    agent_type VARCHAR(50) NOT NULL,
    skill_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    skill_data JSONB NOT NULL DEFAULT '{}',
    confidence FLOAT DEFAULT 0.5,
    times_used INT DEFAULT 0,
    times_effective INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_app_id ON agent_skills(app_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_agent_type ON agent_skills(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_skills_global ON agent_skills(app_id) WHERE app_id IS NULL;

-- Track migration
INSERT INTO schema_migrations (version) VALUES ('007') ON CONFLICT DO NOTHING;

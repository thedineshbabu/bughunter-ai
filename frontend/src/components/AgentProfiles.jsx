import React from 'react';
import { AGENT_PROFILES } from '../data/agentProfiles.js';
import { AgentPipelineTracker } from './AgentPipelineTracker.jsx';

export default function AgentProfiles() {
  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <span
          style={{
            display: 'block',
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--on-tertiary-container)',
            textTransform: 'uppercase',
            letterSpacing: '0.2em',
            marginBottom: '8px',
          }}
        >
          Platform
        </span>
        <h2
          style={{
            fontSize: '2.25rem',
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--primary)',
            marginBottom: '8px',
          }}
        >
          AI Agent Team
        </h2>
        <p style={{ fontSize: '0.95rem', color: 'var(--on-surface-variant)', maxWidth: '720px', lineHeight: 1.55 }}>
          BugHunter.AI runs a fixed multi-agent pipeline powered by LangGraph: each specialist handles one stage—from
          strategy and browser exploration to validation, security probes, and structured reporting. Events stream to
          your test run in real time.
        </p>
      </div>

      <div
        className="glass-card"
        style={{
          marginBottom: '1.5rem',
          borderRadius: '12px',
          padding: '1rem 1.25rem',
          border: '1px solid var(--outline-variant)',
        }}
      >
        <div
          style={{
            fontSize: '0.7rem',
            fontWeight: 700,
            color: 'var(--on-surface-variant)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--secondary)' }}>
            linear_scale
          </span>
          Execution order
        </div>
        <AgentPipelineTracker variant="overview" />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '1.25rem',
        }}
      >
        {AGENT_PROFILES.map((agent) => (
          <div
            key={agent.id}
            className="glass-card hoverable-card"
            style={{
              borderRadius: '12px',
              padding: '1.25rem 1.35rem',
              border: '1px solid var(--outline-variant)',
              borderLeft: `4px solid ${agent.color}`,
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  borderRadius: '10px',
                  background: 'var(--surface-container-high)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '26px', color: agent.color }}>
                  {agent.icon}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Step {agent.pipelinePosition}
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--on-surface)', letterSpacing: '-0.02em' }}>
                  {agent.name}
                </div>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--secondary)', marginTop: '2px' }}>{agent.role}</div>
              </div>
            </div>
            <p style={{ fontSize: '0.85rem', color: 'var(--on-surface-variant)', lineHeight: 1.5, margin: 0 }}>{agent.description}</p>
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                Capabilities
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {agent.capabilities.map((c) => (
                  <span
                    key={c}
                    style={{
                      fontSize: '0.72rem',
                      padding: '4px 10px',
                      borderRadius: '999px',
                      background: 'var(--surface-container-high)',
                      color: 'var(--on-surface)',
                      border: '1px solid var(--outline-variant)',
                    }}
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                Tools
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {agent.tools.map((t) => (
                  <span
                    key={t}
                    style={{
                      fontSize: '0.72rem',
                      padding: '4px 10px',
                      borderRadius: '8px',
                      background: 'var(--secondary-soft)',
                      color: 'var(--secondary)',
                      fontWeight: 600,
                    }}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

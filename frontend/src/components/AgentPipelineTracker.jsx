import React, { useMemo } from 'react';
import { AGENT_PROFILES, PIPELINE_AGENT_IDS } from '../data/agentProfiles.js';

/**
 * Derive per-agent pipeline state from live SSE events.
 * Events may include clientTs (injected client-side) for duration.
 *
 * @param {Array<Record<string, unknown>>} events
 * @param {string | undefined} runStatus
 */
function computePipelineState(events, runStatus) {
  /** @type {Record<string, 'pending' | 'active' | 'completed'>} */
  const status = Object.fromEntries(PIPELINE_AGENT_IDS.map((id) => [id, 'pending']));
  /** @type {Record<string, number | null>} */
  const startTs = Object.fromEntries(PIPELINE_AGENT_IDS.map((id) => [id, null]));
  /** @type {Record<string, number | null>} */
  const endTs = Object.fromEntries(PIPELINE_AGENT_IDS.map((id) => [id, null]));

  for (const ev of events) {
    const ts =
      typeof ev.clientTs === 'number'
        ? ev.clientTs
        : typeof ev.ts === 'number'
          ? ev.ts
          : null;

    if (ev.type === 'agent_start' && ev.agent && PIPELINE_AGENT_IDS.includes(String(ev.agent))) {
      const id = String(ev.agent);
      status[id] = 'active';
      if (ts != null) startTs[id] = ts;
    } else if (ev.type === 'agent_done' && ev.agent && PIPELINE_AGENT_IDS.includes(String(ev.agent))) {
      const id = String(ev.agent);
      status[id] = 'completed';
      if (ts != null) endTs[id] = ts;
    }
  }

  // Successful completion: reporter finishes — nothing left running
  if (runStatus === 'completed') {
    PIPELINE_AGENT_IDS.forEach((id) => {
      if (status[id] === 'active') status[id] = 'completed';
    });
  }

  return { status, startTs, endTs };
}

function formatDurationMs(ms) {
  if (ms == null || Number.isNaN(ms) || ms < 0) return null;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

/**
 * @param {object} props
 * @param {Array<Record<string, unknown>>} [props.events]
 * @param {string} [props.runStatus]
 * @param {'run' | 'overview'} [props.variant]
 */
export function AgentPipelineTracker({ events = [], runStatus, variant = 'run' }) {
  const { status, startTs, endTs } = useMemo(
    () => computePipelineState(events, runStatus),
    [events, runStatus]
  );

  const STAGGER_MS = 70;

  if (variant === 'overview') {
    return (
      <div
        role="img"
        aria-label="Agent pipeline order"
        className="agent-pipeline"
        style={{
          display: 'flex',
          alignItems: 'stretch',
          justifyContent: 'space-between',
          gap: '8px',
          flexWrap: 'wrap',
          padding: '12px 0',
        }}
      >
        {AGENT_PROFILES.map((agent, i) => (
          <React.Fragment key={agent.id}>
            <div
              className="agent-pipeline-overview__card"
              style={{
                animationDelay: `${i * STAGGER_MS}ms`,
                flex: '1 1 120px',
                minWidth: '100px',
                maxWidth: '160px',
                padding: '10px 8px',
                borderRadius: '10px',
                border: `1px solid var(--outline-variant)`,
                background: 'var(--surface-container-lowest)',
                textAlign: 'center',
              }}
            >
              <span
                className="material-symbols-outlined agent-pipeline-overview__icon"
                style={{ fontSize: '22px', color: agent.color, display: 'block', marginBottom: '6px' }}
              >
                {agent.icon}
              </span>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--on-surface)', lineHeight: 1.2 }}>
                {agent.name}
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--outline)', marginTop: '4px' }}>Step {agent.pipelinePosition}</div>
            </div>
            {i < AGENT_PROFILES.length - 1 && (
              <div
                style={{
                  alignSelf: 'center',
                  color: 'var(--outline)',
                  fontSize: '18px',
                  flex: '0 0 auto',
                }}
                aria-hidden
              >
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>
                  arrow_forward
                </span>
              </div>
            )}
          </React.Fragment>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        marginBottom: '12px',
        padding: '12px 14px',
        background: 'var(--surface-container-lowest)',
        borderRadius: '10px',
        border: '1px solid var(--outline-variant)',
      }}
    >
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '14px', color: 'var(--secondary)' }}>
          account_tree
        </span>
        Agent pipeline
      </div>
      <div
        className="agent-pipeline"
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '6px',
          flexWrap: 'wrap',
        }}
      >
        {AGENT_PROFILES.map((agent, i) => {
          const st = status[agent.id] || 'pending';
          const dur =
            startTs[agent.id] != null && endTs[agent.id] != null
              ? formatDurationMs(endTs[agent.id] - startTs[agent.id])
              : null;

          const isActive = st === 'active';
          const isDone = st === 'completed';
          const nextAgent = i < AGENT_PROFILES.length - 1 ? AGENT_PROFILES[i + 1] : null;
          const connectorFlow =
            nextAgent &&
            (status[agent.id] === 'completed' || status[nextAgent.id] === 'active');

          return (
            <React.Fragment key={agent.id}>
              <div
                className="agent-pipeline__step"
                style={{
                  animationDelay: `${i * STAGGER_MS}ms`,
                  flex: '1 1 88px',
                  minWidth: '72px',
                  maxWidth: '120px',
                  textAlign: 'center',
                }}
              >
                <div
                  className={`agent-pipeline__glyph${isActive ? ' agent-pipeline__glyph--active' : ''}${isDone ? ' agent-pipeline__glyph--done' : ''}`}
                  style={{
                    width: '36px',
                    height: '36px',
                    margin: '0 auto 6px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: isDone
                      ? '#dcfce7'
                      : isActive
                        ? 'var(--secondary-soft)'
                        : 'var(--surface-container-high)',
                    border: `2px solid ${
                      isDone ? '#16a34a' : isActive ? 'var(--secondary)' : 'var(--outline-variant)'
                    }`,
                  }}
                >
                  {isDone ? (
                    <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#16a34a', fontVariationSettings: "'FILL' 1" }}>
                      check
                    </span>
                  ) : isActive ? (
                    <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--secondary)', fontVariationSettings: "'FILL' 1" }}>
                      progress_activity
                    </span>
                  ) : (
                    <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--outline)' }}>
                      radio_button_unchecked
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--on-surface)', lineHeight: 1.15 }}>
                  {agent.name}
                </div>
                {dur && (
                  <div style={{ fontSize: '0.6rem', color: 'var(--outline)', marginTop: '2px' }}>{dur}</div>
                )}
              </div>
              {i < AGENT_PROFILES.length - 1 && (
                <div
                  className={`agent-pipeline__connector${connectorFlow ? ' agent-pipeline__connector--flow' : ''}`}
                  style={{
                    alignSelf: 'center',
                    marginTop: '-8px',
                    color: connectorFlow ? undefined : 'var(--outline-variant)',
                    opacity: connectorFlow ? 1 : 0.85,
                  }}
                  aria-hidden
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                    chevron_right
                  </span>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export default AgentPipelineTracker;

import React, { useMemo, useState, useEffect } from 'react';
import { AGENT_PROFILES, PIPELINE_AGENT_IDS } from '../data/agentProfiles.js';
import { EVENT_CONFIG } from '../data/liveEventConfig.js';

// ─── Lightbox (minimal, matches BugReports pattern) ───────────────────────────

function Lightbox({ src, label, onClose }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: '10px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#fff', fontSize: '0.875rem', fontWeight: 500 }}>{label}</span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#fff',
              borderRadius: '6px',
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: '0.8rem',
            }}
          >
            Close (Esc)
          </button>
        </div>
        <img
          src={src}
          alt={label}
          style={{ maxWidth: '100%', maxHeight: 'calc(85vh - 60px)', borderRadius: '8px', objectFit: 'contain' }}
        />
      </div>
    </div>
  );
}

/**
 * Walk events in order and assign each event to the current agent phase.
 * @param {Array<Record<string, unknown>>} events
 */
function inferAgentPhase(events) {
  /** @type {Array<Record<string, unknown> & { _phase?: string }>} */
  const out = [];
  let activeAgent = null;

  for (const raw of events) {
    const ev = { ...raw };
    if (ev.type === 'agent_start' && ev.agent && PIPELINE_AGENT_IDS.includes(String(ev.agent))) {
      activeAgent = String(ev.agent);
      ev._phase = activeAgent;
    } else if (ev.type === 'agent_done' && ev.agent && PIPELINE_AGENT_IDS.includes(String(ev.agent))) {
      ev._phase = String(ev.agent);
      out.push(ev);
      activeAgent = null;
      continue;
    } else if (ev.type === 'run_complete' || ev.type === 'run_failed') {
      ev._phase = 'pipeline';
    } else {
      ev._phase = activeAgent || 'pipeline';
    }
    out.push(ev);
  }
  return out;
}

function summarizeAgentEvents(agentId, agentEvents) {
  let pages = 0;
  let bugs = 0;
  let logins = 0;
  for (const ev of agentEvents) {
    if (ev.type === 'page_visited') pages += 1;
    if (ev.type === 'bug_found') bugs += 1;
    if (ev.type === 'login_step') logins += 1;
  }
  const parts = [];
  if (pages) parts.push(`${pages} page${pages === 1 ? '' : 's'} visited`);
  if (bugs) parts.push(`${bugs} bug${bugs === 1 ? '' : 's'} flagged`);
  if (logins) parts.push(`${logins} login step${logins === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * @param {object} props
 * @param {Array<Record<string, unknown>>} props.events
 */
export function AgentActivityLog({ events }) {
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(() => ({
    ...Object.fromEntries(PIPELINE_AGENT_IDS.map((id) => [id, true])),
    pipeline: true,
  }));
  const [lightbox, setLightbox] = useState(null);

  const annotated = useMemo(() => inferAgentPhase(events), [events]);

  const groups = useMemo(() => {
    /** @type {Record<string, typeof annotated>} */
    const g = Object.fromEntries(PIPELINE_AGENT_IDS.map((id) => [id, []]));
    g.pipeline = [];

    for (const ev of annotated) {
      const phase = ev._phase === 'pipeline' ? 'pipeline' : PIPELINE_AGENT_IDS.includes(String(ev._phase)) ? String(ev._phase) : 'pipeline';
      if (phase === 'pipeline') g.pipeline.push(ev);
      else g[phase].push(ev);
    }
    return g;
  }, [annotated]);

  const durationForAgent = (agentId) => {
    const list = groups[agentId] || [];
    let start = null;
    let end = null;
    for (const ev of list) {
      const ts =
        typeof ev.clientTs === 'number'
          ? ev.clientTs
          : typeof ev.ts === 'number'
            ? ev.ts
            : null;
      if (ev.type === 'agent_start' && ts != null) start = ts;
      if (ev.type === 'agent_done' && ts != null) end = ts;
    }
    if (start != null && end != null && end >= start) {
      const s = Math.round((end - start) / 1000);
      if (s < 60) return `${s}s`;
      const m = Math.floor(s / 60);
      return `${m}m ${s % 60}s`;
    }
    return null;
  };

  const filterIds =
    filter === 'all' ? [...PIPELINE_AGENT_IDS, 'pipeline'] : filter === 'pipeline' ? ['pipeline'] : [filter];

  const pills = [
    { id: 'all', label: 'All agents' },
    ...AGENT_PROFILES.map((a) => ({ id: a.id, label: a.name })),
    { id: 'pipeline', label: 'Run' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Filter
        </span>
        {pills.map((p) => {
          const active = filter === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setFilter(p.id)}
              style={{
                padding: '5px 12px',
                borderRadius: '999px',
                fontSize: '0.72rem',
                fontWeight: active ? 600 : 500,
                border: active ? 'none' : '1px solid var(--outline-variant)',
                background: active ? 'var(--secondary-soft)' : 'transparent',
                color: active ? 'var(--secondary)' : 'var(--on-surface-variant)',
                cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '420px', overflowY: 'auto' }}>
        {filterIds.map((agentId) => {
          if (agentId === 'pipeline') {
            const pipelineEvents = groups.pipeline || [];
            if (pipelineEvents.length === 0) return null;
            return (
              <div
                key="pipeline"
                style={{
                  borderRadius: '10px',
                  border: '1px solid var(--outline-variant)',
                  background: 'var(--surface-container-lowest)',
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, pipeline: !o.pipeline }))}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    border: 'none',
                    background: 'var(--surface-container)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--outline)' }}>
                    flag
                  </span>
                  <span style={{ flex: 1, fontSize: '0.78rem', fontWeight: 600, color: 'var(--on-surface)' }}>Run outcome</span>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--outline)' }}>
                    {open.pipeline ? 'expand_less' : 'expand_more'}
                  </span>
                </button>
                {open.pipeline !== false && (
                  <div style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {pipelineEvents.map((ev, i) => {
                      const cfg = EVENT_CONFIG[ev.type] || { color: 'var(--outline)', icon: 'info' };
                      return (
                        <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '6px', color: cfg.color }}>
                          <span className="material-symbols-outlined" style={{ fontSize: '14px', flexShrink: 0, fontVariationSettings: "'FILL' 1" }}>
                            {cfg.icon}
                          </span>
                          <span style={{ wordBreak: 'break-word' }}>{ev.message || ev.type}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          const list = groups[agentId] || [];
          if (list.length === 0) return null;

          const meta = AGENT_PROFILES.find((a) => a.id === agentId);
          const summary = summarizeAgentEvents(agentId, list);
          const dur = durationForAgent(agentId);
          const isOpen = open[agentId] !== false;

          return (
            <div
              key={agentId}
              style={{
                borderRadius: '10px',
                border: `1px solid var(--outline-variant)`,
                background: 'var(--surface-container-lowest)',
                overflow: 'hidden',
              }}
            >
              <button
                type="button"
                onClick={() => setOpen((o) => ({ ...o, [agentId]: !o[agentId] }))}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  border: 'none',
                  background: 'var(--surface-container)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '22px', color: meta?.color || 'var(--secondary)', flexShrink: 0 }}>
                  {meta?.icon || 'smart_toy'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--on-surface)' }}>{meta?.name || agentId}</span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--outline)', padding: '2px 8px', background: 'var(--surface-container-lowest)', borderRadius: '999px' }}>
                      {list.length} events
                    </span>
                    {dur && (
                      <span style={{ fontSize: '0.65rem', color: 'var(--outline)' }}>{dur}</span>
                    )}
                  </div>
                  {summary && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--on-surface-variant)', marginTop: '4px' }}>{summary}</div>
                  )}
                </div>
                <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--outline)', flexShrink: 0 }}>
                  {isOpen ? 'expand_less' : 'expand_more'}
                </span>
              </button>
              {isOpen && (
                <div style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '0.75rem', maxHeight: '240px', overflowY: 'auto' }}>
                  {list.map((ev, i) => {
                    const cfg = EVENT_CONFIG[ev.type] || { color: 'var(--outline)', icon: 'info' };
                    const screenshotSrc = ev.screenshot_file ? `/screenshots/${ev.screenshot_file}` : null;
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '8px', color: cfg.color }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '14px', flexShrink: 0, marginTop: '2px', fontVariationSettings: "'FILL' 1" }}>
                          {cfg.icon}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ lineHeight: 1.4, wordBreak: 'break-word' }}>{ev.message || ev.type}</span>
                          {screenshotSrc && (
                            <div style={{ marginTop: '5px' }}>
                              <img
                                src={screenshotSrc}
                                alt={ev.message || ''}
                                onClick={() => setLightbox({ src: screenshotSrc, label: ev.message })}
                                style={{
                                  height: '64px',
                                  borderRadius: '5px',
                                  border: '1px solid rgba(197,198,207,0.4)',
                                  objectFit: 'cover',
                                  cursor: 'zoom-in',
                                  display: 'block',
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {lightbox && <Lightbox src={lightbox.src} label={lightbox.label} onClose={() => setLightbox(null)} />}
    </div>
  );
}

export default AgentActivityLog;

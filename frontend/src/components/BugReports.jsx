import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import api from '../services/api.js';

const ACTIVE_STATUSES = new Set(['pending', 'running']);

const SEVERITY_CONFIG = {
  critical: { bg: 'var(--error-container)', color: 'var(--error)',                rail: 'var(--error)',                icon: 'crisis_alert' },
  high:     { bg: '#ffedd5',               color: '#9a3412',                      rail: '#ea580c',                     icon: 'warning' },
  medium:   { bg: '#fef3c7',               color: '#92400e',                      rail: 'var(--on-tertiary-container)', icon: 'info' },
  low:      { bg: '#f0fdf4',               color: '#16a34a',                      rail: '#22c55e',                     icon: 'check_circle' },
};

const STATUS_CONFIG = {
  open:      { bg: 'rgba(0,88,190,0.08)', color: 'var(--secondary)' },
  confirmed: { bg: '#ede9fe',             color: '#5b21b6' },
  fixed:     { bg: '#f0fdf4',             color: '#16a34a' },
  wontfix:   { bg: 'var(--surface-container-high)', color: 'var(--on-surface-variant)' },
};

const EVENT_CONFIG = {
  agent_start:  { color: 'var(--secondary)', icon: 'play_circle' },
  agent_done:   { color: '#16a34a',          icon: 'check_circle' },
  page_visited: { color: 'var(--outline)',   icon: 'travel_explore' },
  bug_found:    { color: 'var(--error)',     icon: 'bug_report' },
  run_complete: { color: '#16a34a',          icon: 'verified' },
  run_failed:   { color: 'var(--error)',     icon: 'error' },
};

// ─── helpers ────────────────────────────────────────────────────────────────

function duration(start, end) {
  if (!start || !end) return null;
  const s = Math.round((new Date(end) - new Date(start)) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function SevBadge({ severity, count }) {
  const cfg = SEVERITY_CONFIG[severity];
  if (!cfg || count === 0) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, background: cfg.bg, color: cfg.color }}>
      <span className="material-symbols-outlined" style={{ fontSize: '12px', fontVariationSettings: "'FILL' 1" }}>{cfg.icon}</span>
      {count} {severity}
    </span>
  );
}

// ─── Lightbox ────────────────────────────────────────────────────────────────

function Lightbox({ src, label, onClose }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#fff', fontSize: '0.875rem', fontWeight: 500 }}>{label}</span>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer', fontSize: '0.8rem' }}>
            Close (Esc)
          </button>
        </div>
        <img src={src} alt={label} style={{ maxWidth: '100%', maxHeight: 'calc(85vh - 60px)', borderRadius: '8px', objectFit: 'contain' }} />
      </div>
    </div>
  );
}

// ─── Screenshots Gallery ─────────────────────────────────────────────────────

function ScreenshotsGallery({ bugs }) {
  const [lightbox, setLightbox] = useState(null);
  const withScreenshots = bugs.filter(b => b.screenshot_url);
  if (withScreenshots.length === 0) return null;

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>photo_library</span>
        Screenshots ({withScreenshots.length})
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
        {withScreenshots.map(bug => {
          const sev = SEVERITY_CONFIG[bug.severity] || SEVERITY_CONFIG.medium;
          return (
            <div key={bug.id} onClick={() => setLightbox({ src: bug.screenshot_url, label: bug.title })}
              style={{ cursor: 'pointer', borderRadius: '8px', overflow: 'hidden', border: `2px solid ${sev.rail}`, background: 'var(--surface-container-lowest)', transition: 'transform 0.15s', position: 'relative' }}
              onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
              <img src={bug.screenshot_url} alt={bug.title} style={{ width: '100%', height: '110px', objectFit: 'cover', display: 'block' }} />
              <div style={{ padding: '6px 8px', borderTop: `1px solid ${sev.rail}22` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                  <span style={{ padding: '1px 6px', borderRadius: '999px', fontSize: '9px', fontWeight: 700, background: sev.bg, color: sev.color, textTransform: 'uppercase' }}>{bug.severity}</span>
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{bug.title}</div>
              </div>
              <div style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(0,0,0,0.5)', borderRadius: '4px', padding: '2px 4px' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#fff' }}>zoom_in</span>
              </div>
            </div>
          );
        })}
      </div>
      {lightbox && <Lightbox src={lightbox.src} label={lightbox.label} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// ─── Run Overview Card ────────────────────────────────────────────────────────

function RunOverviewCard({ run, bugs }) {
  const sevCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  bugs.forEach(b => { if (sevCounts[b.severity] !== undefined) sevCounts[b.severity]++; });
  const dur = duration(run.started_at, run.completed_at);
  const isCompleted = run.status === 'completed';
  const isFailed    = run.status === 'failed';
  const isActive    = ACTIVE_STATUSES.has(run.status);

  const statusStyle = isCompleted
    ? { bg: '#f0fdf4', color: '#16a34a', icon: 'verified', label: 'Completed' }
    : isFailed
    ? { bg: 'var(--error-container)', color: 'var(--error)', icon: 'error', label: 'Failed' }
    : { bg: 'rgba(0,88,190,0.08)', color: 'var(--secondary)', icon: 'autorenew', label: run.status.toUpperCase() };

  return (
    <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '12px', marginBottom: '1.5rem', overflow: 'hidden', border: '1px solid rgba(197,198,207,0.15)' }}>
      {/* Status bar */}
      <div style={{ height: '4px', background: isCompleted ? '#22c55e' : isFailed ? 'var(--error)' : 'var(--secondary)' }} />

      <div style={{ padding: '1.25rem 1.5rem' }}>
        {/* Top row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '4px' }}>Target Application</div>
            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--primary)', marginBottom: '2px' }}>{run.app_name}</div>
            <a href={run.app_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8rem', color: 'var(--outline)', fontFamily: 'monospace' }}>{run.app_url}</a>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700, background: statusStyle.bg, color: statusStyle.color }}>
            <span className={`material-symbols-outlined${isActive ? ' pulse' : ''}`} style={{ fontSize: '14px', fontVariationSettings: "'FILL' 1" }}>{statusStyle.icon}</span>
            {statusStyle.label}
          </span>
        </div>

        {/* Metrics row */}
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.8rem', marginBottom: '1rem', color: 'var(--on-surface-variant)' }}>
          {run.started_at && (
            <div>
              <span style={{ fontWeight: 600, color: 'var(--on-surface)' }}>Started </span>
              {format(new Date(run.started_at), 'MMM d, yyyy HH:mm')}
            </div>
          )}
          {run.completed_at && (
            <div>
              <span style={{ fontWeight: 600, color: 'var(--on-surface)' }}>Finished </span>
              {format(new Date(run.completed_at), 'HH:mm:ss')}
            </div>
          )}
          {dur && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>timer</span>
              <span style={{ fontWeight: 600, color: 'var(--on-surface)' }}>Duration </span>{dur}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px', color: bugs.length > 0 ? 'var(--error)' : '#16a34a' }}>bug_report</span>
            <span style={{ fontWeight: 600, color: 'var(--on-surface)' }}>{bugs.length} bug{bugs.length !== 1 ? 's' : ''} found</span>
          </div>
        </div>

        {/* Severity breakdown */}
        {bugs.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {['critical', 'high', 'medium', 'low'].map(s => (
              <SevBadge key={s} severity={s} count={sevCounts[s]} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pages Explored ───────────────────────────────────────────────────────────

function PagesExplored({ summary, accentColor = '#16a34a' }) {
  const [lightbox, setLightbox] = useState(null);
  const [expandedPage, setExpandedPage] = useState(null);

  const pages = summary?.pages_visited || [];
  if (pages.length === 0) return null;

  const ACTION_LABELS = {
    observe:                'Analysed page for test opportunities',
    login_attempt:          'Attempted login',
    login_flow_completed:   'Login flow completed',
    login_flow_failed:      'Login flow failed',
    errors_detected:        'Console / network errors detected',
    error:                  'Error encountered',
  };

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>travel_explore</span>
        Pages Explored ({pages.length})
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {pages.map((page, i) => {
          const imgSrc = page.screenshot_file ? `/screenshots/${page.screenshot_file}` : null;
          const isExpanded = expandedPage === i;

          return (
            <div key={i} style={{ background: 'var(--surface-container-lowest)', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(197,198,207,0.15)', borderLeft: `3px solid ${accentColor}` }}>
              {/* Row header */}
              <div onClick={() => setExpandedPage(isExpanded ? null : i)}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', cursor: 'pointer' }}>
                {/* Thumbnail */}
                {imgSrc ? (
                  <div onClick={e => { e.stopPropagation(); setLightbox({ src: imgSrc, label: page.url }); }}
                    style={{ flexShrink: 0, width: '72px', height: '46px', borderRadius: '5px', overflow: 'hidden', border: '1px solid rgba(197,198,207,0.3)', cursor: 'zoom-in', position: 'relative' }}>
                    <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#fff' }}>zoom_in</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ flexShrink: 0, width: '72px', height: '46px', borderRadius: '5px', background: 'var(--surface-container-low)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--outline-variant)' }}>image_not_supported</span>
                  </div>
                )}

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--on-surface-variant)', background: 'var(--surface-container-low)', padding: '1px 6px', borderRadius: '4px' }}>
                      Page {i + 1}
                    </span>
                    {page.steps?.length > 0 && (
                      <span style={{ fontSize: '10px', color: 'var(--outline)' }}>{page.steps.length} action{page.steps.length !== 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--on-surface)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={page.url} target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{ color: accentColor, textDecoration: 'none' }}>{page.url}</a>
                  </div>
                </div>

                <span className="material-symbols-outlined" style={{ color: 'var(--outline)', fontSize: '18px', flexShrink: 0 }}>
                  {isExpanded ? 'expand_less' : 'expand_more'}
                </span>
              </div>

              {/* Expanded: full screenshot + what was tested */}
              {isExpanded && (
                <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--surface-container-low)' }}>
                  {imgSrc && (
                    <div style={{ marginTop: '12px', cursor: 'zoom-in' }} onClick={() => setLightbox({ src: imgSrc, label: page.url })}>
                      <img src={imgSrc} alt={page.url}
                        style={{ width: '100%', maxHeight: '340px', objectFit: 'contain', borderRadius: '8px', border: '1px solid rgba(197,198,207,0.3)', display: 'block' }} />
                      <div style={{ fontSize: '0.7rem', color: 'var(--outline)', marginTop: '4px', textAlign: 'center' }}>Click to open full size</div>
                    </div>
                  )}

                  {page.steps?.length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                        What Was Tested
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {page.steps.map((step, si) => (
                          <div key={si} style={{ display: 'flex', gap: '8px', fontSize: '0.8rem', alignItems: 'flex-start' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '14px', color: step.action === 'error' || step.action === 'login_flow_failed' ? 'var(--error)' : accentColor, flexShrink: 0, marginTop: '1px' }}>
                              {step.action === 'observe' ? 'search' : step.action.includes('login') ? 'key' : step.action === 'errors_detected' ? 'warning' : 'info'}
                            </span>
                            <div>
                              <span style={{ fontWeight: 500, color: 'var(--on-surface)' }}>{ACTION_LABELS[step.action] || step.action}</span>
                              {step.detail && typeof step.detail === 'string' && step.detail.length < 200 && (
                                <div style={{ color: 'var(--on-surface-variant)', marginTop: '2px', whiteSpace: 'pre-wrap' }}>{step.detail}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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

// ─── Success Summary Panel ────────────────────────────────────────────────────

function SuccessPanel({ run, bugs }) {
  const summary = run.summary || {};

  return (
    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', marginBottom: '1.5rem', overflow: 'hidden' }}>
      <div style={{ padding: '0.875rem 1.25rem', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid #bbf7d0' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#16a34a', fontVariationSettings: "'FILL' 1" }}>task_alt</span>
        <span style={{ fontWeight: 600, fontSize: '0.875rem', color: '#15803d' }}>Scan Completed Successfully</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px', fontSize: '0.8rem', color: '#166534' }}>
          {summary.pages_explored > 0 && <span><strong>{summary.pages_explored}</strong> pages</span>}
          {summary.screenshots_taken > 0 && <span><strong>{summary.screenshots_taken}</strong> screenshots</span>}
          <span><strong>{bugs.length}</strong> bug{bugs.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {bugs.length === 0 && (
        <div style={{ padding: '1rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: '#dcfce7', borderRadius: '8px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#16a34a', fontVariationSettings: "'FILL' 1" }}>shield</span>
            <span style={{ fontSize: '0.875rem', color: '#15803d', fontWeight: 500 }}>No bugs found — the application passed all checks.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Failure Panel ────────────────────────────────────────────────────────────

function FailurePanel({ run }) {
  return (
    <div style={{ background: 'var(--error-container)', border: '1px solid rgba(186,26,26,0.3)', borderRadius: '12px', marginBottom: '1.5rem', overflow: 'hidden' }}>
      <div style={{ padding: '0.875rem 1.25rem', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid rgba(186,26,26,0.2)' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--error)', fontVariationSettings: "'FILL' 1" }}>error</span>
        <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--error)' }}>Scan Failed</span>
      </div>

      <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {run.error && (
          <div>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--error)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Error Details</div>
            <pre style={{ margin: 0, fontSize: '0.8rem', color: 'var(--error)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'rgba(186,26,26,0.08)', padding: '10px 14px', borderRadius: '8px', fontFamily: 'monospace', lineHeight: 1.5 }}>
              {run.error}
            </pre>
          </div>
        )}
        <div style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>info</span>
          Check <code style={{ background: 'rgba(0,0,0,0.06)', padding: '1px 5px', borderRadius: '4px' }}>logs/agent.log</code> for the full error trace.
        </div>
      </div>
    </div>
  );
}

// ─── Bug Card ─────────────────────────────────────────────────────────────────

function BugCard({ bug, onStatusChange }) {
  const [expanded, setExpanded] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const sev = SEVERITY_CONFIG[bug.severity] || SEVERITY_CONFIG.medium;
  const sta = STATUS_CONFIG[bug.status] || STATUS_CONFIG.open;

  const detailRows = [
    { label: 'Description',         value: bug.description },
    { label: 'Steps to Reproduce',  value: bug.steps_to_reproduce },
    { label: 'Expected Behavior',   value: bug.expected_behavior },
    { label: 'Actual Behavior',     value: bug.actual_behavior },
  ].filter(r => r.value);

  return (
    <>
      <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '10px', marginBottom: '8px', overflow: 'hidden', borderLeft: `3px solid ${sev.rail}` }}>
        {/* Header row */}
        <div onClick={() => setExpanded(!expanded)} style={{ padding: '1rem 1.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="material-symbols-outlined" style={{ color: sev.rail, fontSize: '20px', flexShrink: 0, fontVariationSettings: "'FILL' 1" }}>{sev.icon}</span>
          <span style={{ padding: '2px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, background: sev.bg, color: sev.color, textTransform: 'uppercase', flexShrink: 0 }}>
            {bug.severity}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--primary)', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bug.title}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--outline)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bug.page_url}</div>
          </div>
          {/* Screenshot thumbnail in header */}
          {bug.screenshot_url && (
            <div onClick={e => { e.stopPropagation(); setLightbox(true); }}
              style={{ flexShrink: 0, width: '56px', height: '36px', borderRadius: '4px', overflow: 'hidden', border: `1px solid ${sev.rail}44`, cursor: 'zoom-in', position: 'relative' }}>
              <img src={bug.screenshot_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#fff' }}>zoom_in</span>
              </div>
            </div>
          )}
          <span style={{ padding: '2px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 600, background: sta.bg, color: sta.color, textTransform: 'uppercase', flexShrink: 0 }}>
            {bug.status}
          </span>
          <span className="material-symbols-outlined" style={{ color: 'var(--outline)', fontSize: '18px', flexShrink: 0 }}>
            {expanded ? 'expand_less' : 'expand_more'}
          </span>
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div style={{ padding: '0 1.25rem 1.25rem', borderTop: '1px solid var(--surface-container-low)' }}>
            {/* Detail rows */}
            {detailRows.map(({ label, value }) => (
              <div key={label} style={{ marginTop: '1rem' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>{label}</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--on-surface)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{value}</div>
              </div>
            ))}

            {/* Full screenshot */}
            {bug.screenshot_url && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>screenshot</span>
                  Screenshot
                </div>
                <div style={{ position: 'relative', display: 'inline-block', cursor: 'zoom-in' }} onClick={() => setLightbox(true)}>
                  <img src={bug.screenshot_url} alt="Bug screenshot" style={{ maxWidth: '100%', maxHeight: '320px', objectFit: 'contain', borderRadius: '8px', border: `1px solid ${sev.rail}44`, display: 'block' }} />
                  <div style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(0,0,0,0.5)', borderRadius: '6px', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '14px', color: '#fff' }}>zoom_in</span>
                    <span style={{ fontSize: '0.7rem', color: '#fff' }}>Click to expand</span>
                  </div>
                </div>
              </div>
            )}

            {/* Status update */}
            <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Update Status:</span>
              {['open', 'confirmed', 'fixed', 'wontfix'].map(s => (
                <button key={s} onClick={() => onStatusChange(bug.id, s)} disabled={bug.status === s} style={{
                  padding: '5px 12px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 500,
                  border: bug.status === s ? 'none' : '1px solid var(--outline-variant)',
                  background: bug.status === s ? 'var(--primary)' : 'transparent',
                  color: bug.status === s ? '#fff' : 'var(--on-surface-variant)',
                  cursor: bug.status === s ? 'default' : 'pointer',
                }}>{s}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      {lightbox && bug.screenshot_url && (
        <Lightbox src={bug.screenshot_url} label={bug.title} onClose={() => setLightbox(false)} />
      )}
    </>
  );
}

// ─── Live Activity Panel ──────────────────────────────────────────────────────

function LiveActivityPanel({ events }) {
  const bottomRef = useRef(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [events]);

  return (
    <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '10px', padding: '1rem', maxHeight: '240px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.78rem' }}>
      {events.length === 0 && (
        <div style={{ color: 'var(--outline)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="material-symbols-outlined pulse" style={{ fontSize: '16px', color: 'var(--secondary)' }}>autorenew</span>
          Waiting for agent to start…
        </div>
      )}
      {events.map((ev, i) => {
        const cfg = EVENT_CONFIG[ev.type] || { color: 'var(--outline)', icon: 'info' };
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px', color: cfg.color }}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px', flexShrink: 0, marginTop: '1px', fontVariationSettings: "'FILL' 1" }}>{cfg.icon}</span>
            <span style={{ lineHeight: 1.4, wordBreak: 'break-word' }}>{ev.message || ev.type}</span>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BugReports() {
  const { id } = useParams();
  const [run, setRun]         = useState(null);
  const [bugs, setBugs]       = useState([]);
  const [filter, setFilter]   = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [liveEvents, setLiveEvents]   = useState([]);
  const [showLive, setShowLive]       = useState(true);
  const [generating, setGenerating]   = useState(false);
  const [featureContent, setFeatureContent]   = useState(null);
  const [featureFilename, setFeatureFilename] = useState('regression.feature');
  const sseRef  = useRef(null);
  const pollRef = useRef(null);

  const fetchData = useCallback(() => {
    api.get(`/runs/${id}`)
      .then(res => { setRun(res.data.run); setBugs(res.data.bugs || []); setError(null); })
      .catch(err => setError(err.response?.data?.error || err.message || 'Failed to load run'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // SSE while active; polling fallback
  useEffect(() => {
    const isActive = run && ACTIVE_STATUSES.has(run.status);
    if (isActive && !sseRef.current) {
      const token = localStorage.getItem('bughunter_token');
      const sse = new EventSource(`/api/runs/${id}/stream?token=${token}`);
      sseRef.current = sse;
      sse.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          setLiveEvents(prev => [...prev, event]);
          if (event.type === 'run_complete' || event.type === 'run_failed') {
            setTimeout(fetchData, 1000);
          }
        } catch { /* ignore */ }
      };
      sse.onerror = () => {
        sse.close(); sseRef.current = null;
        if (!pollRef.current) pollRef.current = setInterval(fetchData, 5000);
      };
    }
    if (!isActive) {
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => {
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [run, id, fetchData]);

  const handleStatusChange = async (bugId, status) => {
    try { await api.put(`/bugs/${bugId}/status`, { status }); fetchData(); }
    catch (err) { setError(err.response?.data?.error || err.message || 'Failed to update status'); }
  };

  const handleGenerateTests = async () => {
    setGenerating(true); setFeatureContent(null);
    try {
      const res = await api.post(`/runs/${id}/generate-tests`);
      setFeatureContent(res.data.feature_content);
      setFeatureFilename(res.data.filename || 'regression.feature');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to generate tests');
    } finally { setGenerating(false); }
  };

  const handleDownload = () => {
    const blob = new Blob([featureContent], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = featureFilename; a.click();
    URL.revokeObjectURL(url);
  };

  const FILTERS  = ['all', 'critical', 'high', 'medium', 'low'];
  const filtered = filter === 'all' ? bugs : bugs.filter(b => b.severity === filter);
  const countBySev = (s) => bugs.filter(b => b.severity === s).length;
  const isActive = run && ACTIVE_STATUSES.has(run.status);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--on-surface-variant)', padding: '2rem 0' }}>
      <span className="material-symbols-outlined pulse" style={{ color: 'var(--secondary)' }}>autorenew</span> Loading…
    </div>
  );

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--on-tertiary-container)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '6px' }}>Vulnerability Report</span>
          <h2 style={{ fontSize: '2.25rem', fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--primary)', marginBottom: '4px' }}>Test Results</h2>
        </div>
        {run?.status === 'completed' && bugs.length > 0 && (
          <button onClick={handleGenerateTests} disabled={generating} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '8px 16px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 600,
            background: 'var(--primary)', color: '#fff', border: 'none', cursor: generating ? 'wait' : 'pointer',
            opacity: generating ? 0.7 : 1,
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>science</span>
            {generating ? 'Generating…' : 'Generate Tests'}
          </button>
        )}
      </div>

      {error && (
        <div style={{ background: 'var(--error-container)', color: 'var(--error)', padding: '12px 16px', borderRadius: '8px', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
          <span>{error}</span>
          <button onClick={() => { setError(null); fetchData(); }} style={{ background: 'none', border: 'none', color: 'var(--error)', fontWeight: 600 }}>Retry</button>
        </div>
      )}

      {/* Run overview */}
      {run && <RunOverviewCard run={run} bugs={bugs} />}

      {/* Live activity — while running */}
      {isActive && (
        <div style={{ marginBottom: '1.5rem', background: 'var(--surface-container-low)', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--outline-variant)' }}>
          <div onClick={() => setShowLive(!showLive)} style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <span className="material-symbols-outlined pulse" style={{ fontSize: '16px', color: 'var(--secondary)' }}>sensors</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', flex: 1 }}>Live Activity</span>
            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--outline)' }}>{showLive ? 'expand_less' : 'expand_more'}</span>
          </div>
          {showLive && <div style={{ padding: '0 12px 12px' }}><LiveActivityPanel events={liveEvents} /></div>}
        </div>
      )}

      {/* Success / Failure panels */}
      {run?.status === 'completed' && <SuccessPanel run={run} bugs={bugs} />}
      {run?.status === 'failed'    && <FailurePanel run={run} />}

      {/* Pages explored with screenshots — shown for completed and failed */}
      {(run?.status === 'completed' || run?.status === 'failed') && (
        <PagesExplored
          summary={run.summary}
          accentColor={run.status === 'failed' ? 'var(--error)' : '#16a34a'}
        />
      )}

      {/* Generated feature file */}
      {featureContent && (
        <div style={{ marginBottom: '1.5rem', background: 'var(--surface-container-low)', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--outline-variant)' }}>
          <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--outline-variant)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#16a34a', fontVariationSettings: "'FILL' 1" }}>description</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', flex: 1 }}>{featureFilename}</span>
            <button onClick={handleDownload} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 12px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600, background: '#16a34a', color: '#fff', border: 'none', cursor: 'pointer' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>download</span>Download
            </button>
            <button onClick={() => setFeatureContent(null)} style={{ background: 'none', border: 'none', color: 'var(--outline)', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>×</button>
          </div>
          <pre style={{ margin: 0, padding: '1rem', fontSize: '0.75rem', overflowX: 'auto', maxHeight: '400px', overflowY: 'auto', background: 'var(--surface-container-lowest)', color: 'var(--on-surface)', lineHeight: 1.6 }}>
            {featureContent}
          </pre>
        </div>
      )}

      {/* Screenshots gallery */}
      {bugs.length > 0 && <ScreenshotsGallery bugs={filtered} />}

      {/* Severity filter pills */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Filter:</span>
        {FILTERS.map(f => {
          const active = filter === f;
          const sev = SEVERITY_CONFIG[f];
          return (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '6px 14px', borderRadius: '999px', fontSize: '0.8rem', fontWeight: active ? 600 : 500,
              border: active ? 'none' : '1px solid var(--outline-variant)',
              background: active ? (sev ? sev.bg : 'var(--primary)') : 'transparent',
              color: active ? (sev ? sev.color : '#fff') : 'var(--on-surface-variant)',
              cursor: 'pointer',
            }}>
              {f === 'all' ? `All (${bugs.length})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${countBySev(f)})`}
            </button>
          );
        })}
      </div>

      {/* Bug list */}
      {filtered.length === 0 ? (
        <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '12px', padding: '4rem', textAlign: 'center', color: 'var(--on-surface-variant)' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--outline-variant)', display: 'block', marginBottom: '12px' }}>verified</span>
          <p style={{ fontWeight: 500, color: 'var(--on-surface)', marginBottom: '4px' }}>
            {filter === 'all' ? (isActive ? 'Run in progress — bugs will appear here' : 'No bugs found!') : `No ${filter} severity bugs`}
          </p>
          {filter !== 'all' && <p style={{ fontSize: '0.875rem' }}>Try selecting a different filter.</p>}
        </div>
      ) : (
        <div>{filtered.map(bug => <BugCard key={bug.id} bug={bug} onStatusChange={handleStatusChange} />)}</div>
      )}
    </div>
  );
}

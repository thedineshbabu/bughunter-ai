import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import api from '../services/api.js';

const ACTIVE_STATUSES = new Set(['pending', 'running']);

const SEVERITY_CONFIG = {
  critical: { bg: 'var(--error-container)', color: 'var(--error)',           rail: 'var(--error)',           icon: 'crisis_alert' },
  high:     { bg: '#ffedd5', color: '#9a3412',                               rail: '#ea580c',                icon: 'warning' },
  medium:   { bg: '#fef3c7', color: '#92400e',                               rail: 'var(--on-tertiary-container)', icon: 'info' },
  low:      { bg: '#f0fdf4', color: '#16a34a',                               rail: '#22c55e',                icon: 'check_circle' },
};

const STATUS_CONFIG = {
  open:      { bg: 'rgba(0,88,190,0.08)', color: 'var(--secondary)' },
  confirmed: { bg: '#ede9fe', color: '#5b21b6' },
  fixed:     { bg: '#f0fdf4', color: '#16a34a' },
  wontfix:   { bg: 'var(--surface-container-high)', color: 'var(--on-surface-variant)' },
};

function BugCard({ bug, onStatusChange }) {
  const [expanded, setExpanded] = useState(false);
  const sev = SEVERITY_CONFIG[bug.severity] || SEVERITY_CONFIG.medium;
  const sta = STATUS_CONFIG[bug.status] || STATUS_CONFIG.open;

  return (
    <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '10px', marginBottom: '8px', overflow: 'hidden', borderLeft: `3px solid ${sev.rail}` }}>
      {/* Header row */}
      <div onClick={() => setExpanded(!expanded)} style={{ padding: '1rem 1.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span className="material-symbols-outlined" style={{ color: sev.rail, fontSize: '20px', flexShrink: 0, fontVariationSettings: "'FILL' 1" }}>{sev.icon}</span>
        <span style={{ padding: '2px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, background: sev.bg, color: sev.color, textTransform: 'uppercase', flexShrink: 0 }}>
          {bug.severity}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--primary)', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bug.title}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--outline)', fontFamily: 'monospace' }}>{bug.page_url}</div>
        </div>
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
          {[
            { label: 'Description', value: bug.description },
            { label: 'Steps to Reproduce', value: bug.steps_to_reproduce },
            { label: 'Expected Behavior', value: bug.expected_behavior },
            { label: 'Actual Behavior', value: bug.actual_behavior },
          ].map(({ label, value }) => value ? (
            <div key={label} style={{ marginTop: '1rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>{label}</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--on-surface)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{value}</div>
            </div>
          ) : null)}

          {bug.screenshot_url && (
            <div style={{ marginTop: '1rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>Screenshot</div>
              <img src={bug.screenshot_url} alt="Bug screenshot" style={{ maxWidth: '100%', borderRadius: '8px', border: '1px solid var(--outline-variant)' }} />
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
  );
}

export default function BugReports() {
  const { id } = useParams();
  const [run, setRun] = useState(null);
  const [bugs, setBugs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const fetchData = useCallback(() => {
    api.get(`/runs/${id}`)
      .then(res => { setRun(res.data.run); setBugs(res.data.bugs || []); setError(null); })
      .catch(err => setError(err.response?.data?.error || err.message || 'Failed to load run'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const isActive = run && ACTIVE_STATUSES.has(run.status);
    if (isActive && !pollRef.current) pollRef.current = setInterval(fetchData, 5000);
    else if (!isActive && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [run, fetchData]);

  const handleStatusChange = async (bugId, status) => {
    try { await api.put(`/bugs/${bugId}/status`, { status }); fetchData(); }
    catch (err) { setError(err.response?.data?.error || err.message || 'Failed to update status'); }
  };

  const FILTERS = ['all', 'critical', 'high', 'medium', 'low'];
  const filtered = filter === 'all' ? bugs : bugs.filter(b => b.severity === filter);
  const countBySev = (s) => bugs.filter(b => b.severity === s).length;

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--on-surface-variant)', padding: '2rem 0' }}>
      <span className="material-symbols-outlined pulse" style={{ color: 'var(--secondary)' }}>autorenew</span> Loading...
    </div>
  );

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: '2rem' }}>
        <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--on-tertiary-container)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '6px' }}>Vulnerability Report</span>
        <h2 style={{ fontSize: '2.25rem', fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--primary)', marginBottom: '6px' }}>Bug Reports</h2>
        {run && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.875rem', color: 'var(--on-surface-variant)' }}>
              <strong style={{ color: 'var(--on-surface)' }}>{run.app_name}</strong>
            </span>
            <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: 'var(--outline)' }} />
            <span style={{ padding: '2px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, background: run.status === 'completed' ? '#f0fdf4' : run.status === 'failed' ? 'var(--error-container)' : 'rgba(0,88,190,0.08)', color: run.status === 'completed' ? '#16a34a' : run.status === 'failed' ? 'var(--error)' : 'var(--secondary)', textTransform: 'uppercase' }}>
              {run.status}
            </span>
            <span style={{ fontSize: '0.875rem', color: 'var(--on-surface-variant)' }}>{bugs.length} bug{bugs.length !== 1 ? 's' : ''} found</span>
          </div>
        )}
      </div>

      {error && (
        <div style={{ background: 'var(--error-container)', color: 'var(--error)', padding: '12px 16px', borderRadius: '8px', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
          <span>{error}</span>
          <button onClick={() => { setError(null); fetchData(); }} style={{ background: 'none', border: 'none', color: 'var(--error)', fontWeight: 600 }}>Retry</button>
        </div>
      )}

      {/* Severity filter pills */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {FILTERS.map(f => {
          const isActive = filter === f;
          const sev = SEVERITY_CONFIG[f];
          return (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '6px 14px', borderRadius: '999px', fontSize: '0.8rem', fontWeight: isActive ? 600 : 500,
              border: isActive ? 'none' : '1px solid var(--outline-variant)',
              background: isActive ? (sev ? sev.bg : 'var(--primary)') : 'transparent',
              color: isActive ? (sev ? sev.color : '#fff') : 'var(--on-surface-variant)',
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
          <p style={{ fontWeight: 500, color: 'var(--on-surface)', marginBottom: '4px' }}>{filter === 'all' ? 'No bugs found!' : `No ${filter} severity bugs`}</p>
          {filter !== 'all' && <p style={{ fontSize: '0.875rem' }}>Try selecting a different filter.</p>}
        </div>
      ) : (
        <div>
          {filtered.map(bug => <BugCard key={bug.id} bug={bug} onStatusChange={handleStatusChange} />)}
        </div>
      )}
    </div>
  );
}

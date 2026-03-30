import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import api from '../services/api.js';
import NewRunModal from './NewRunModal.jsx';

const STATUS_CONFIG = {
  pending:   { bg: '#fef3c7',               color: '#92400e',          rail: '#f59e0b',          icon: 'hourglass_empty' },
  running:   { bg: 'var(--secondary-soft)', color: 'var(--secondary)', rail: 'var(--secondary)', icon: 'play_arrow' },
  completed: { bg: '#f0fdf4',               color: '#16a34a',          rail: '#22c55e',          icon: 'check' },
  failed:    { bg: 'var(--error-container)', color: 'var(--error)',     rail: 'var(--error)',     icon: 'error_outline' },
  paused:    { bg: '#ede9fe',               color: '#5b21b6',          rail: '#7c3aed',          icon: 'pause_circle' },
  cancelled: { bg: '#fef3c7',               color: '#92400e',          rail: '#d97706',          icon: 'stop_circle' },
};

const ACTIVE_STATUSES = new Set(['pending', 'running', 'paused']);

export default function TestRuns() {
  const [searchParams, setSearchParams] = useSearchParams();
  const appIdFilter = searchParams.get('app_id') || '';

  const [runs, setRuns] = useState([]);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    api.get('/apps').then((res) => setApps(res.data.apps || [])).catch(() => setApps([]));
  }, []);

  const fetchRuns = useCallback(() => {
    const q = appIdFilter ? `?app_id=${encodeURIComponent(appIdFilter)}` : '';
    api.get(`/runs${q}`)
      .then(res => { setRuns(res.data.runs || []); setError(null); })
      .catch(err => setError(err.response?.data?.error || err.message || 'Failed to load runs'))
      .finally(() => setLoading(false));
  }, [appIdFilter]);

  useEffect(() => { fetchRuns(); }, [fetchRuns]);

  useEffect(() => {
    const hasActive = runs.some(r => ACTIVE_STATUSES.has(r.status));
    if (hasActive && !pollRef.current) pollRef.current = setInterval(fetchRuns, 5000);
    else if (!hasActive && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [runs, fetchRuns]);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this test run?')) return;
    try { await api.delete(`/runs/${id}`); fetchRuns(); }
    catch (err) { setError(err.response?.data?.error || err.message || 'Failed to delete run'); }
  };

  const handleStop = async (id) => {
    try { await api.post(`/runs/${id}/stop`); fetchRuns(); }
    catch (err) { setError(err.response?.data?.error || err.message || 'Failed to stop run'); }
  };

  const completed = runs.filter(r => r.status === 'completed').length;
  const successRate = runs.length > 0 ? Math.round((completed / runs.length) * 100) : 0;
  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: '6px' }}>Audit history</span>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--primary)' }}>Test runs</h1>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          <label style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            App
            <select
              value={appIdFilter}
              onChange={(e) => {
                const v = e.target.value;
                const next = new URLSearchParams(searchParams);
                if (v) next.set('app_id', v);
                else next.delete('app_id');
                setSearchParams(next);
              }}
              className="ent-input"
              style={{ minWidth: '200px', padding: '8px 12px', borderRadius: '8px', fontSize: '0.875rem', border: '1px solid var(--border-subtle)', background: 'var(--surface-container-lowest)', color: 'var(--on-surface)' }}
            >
              <option value="">All apps</option>
              {apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.url || a.id}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => setShowModal(true)} className="btn-primary">
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>play_arrow</span>
            Start new run
          </button>
        </div>
      </div>

      {/* Stats banner */}
      {runs.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1.25rem', marginBottom: '2rem' }}>
          <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '8px', padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', overflow: 'hidden', position: 'relative', border: '1px solid var(--border-subtle)' }}>
            <div>
              <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--on-surface-variant)', marginBottom: '8px' }}>Success rate</p>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                <span style={{ fontSize: '2.75rem', fontWeight: 300, letterSpacing: '-0.03em', color: 'var(--primary)' }}>{successRate}%</span>
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--secondary)' }}>{completed} of {runs.length} runs</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '64px' }}>
              {[0.5, 0.65, 0.5, 0.8, 1].map((h, i) => (
                <div key={i} style={{ width: '16px', background: `rgba(13, 115, 119, ${0.15 + h * 0.25})`, height: `${h * 100}%`, borderRadius: '3px 3px 0 0' }} />
              ))}
            </div>
            <div style={{ position: 'absolute', right: '-48px', top: '-48px', width: '200px', height: '200px', background: 'rgba(13, 115, 119, 0.06)', borderRadius: '50%', filter: 'blur(40px)' }} />
          </div>
          <div style={{ background: 'var(--primary-button)', color: '#fff', borderRadius: '8px', padding: '1.5rem 2rem', minWidth: '220px' }}>
            <p style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.6, marginBottom: '8px' }}>Total Bugs Found</p>
            <span style={{ fontSize: '2.75rem', fontWeight: 300, letterSpacing: '-0.03em', display: 'block' }}>
              {runs.reduce((sum, r) => sum + Number(r.bug_count ?? 0), 0)}
            </span>
            <p style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '4px' }}>Across {runs.length} test runs</p>
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: 'var(--error-container)', color: 'var(--error)', padding: '12px 16px', borderRadius: '8px', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
          <span>{error}</span>
          <button onClick={() => { setError(null); fetchRuns(); }} style={{ background: 'none', border: 'none', color: 'var(--error)', fontWeight: 600 }}>Retry</button>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--on-surface-variant)', padding: '2rem 0' }}>
          <span className="material-symbols-outlined pulse" style={{ color: 'var(--link)' }}>autorenew</span> Loading...
        </div>
      ) : (
        <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '8px', padding: '0', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 160px 100px 90px 80px', padding: '12px 20px', fontSize: '10px', fontWeight: 700, color: 'var(--on-surface)', textTransform: 'uppercase', letterSpacing: '0.12em', background: 'var(--table-header-bg)', borderBottom: '1px solid var(--border-subtle)' }}>
            <span>Run / App</span>
            <span style={{ textAlign: 'center' }}>Status</span>
            <span>Start Time</span>
            <span>Duration</span>
            <span style={{ textAlign: 'right' }}>Bugs</span>
            <span />
          </div>

          {runs.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--on-surface-variant)', background: 'var(--surface-container-lowest)', borderRadius: '10px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '40px', color: 'var(--outline-variant)', display: 'block', marginBottom: '12px' }}>flaky</span>
              No test runs yet. Start your first run.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {runs.map((run, idx) => {
                const cfg = STATUS_CONFIG[run.status] || STATUS_CONFIG.pending;
                const duration = run.started_at && run.completed_at
                  ? (() => { const s = Math.round((new Date(run.completed_at) - new Date(run.started_at)) / 1000); return s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`; })()
                  : '—';
                const isRowActive = ACTIVE_STATUSES.has(run.status);
                return (
                  <div key={run.id} className={`hoverable-card${isRowActive ? ' active-run' : ''}`} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 160px 100px 90px 80px', alignItems: 'center', padding: '16px 20px', background: isRowActive ? undefined : 'var(--surface-container-lowest)', borderBottom: idx < runs.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div
                        className={isRowActive ? 'scan-bar' : ''}
                        style={{ width: '4px', height: '32px', background: cfg.rail, borderRadius: '2px', flexShrink: 0 }}
                      />
                      <div>
                        <Link to={`/runs/${run.id}`} style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--link)' }}>#{run.id?.toString().slice(-4) || '—'}</Link>
                        <div style={{ fontSize: '0.875rem', color: 'var(--on-surface-variant)', marginTop: '2px' }}>{run.app_name || '—'}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, background: cfg.bg, color: cfg.color, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {isRowActive && <span className="pulse" style={{ width: '5px', height: '5px', borderRadius: '50%', background: cfg.rail, display: 'inline-block', flexShrink: 0 }} />}
                        <span className="material-symbols-outlined" style={{ fontSize: '11px', fontVariationSettings: "'wght' 700" }}>{cfg.icon}</span>
                        {run.status?.toUpperCase()}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)' }}>
                      {run.started_at ? formatDistanceToNow(new Date(run.started_at), { addSuffix: true }) : '—'}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)' }}>{duration}</span>
                    <span style={{ fontSize: '1.25rem', fontWeight: 300, color: 'var(--primary)', textAlign: 'right' }}>{Number(run.bug_count ?? 0)}</span>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px' }}>
                      {isRowActive ? (
                        <button onClick={() => handleStop(run.id)}
                          style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px', background: 'var(--error-container)', color: 'var(--error)', border: '1px solid var(--error)', cursor: 'pointer' }}
                          title="Stop this run">
                          <span className="material-symbols-outlined" style={{ fontSize: '13px' }}>stop</span>
                          Stop
                        </button>
                      ) : (
                        <button onClick={() => handleDelete(run.id)} style={{ padding: '6px', background: 'none', border: 'none', color: 'var(--outline)' }} title="Delete">
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination info */}
          {runs.length > 0 && (
            <div style={{ padding: '12px 20px', fontSize: '0.75rem', color: 'var(--on-surface-variant)', textAlign: 'left', marginTop: '4px' }}>
              Showing {runs.length} test run{runs.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}

      {showModal && (
        <NewRunModal onClose={() => setShowModal(false)} onCreated={() => { setShowModal(false); fetchRuns(); }} />
      )}
    </div>
  );
}

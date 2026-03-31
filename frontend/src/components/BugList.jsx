import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import api from '../services/api.js';

const SEVERITY_STYLE = {
  critical: { bg: 'var(--error-container)', color: 'var(--error)' },
  high:     { bg: '#fef3c7', color: '#92400e' },
  medium:   { bg: 'var(--secondary-soft)', color: 'var(--secondary)' },
  low:      { bg: 'var(--surface-container-high)', color: 'var(--on-surface-variant)' },
};

export default function BugList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const appId = searchParams.get('app_id') || '';
  const severityFilter = searchParams.get('severity') || '';

  const [bugs, setBugs] = useState([]);
  const [total, setTotal] = useState(0);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    if (appId) p.set('app_id', appId);
    if (severityFilter) p.set('severity', severityFilter);
    p.set('limit', '100');
    return p.toString();
  }, [appId, severityFilter]);

  const fetchBugs = useCallback(() => {
    setLoading(true);
    api
      .get(`/bugs?${queryString}`)
      .then((res) => {
        setBugs(res.data.bugs || []);
        setTotal(res.data.total ?? res.data.bugs?.length ?? 0);
        setError(null);
      })
      .catch((err) => setError(err.response?.data?.error || err.message || 'Failed to load bugs'))
      .finally(() => setLoading(false));
  }, [queryString]);

  useEffect(() => {
    api.get('/apps').then((res) => setApps(res.data.apps || [])).catch(() => setApps([]));
  }, []);

  useEffect(() => {
    fetchBugs();
  }, [fetchBugs]);

  const handleAppChange = (e) => {
    const v = e.target.value;
    const next = new URLSearchParams(searchParams);
    if (v) next.set('app_id', v);
    else next.delete('app_id');
    setSearchParams(next);
  };

  const handleSeverityChange = (e) => {
    const v = e.target.value;
    const next = new URLSearchParams(searchParams);
    if (v) next.set('severity', v);
    else next.delete('severity');
    setSearchParams(next);
  };

  const titleSuffix =
    severityFilter === 'critical'
      ? ' — Critical'
      : severityFilter
        ? ` — ${severityFilter.charAt(0).toUpperCase()}${severityFilter.slice(1)}`
        : '';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: '6px' }}>Findings</span>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--primary)' }}>
            Bug reports{titleSuffix}
          </h1>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
          <label style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            App
            <select
              value={appId}
              onChange={handleAppChange}
              className="ent-input"
              style={{ minWidth: '180px', padding: '8px 12px', borderRadius: '8px', fontSize: '0.875rem', border: '1px solid var(--border-subtle)', background: 'var(--surface-container-lowest)', color: 'var(--on-surface)' }}
            >
              <option value="">All apps</option>
              {apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.url || a.id}
                </option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            Severity
            <select
              value={severityFilter}
              onChange={handleSeverityChange}
              className="ent-input"
              style={{ minWidth: '140px', padding: '8px 12px', borderRadius: '8px', fontSize: '0.875rem', border: '1px solid var(--border-subtle)', background: 'var(--surface-container-lowest)', color: 'var(--on-surface)' }}
            >
              <option value="">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
        </div>
      </div>

      {error && (
        <div style={{ background: 'var(--error-container)', color: 'var(--error)', padding: '12px 16px', borderRadius: '8px', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
          <span>{error}</span>
          <button type="button" onClick={() => { setError(null); fetchBugs(); }} style={{ background: 'none', border: 'none', color: 'var(--error)', fontWeight: 600 }}>
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--on-surface-variant)', padding: '2rem 0' }}>
          <span className="material-symbols-outlined pulse" style={{ color: 'var(--link)' }}>
            autorenew
          </span>
          Loading bugs...
        </div>
      ) : (
        <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '8px', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.5fr) 120px 140px 100px',
              padding: '12px 20px',
              fontSize: '10px',
              fontWeight: 700,
              color: 'var(--on-surface)',
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              background: 'var(--table-header-bg)',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <span>Title</span>
            <span>Severity</span>
            <span>Application</span>
            <span style={{ textAlign: 'right' }}>Reported</span>
          </div>
          {bugs.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--on-surface-variant)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '40px', color: 'var(--outline-variant)', display: 'block', marginBottom: '12px' }}>
                pest_control
              </span>
              No bugs match the current filters.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {bugs.map((bug, idx) => {
                const sev = bug.severity || 'medium';
                const badge = SEVERITY_STYLE[sev] || SEVERITY_STYLE.medium;
                return (
                  <div
                    key={bug.id}
                    className="hoverable-card"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1.5fr) 120px 140px 100px',
                      alignItems: 'center',
                      padding: '14px 20px',
                      borderBottom: idx < bugs.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      gap: '8px',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <Link to={`/runs/${bug.run_id}`} style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--link)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={bug.title}>
                        {bug.title || 'Untitled'}
                      </Link>
                      <span style={{ fontSize: '0.7rem', color: 'var(--outline)' }}>Run #{bug.run_id?.toString?.().slice(-6) || '—'}</span>
                    </div>
                    <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, background: badge.bg, color: badge.color, justifySelf: 'start' }}>
                      {sev}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={bug.app_name}>
                      {bug.app_name || '—'}
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)', textAlign: 'right' }}>
                      {bug.created_at ? formatDistanceToNow(new Date(bug.created_at), { addSuffix: true }) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {bugs.length > 0 && (
            <div style={{ padding: '12px 20px', fontSize: '0.75rem', color: 'var(--on-surface-variant)' }}>
              Showing {bugs.length} of {total} bug{total !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

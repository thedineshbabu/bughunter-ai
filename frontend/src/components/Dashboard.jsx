import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import api from '../services/api.js';

const STAT_CARDS = [
  { key: 'apps',     label: 'Total Apps',    icon: 'apps',         accent: 'var(--secondary)' },
  { key: 'runs',     label: 'Total Runs',    icon: 'flaky',        accent: 'var(--on-tertiary-container)' },
  { key: 'bugs',     label: 'Bugs Detected', icon: 'pest_control', accent: 'var(--outline)' },
  { key: 'critical', label: 'Critical',      icon: 'warning',      accent: 'var(--error)' },
];

const STATUS_BADGE = {
  pending:   { bg: '#fef3c7', color: '#92400e' },
  running:   { bg: 'rgba(0,88,190,0.08)', color: 'var(--secondary)' },
  completed: { bg: '#f0fdf4', color: '#16a34a' },
  failed:    { bg: 'var(--error-container)', color: 'var(--error)' },
};

export default function Dashboard() {
  const [stats, setStats] = useState({ apps: 0, runs: 0, bugs: 0, critical: 0 });
  const [recentRuns, setRecentRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(() => {
    Promise.all([
      api.get('/apps'),
      api.get('/runs?limit=5'),
      api.get('/bugs?limit=1'),
      api.get('/bugs?severity=critical&limit=1'),
    ]).then(([appsRes, runsRes, bugsRes, criticalRes]) => {
      setStats({
        apps:     appsRes.data.apps?.length || 0,
        runs:     runsRes.data.total ?? runsRes.data.runs?.length ?? 0,
        bugs:     bugsRes.data.total ?? bugsRes.data.bugs?.length ?? 0,
        critical: criticalRes.data.total ?? criticalRes.data.bugs?.filter(b => b.severity === 'critical').length ?? 0,
      });
      setRecentRuns(runsRes.data.runs || []);
      setError(null);
    }).catch(err => {
      setError(err.response?.data?.error || err.message || 'Failed to load dashboard');
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--on-surface-variant)', padding: '2rem 0' }}>
      <span className="material-symbols-outlined pulse" style={{ color: 'var(--secondary)' }}>autorenew</span>
      Loading dashboard...
    </div>
  );

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: '2.5rem' }}>
        <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--secondary)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '6px' }}>System Overview</span>
        <h2 style={{ fontSize: '2.25rem', fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--primary)' }}>Operational Intelligence</h2>
      </div>

      {error && (
        <div style={{ background: 'var(--error-container)', color: 'var(--error)', padding: '12px 16px', borderRadius: '8px', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
          <span>{error}</span>
          <button onClick={() => { setError(null); fetchData(); }} style={{ background: 'none', border: 'none', color: 'var(--error)', fontWeight: 600 }}>Retry</button>
        </div>
      )}

      {/* KPI grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', marginBottom: '2.5rem' }}>
        {STAT_CARDS.map(({ key, label, icon, accent }) => (
          <div key={key} style={{ background: 'var(--surface-container-lowest)', borderRadius: '12px', padding: '1.5rem', borderLeft: `4px solid ${accent}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
              <span className="material-symbols-outlined" style={{ color: accent, fontSize: '20px', fontVariationSettings: key === 'critical' ? "'FILL' 1" : undefined }}>{icon}</span>
            </div>
            <div style={{ fontSize: '2.5rem', fontWeight: 300, letterSpacing: '-0.03em', color: key === 'critical' && stats[key] > 0 ? 'var(--error)' : 'var(--primary)' }}>
              {stats[key]}
            </div>
          </div>
        ))}
      </div>

      {/* Recent runs */}
      <div style={{ background: 'var(--surface-container-low)', borderRadius: '16px', padding: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem 0.75rem' }}>
          <h3 style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Recent Test Runs</h3>
          <Link to="/runs" style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            View all <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_forward</span>
          </Link>
        </div>

        {recentRuns.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--on-surface-variant)', fontSize: '0.875rem' }}>
            No test runs yet.{' '}
            <Link to="/runs" style={{ color: 'var(--secondary)', fontWeight: 500 }}>Start one →</Link>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
            {/* Header row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 80px 1fr', padding: '8px 20px', fontSize: '10px', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              <span>Application</span>
              <span style={{ textAlign: 'center' }}>Status</span>
              <span style={{ textAlign: 'right' }}>Bugs</span>
              <span style={{ paddingLeft: '1.5rem' }}>Started</span>
            </div>
            {recentRuns.map(run => {
              const badge = STATUS_BADGE[run.status] || STATUS_BADGE.pending;
              return (
                <div key={run.id} className="hoverable-card" style={{ display: 'grid', gridTemplateColumns: '1fr 120px 80px 1fr', alignItems: 'center', padding: '14px 20px', background: 'var(--surface-container-lowest)', borderRadius: '10px' }}>
                  <Link to={`/runs/${run.id}`} style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--primary)' }}>{run.app_name || '—'}</Link>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, background: badge.bg, color: badge.color, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {run.status === 'running' && <span className="pulse" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--secondary)', display: 'inline-block' }} />}
                      {run.status?.toUpperCase()}
                    </span>
                  </div>
                  <span style={{ fontSize: '1.1rem', fontWeight: 300, color: 'var(--primary)', textAlign: 'right' }}>{run.bug_count || 0}</span>
                  <span style={{ paddingLeft: '1.5rem', fontSize: '0.8rem', color: 'var(--on-surface-variant)' }}>
                    {run.started_at ? formatDistanceToNow(new Date(run.started_at), { addSuffix: true }) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import api from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';

const STAT_CARDS = [
  { key: 'apps', label: 'Total Apps', icon: 'apps', accent: 'var(--secondary)', to: '/apps', appQuery: false },
  { key: 'runs', label: 'Total Runs', icon: 'flaky', accent: 'var(--on-tertiary-container)', to: '/runs', appQuery: true },
  { key: 'bugs', label: 'Bugs Detected', icon: 'pest_control', accent: 'var(--outline)', to: '/bugs', appQuery: true },
  {
    key: 'critical',
    label: 'Critical',
    icon: 'warning',
    accent: 'var(--error)',
    to: '/bugs',
    appQuery: true,
    extraSearch: { severity: 'critical' },
  },
];

function buildTileTo(path, appId, extraSearch = {}) {
  const params = new URLSearchParams();
  if (appId) params.set('app_id', appId);
  Object.entries(extraSearch).forEach(([k, v]) => {
    if (v != null && v !== '') params.set(k, String(v));
  });
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

const STATUS_BADGE = {
  pending: { bg: '#fef3c7', color: '#92400e' },
  running: { bg: 'var(--secondary-soft)', color: 'var(--secondary)' },
  completed: { bg: '#f0fdf4', color: '#16a34a' },
  failed: { bg: 'var(--error-container)', color: 'var(--error)' },
};

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ apps: 0, runs: 0, bugs: 0, critical: 0 });
  const [recentRuns, setRecentRuns] = useState([]);
  const [appsList, setAppsList] = useState([]);
  const [selectedAppId, setSelectedAppId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(() => {
    setLoading(true);
    const appParam = selectedAppId ? `&app_id=${encodeURIComponent(selectedAppId)}` : '';
    Promise.all([
      api.get('/apps'),
      api.get(`/runs?limit=5${appParam}`),
      api.get(`/bugs?limit=1${appParam}`),
      api.get(`/bugs?severity=critical&limit=1${appParam}`),
    ])
      .then(([appsRes, runsRes, bugsRes, criticalRes]) => {
        const apps = appsRes.data.apps || [];
        setAppsList(apps);
        setStats({
          apps: selectedAppId ? 1 : apps.length,
          runs: runsRes.data.total ?? runsRes.data.runs?.length ?? 0,
          bugs: bugsRes.data.total ?? bugsRes.data.bugs?.length ?? 0,
          critical:
            criticalRes.data.total ??
            criticalRes.data.bugs?.filter((b) => b.severity === 'critical').length ??
            0,
        });
        setRecentRuns(runsRes.data.runs || []);
        setError(null);
      })
      .catch((err) => {
        setError(err.response?.data?.error || err.message || 'Failed to load dashboard');
      })
      .finally(() => setLoading(false));
  }, [selectedAppId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--on-surface-variant)', padding: '2rem 0' }}>
        <span className="material-symbols-outlined pulse" style={{ color: 'var(--link)' }}>
          autorenew
        </span>
        Loading dashboard...
      </div>
    );
  }

  const firstName = (user?.name || user?.email || 'there').split(/\s+/)[0];

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--primary)', marginBottom: '6px' }}>
          Hi, {firstName}.
        </h1>
        <p style={{ fontSize: '0.9375rem', color: 'var(--on-surface-variant)', maxWidth: '520px' }}>
          Access security testing and audit results for your applications in one place.
        </p>
      </div>

      <div className="info-banner" role="status">
        <span className="material-symbols-outlined info-banner__icon">info</span>
        <span>
          Test runs execute autonomous browser exploration against your registered apps. Critical findings appear in bug reports with evidence and screenshots.
        </span>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <span
          style={{
            display: 'block',
            fontSize: '11px',
            fontWeight: 700,
            color: 'var(--on-surface-variant)',
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            marginBottom: '6px',
          }}
        >
          System overview
        </span>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--primary)' }}>Operational intelligence</h2>
      </div>

      {error && (
        <div
          style={{
            background: 'var(--error-container)',
            color: 'var(--error)',
            padding: '12px 16px',
            borderRadius: '8px',
            marginBottom: '1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.875rem',
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              fetchData();
            }}
            style={{ background: 'none', border: 'none', color: 'var(--error)', fontWeight: 600 }}
          >
            Retry
          </button>
        </div>
      )}

      <div
        style={{
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <label
          htmlFor="dashboard-app-filter"
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--on-surface-variant)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          Filter by app
          <select
            id="dashboard-app-filter"
            value={selectedAppId}
            onChange={(e) => {
              setLoading(true);
              setSelectedAppId(e.target.value);
            }}
            className="ent-input"
            style={{
              minWidth: '220px',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '0.875rem',
              border: '1px solid var(--border-subtle)',
              background: 'var(--surface-container-lowest)',
              color: 'var(--on-surface)',
            }}
          >
            <option value="">All apps</option>
            {appsList.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.url || a.id}
              </option>
            ))}
          </select>
        </label>
        {selectedAppId && (
          <span style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)' }}>Metrics below reflect this app only.</span>
        )}
      </div>

      {/* KPI grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1.25rem',
          marginBottom: '2.5rem',
        }}
      >
        {STAT_CARDS.map(({ key, label, icon, accent, to, appQuery, extraSearch }) => {
          const linkTo = appQuery ? buildTileTo(to, selectedAppId, extraSearch || {}) : to;
          return (
            <Link
              key={key}
              to={linkTo}
              className="hoverable-card dashboard-kpi-tile"
              style={{
                background: 'var(--surface-container-lowest)',
                borderRadius: '8px',
                padding: '1.5rem',
                border: '1px solid var(--border-subtle)',
                borderLeft: `4px solid ${accent}`,
                textDecoration: 'none',
                color: 'inherit',
                display: 'block',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
              }}
              aria-label={`${label}: ${stats[key]}. Open details.`}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'var(--on-surface-variant)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  {label}
                </span>
                <span
                  className="material-symbols-outlined"
                  style={{ color: accent, fontSize: '20px', fontVariationSettings: key === 'critical' ? "'FILL' 1" : undefined }}
                  aria-hidden
                >
                  {icon}
                </span>
              </div>
              <div
                style={{
                  fontSize: '2.5rem',
                  fontWeight: 300,
                  letterSpacing: '-0.03em',
                  color: key === 'critical' && stats[key] > 0 ? 'var(--error)' : 'var(--primary)',
                }}
              >
                {stats[key]}
              </div>
              <div style={{ marginTop: '10px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--link)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                View details
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                  arrow_forward
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      {/* Recent runs */}
      <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '8px', padding: '8px', border: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem 0.75rem' }}>
          <h3 style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--on-surface)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Recent test runs</h3>
          <Link to={buildTileTo('/runs', selectedAppId)} style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--link)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            View all <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_forward</span>
          </Link>
        </div>

        {recentRuns.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--on-surface-variant)', fontSize: '0.875rem' }}>
            No test runs yet.{' '}
            <Link to={buildTileTo('/runs', selectedAppId)} style={{ color: 'var(--link)', fontWeight: 500 }}>
              Start one →
            </Link>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
            {/* Header row */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 120px 80px 1fr',
                padding: '10px 20px',
                fontSize: '10px',
                fontWeight: 700,
                color: 'var(--on-surface)',
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                background: 'var(--table-header-bg)',
                borderRadius: '6px 6px 0 0',
              }}
            >
              <span>Application</span>
              <span style={{ textAlign: 'center' }}>Status</span>
              <span style={{ textAlign: 'right' }}>Bugs</span>
              <span style={{ paddingLeft: '1.5rem' }}>Started</span>
            </div>
            {recentRuns.map((run) => {
              const badge = STATUS_BADGE[run.status] || STATUS_BADGE.pending;
              return (
                <div
                  key={run.id}
                  className="hoverable-card"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 120px 80px 1fr',
                    alignItems: 'center',
                    padding: '14px 20px',
                    background: 'var(--surface-container-lowest)',
                    borderRadius: '0',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <Link to={`/runs/${run.id}`} style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--link)' }}>
                    {run.app_name || '—'}
                  </Link>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <span
                      style={{
                        padding: '3px 10px',
                        borderRadius: '999px',
                        fontSize: '10px',
                        fontWeight: 700,
                        background: badge.bg,
                        color: badge.color,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      {run.status === 'running' && (
                        <span
                          className="pulse"
                          style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--link)', display: 'inline-block' }}
                        />
                      )}
                      {run.status?.toUpperCase()}
                    </span>
                  </div>
                  <span style={{ fontSize: '1.1rem', fontWeight: 300, color: 'var(--primary)', textAlign: 'right' }}>{Number(run.bug_count ?? 0)}</span>
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

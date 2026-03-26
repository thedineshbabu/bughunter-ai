import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import api from '../services/api.js';

const STATUS_COLOR = {
  pending:   { background: '#fef3c7', color: '#92400e' },
  running:   { background: '#dbeafe', color: '#1e40af' },
  completed: { background: '#d1fae5', color: '#065f46' },
  failed:    { background: '#fee2e2', color: '#991b1b' },
};

function StatCard({ label, value, icon, color }) {
  return (
    <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', borderLeft: `4px solid ${color}` }}>
      <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{icon}</div>
      <div style={{ fontSize: '2rem', fontWeight: 700, color }}>{value}</div>
      <div style={{ color: '#6b7280', fontSize: '0.9rem', marginTop: '0.25rem' }}>{label}</div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState({ apps: 0, runs: 0, bugs: 0, critical: 0 });
  const [recentRuns, setRecentRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchData = useCallback(() => {
    Promise.all([
      api.get('/apps'),
      api.get('/runs?limit=5'),
      // limit=1 minimises payload — we only need the total count
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

  if (loading) return <div>Loading dashboard...</div>;

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: 700 }}>Dashboard</h1>

      {error && (
        <div style={{ background: '#fee2e2', color: '#dc2626', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button onClick={() => { setError(null); fetchData(); }} style={{ background: 'none', border: 'none', color: '#dc2626', fontWeight: 600, cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <StatCard label="Total Apps"    value={stats.apps}     icon="🗂️" color="#6366f1" />
        <StatCard label="Total Runs"    value={stats.runs}     icon="▶️"  color="#0ea5e9" />
        <StatCard label="Total Bugs"    value={stats.bugs}     icon="🐛" color="#f59e0b" />
        <StatCard label="Critical Bugs" value={stats.critical} icon="🔴" color="#ef4444" />
      </div>

      <div style={{ background: '#fff', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}>
        <h2 style={{ marginBottom: '1rem', fontSize: '1.1rem', fontWeight: 600 }}>Recent Test Runs</h2>
        {recentRuns.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No test runs yet. <Link to="/runs" style={{ color: '#6366f1' }}>Start one →</Link></p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #f3f4f6' }}>
                {['App', 'Status', 'Bugs', 'Started'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '0.5rem 0.75rem', color: '#6b7280', fontSize: '0.85rem', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentRuns.map(run => (
                <tr key={run.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.75rem' }}><Link to={`/runs/${run.id}`} style={{ color: '#4f46e5', fontWeight: 500 }}>{run.app_name || run.app_id}</Link></td>
                  <td style={{ padding: '0.75rem' }}>
                    <span style={{ padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 600, ...(STATUS_COLOR[run.status] || {}) }}>
                      {run.status}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem' }}>{run.bug_count || 0}</td>
                  <td style={{ padding: '0.75rem', color: '#6b7280', fontSize: '0.9rem' }}>
                    {run.started_at ? formatDistanceToNow(new Date(run.started_at), { addSuffix: true }) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

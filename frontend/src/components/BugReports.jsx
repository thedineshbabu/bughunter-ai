import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import api from '../services/api.js';

const ACTIVE_STATUSES = new Set(['pending', 'running']);

const SEVERITY_STYLE = {
  critical: { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' },
  high:     { background: '#ffedd5', color: '#9a3412', border: '1px solid #fed7aa' },
  medium:   { background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' },
  low:      { background: '#d1fae5', color: '#065f46', border: '1px solid #6ee7b7' },
};

const STATUS_STYLE = {
  open:      { background: '#dbeafe', color: '#1e40af' },
  confirmed: { background: '#ede9fe', color: '#5b21b6' },
  fixed:     { background: '#d1fae5', color: '#065f46' },
  wontfix:   { background: '#f3f4f6', color: '#6b7280' },
};

function BugCard({ bug, onStatusChange }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', marginBottom: '0.75rem', overflow: 'hidden' }}>
      <div onClick={() => setExpanded(!expanded)} style={{ padding: '1rem 1.25rem', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
        <span style={{ padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap', ...SEVERITY_STYLE[bug.severity] }}>
          {bug.severity?.toUpperCase()}
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{bug.title}</div>
          <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>{bug.page_url}</div>
        </div>
        <span style={{ padding: '0.2rem 0.6rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600, ...STATUS_STYLE[bug.status] }}>
          {bug.status}
        </span>
        <span style={{ color: '#9ca3af', fontSize: '1.1rem' }}>{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div style={{ padding: '0 1.25rem 1.25rem', borderTop: '1px solid #f3f4f6' }}>
          {[
            { label: 'Description', value: bug.description },
            { label: 'Steps to Reproduce', value: bug.steps_to_reproduce },
            { label: 'Expected Behavior', value: bug.expected_behavior },
            { label: 'Actual Behavior', value: bug.actual_behavior },
          ].map(({ label, value }) => value ? (
            <div key={label} style={{ marginTop: '1rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#374151', marginBottom: '0.35rem' }}>{label}</div>
              <div style={{ fontSize: '0.9rem', color: '#4b5563', whiteSpace: 'pre-wrap' }}>{value}</div>
            </div>
          ) : null)}

          {bug.screenshot_url && (
            <div style={{ marginTop: '1rem' }}>
              <div style={{ fontWeight: 600, fontSize: '0.875rem', marginBottom: '0.5rem' }}>Screenshot</div>
              <img src={bug.screenshot_url} alt="Bug screenshot" style={{ maxWidth: '100%', borderRadius: '6px', border: '1px solid #e5e7eb' }} />
            </div>
          )}

          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.875rem', color: '#6b7280', alignSelf: 'center' }}>Update status:</span>
            {['open', 'confirmed', 'fixed', 'wontfix'].map(s => (
              <button key={s} onClick={() => onStatusChange(bug.id, s)} disabled={bug.status === s}
                style={{ padding: '0.3rem 0.7rem', borderRadius: '6px', fontSize: '0.8rem', border: '1px solid #d1d5db', background: bug.status === s ? '#6366f1' : '#fff', color: bug.status === s ? '#fff' : '#374151', cursor: bug.status === s ? 'default' : 'pointer' }}>
                {s}
              </button>
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
      .then(res => {
        setRun(res.data.run);
        setBugs(res.data.bugs || []);
        setError(null);
      })
      .catch(err => setError(err.response?.data?.error || err.message || 'Failed to load run'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-poll every 5s while run is pending/running
  useEffect(() => {
    const isActive = run && ACTIVE_STATUSES.has(run.status);
    if (isActive && !pollRef.current) {
      pollRef.current = setInterval(fetchData, 5000);
    } else if (!isActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [run, fetchData]);

  const handleStatusChange = async (bugId, status) => {
    try {
      await api.put(`/bugs/${bugId}/status`, { status });
      fetchData();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to update status');
    }
  };

  const filtered = filter === 'all' ? bugs : bugs.filter(b => b.severity === filter);

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Bug Reports</h1>
        {run && <p style={{ color: '#6b7280', marginTop: '0.25rem' }}>Run for <strong>{run.app_name}</strong> · {run.status} · {bugs.length} bugs found</p>}
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#dc2626', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button onClick={() => { setError(null); fetchData(); }} style={{ background: 'none', border: 'none', color: '#dc2626', fontWeight: 600, cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {['all', 'critical', 'high', 'medium', 'low'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '0.4rem 0.9rem', borderRadius: '999px', border: '1px solid #d1d5db', background: filter === f ? '#4f46e5' : '#fff', color: filter === f ? '#fff' : '#374151', fontWeight: filter === f ? 600 : 400, fontSize: '0.875rem', cursor: 'pointer' }}>
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '12px', padding: '3rem', textAlign: 'center', color: '#6b7280' }}>
          {filter === 'all' ? '🎉 No bugs found!' : `No ${filter} bugs.`}
        </div>
      ) : (
        filtered.map(bug => <BugCard key={bug.id} bug={bug} onStatusChange={handleStatusChange} />)
      )}
    </div>
  );
}

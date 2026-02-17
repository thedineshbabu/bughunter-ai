import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import api from '../services/api.js';
import NewRunModal from './NewRunModal.jsx';

const STATUS_STYLE = {
  pending:   { background: '#fef3c7', color: '#92400e' },
  running:   { background: '#dbeafe', color: '#1e40af' },
  completed: { background: '#d1fae5', color: '#065f46' },
  failed:    { background: '#fee2e2', color: '#991b1b' },
};

export default function TestRuns() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const fetchRuns = () => {
    api.get('/runs').then(res => setRuns(res.data.runs || [])).finally(() => setLoading(false));
  };

  useEffect(fetchRuns, []);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this test run?')) return;
    await api.delete(`/runs/${id}`);
    fetchRuns();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Test Runs</h1>
        <button onClick={() => setShowModal(true)} style={{ padding: '0.65rem 1.25rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600 }}>
          ▶ New Run
        </button>
      </div>

      {loading ? <div>Loading...</div> : (
        <div style={{ background: '#fff', borderRadius: '12px', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', overflow: 'hidden' }}>
          {runs.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#6b7280' }}>No test runs yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '2px solid #f3f4f6' }}>
                  {['App', 'Status', 'Bugs', 'Started', 'Duration', ''].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '0.75rem 1rem', color: '#6b7280', fontSize: '0.85rem', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {runs.map(run => {
                  const duration = run.started_at && run.completed_at
                    ? `${Math.round((new Date(run.completed_at) - new Date(run.started_at)) / 1000)}s`
                    : '—';
                  return (
                    <tr key={run.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <Link to={`/runs/${run.id}`} style={{ color: '#4f46e5', fontWeight: 500 }}>{run.app_name || '—'}</Link>
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span style={{ padding: '0.2rem 0.65rem', borderRadius: '999px', fontSize: '0.8rem', fontWeight: 600, ...STATUS_STYLE[run.status] }}>
                          {run.status}
                        </span>
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>{run.bug_count || 0}</td>
                      <td style={{ padding: '0.85rem 1rem', color: '#6b7280', fontSize: '0.875rem' }}>
                        {run.started_at ? formatDistanceToNow(new Date(run.started_at), { addSuffix: true }) : '—'}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', color: '#6b7280', fontSize: '0.875rem' }}>{duration}</td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <button onClick={() => handleDelete(run.id)} style={{ padding: '0.35rem 0.7rem', border: '1px solid #fca5a5', borderRadius: '6px', color: '#dc2626', background: '#fff', fontSize: '0.8rem' }}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showModal && (
        <NewRunModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); fetchRuns(); }}
        />
      )}
    </div>
  );
}

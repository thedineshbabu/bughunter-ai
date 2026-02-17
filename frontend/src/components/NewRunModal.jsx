import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';

export default function NewRunModal({ onClose, onCreated }) {
  const [apps, setApps] = useState([]);
  const [appId, setAppId] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/apps').then(res => {
      const list = res.data.apps || [];
      setApps(list);
      if (list.length > 0) setAppId(list[0].id);
    });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!appId) return setError('Please select an app');
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/runs', { app_id: appId, notes });
      onCreated?.();
      navigate(`/runs/${res.data.run.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create run');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '2rem', width: '100%', maxWidth: '440px' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>▶ Start New Test Run</h2>
        <p style={{ color: '#6b7280', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
          The AI agent will autonomously explore and test your app.
        </p>

        {error && <div style={{ background: '#fee2e2', color: '#dc2626', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem' }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 500, fontSize: '0.9rem' }}>Select App</label>
            {apps.length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: '0.875rem' }}>No apps registered. <a href="/apps" style={{ color: '#4f46e5' }}>Add one first →</a></p>
            ) : (
              <select value={appId} onChange={e => setAppId(e.target.value)}
                style={{ width: '100%', padding: '0.65rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.9rem', background: '#fff' }}>
                {apps.map(app => (
                  <option key={app.id} value={app.id}>{app.name} — {app.url}</option>
                ))}
              </select>
            )}
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 500, fontSize: '0.9rem' }}>Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="e.g. Focus on checkout flow..."
              style={{ width: '100%', padding: '0.65rem', border: '1px solid #d1d5db', borderRadius: '6px', resize: 'vertical', fontSize: '0.9rem' }} />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff' }}>Cancel</button>
            <button type="submit" disabled={loading || apps.length === 0}
              style={{ flex: 1, padding: '0.75rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600 }}>
              {loading ? 'Starting...' : '▶ Start Run'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

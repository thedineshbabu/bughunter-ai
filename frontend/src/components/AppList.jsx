import React, { useEffect, useState } from 'react';
import api from '../services/api.js';

function AppModal({ app, onClose, onSave }) {
  const [form, setForm] = useState({
    name: app?.name || '',
    url: app?.url || '',
    username: app?.credentials?.username || '',
    password: app?.credentials?.password || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        url: form.url,
        credentials: form.username || form.password ? { username: form.username, password: form.password } : undefined,
      };
      if (app) {
        await api.put(`/apps/${app.id}`, payload);
      } else {
        await api.post('/apps', payload);
      }
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save app');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
      <div style={{ background: '#fff', borderRadius: '12px', padding: '2rem', width: '100%', maxWidth: '480px' }}>
        <h2 style={{ marginBottom: '1.5rem' }}>{app ? 'Edit App' : 'Add New App'}</h2>
        {error && <div style={{ background: '#fee2e2', color: '#dc2626', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem' }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          {[{ label: 'App Name', key: 'name', type: 'text', required: true },
            { label: 'URL', key: 'url', type: 'url', required: true },
            { label: 'Username (optional)', key: 'username', type: 'text' },
            { label: 'Password (optional)', key: 'password', type: 'password' }
          ].map(({ label, key, type, required }) => (
            <div key={key} style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', marginBottom: '0.35rem', fontWeight: 500, fontSize: '0.9rem' }}>{label}</label>
              <input type={type} required={required} value={form[key]}
                onChange={e => setForm({ ...form, [key]: e.target.value })}
                style={{ width: '100%', padding: '0.65rem', border: '1px solid #d1d5db', borderRadius: '6px' }} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff' }}>Cancel</button>
            <button type="submit" disabled={loading} style={{ flex: 1, padding: '0.75rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 600 }}>
              {loading ? 'Saving...' : 'Save App'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AppList() {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | 'new' | app object

  const fetchApps = () => {
    api.get('/apps').then(res => setApps(res.data.apps || [])).finally(() => setLoading(false));
  };

  useEffect(fetchApps, []);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this app and all its test runs?')) return;
    await api.delete(`/apps/${id}`);
    fetchApps();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Registered Apps</h1>
        <button onClick={() => setModal('new')} style={{ padding: '0.65rem 1.25rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600 }}>
          + Add App
        </button>
      </div>

      {loading ? <div>Loading...</div> : apps.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '12px', padding: '3rem', textAlign: 'center', color: '#6b7280' }}>
          No apps yet. Add your first app to start testing.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {apps.map(app => (
            <div key={app.id} style={{ background: '#fff', borderRadius: '12px', padding: '1.25rem 1.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.07)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600 }}>{app.name}</div>
                <a href={app.url} target="_blank" rel="noopener noreferrer" style={{ color: '#6366f1', fontSize: '0.875rem' }}>{app.url}</a>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => setModal(app)} style={{ padding: '0.5rem 0.9rem', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', fontSize: '0.875rem' }}>Edit</button>
                <button onClick={() => handleDelete(app.id)} style={{ padding: '0.5rem 0.9rem', border: '1px solid #fca5a5', borderRadius: '6px', background: '#fff', color: '#dc2626', fontSize: '0.875rem' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <AppModal
          app={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); fetchApps(); }}
        />
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import api from '../services/api.js';

const EMPTY_STEP = { action: 'fill', selector: '', value: '', timeout: 15000 };

const inputStyle = { width: '100%', padding: '0.65rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.9rem' };
const labelStyle = { display: 'block', marginBottom: '0.35rem', fontWeight: 500, fontSize: '0.9rem' };
const sectionStyle = { background: '#f9fafb', borderRadius: '8px', padding: '1rem', marginBottom: '1rem', border: '1px solid #e5e7eb' };

function LoginFlowBuilder({ steps, onChange }) {
  const addStep = () => onChange([...steps, { ...EMPTY_STEP }]);
  const removeStep = (i) => onChange(steps.filter((_, idx) => idx !== i));
  const updateStep = (i, field, val) => {
    const updated = [...steps];
    updated[i] = { ...updated[i], [field]: val };
    onChange(updated);
  };

  return (
    <div>
      {steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '0.5rem', background: '#fff', padding: '0.75rem', borderRadius: '6px', border: '1px solid #e5e7eb' }}>
          <div style={{ flex: '0 0 auto', color: '#9ca3af', fontWeight: 600, fontSize: '0.8rem', marginTop: '0.5rem' }}>{i + 1}</div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <select value={step.action} onChange={e => updateStep(i, 'action', e.target.value)}
              style={{ ...inputStyle, padding: '0.45rem' }}>
              <option value="fill">Fill input</option>
              <option value="click">Click element</option>
              <option value="wait_for_navigation">Wait for redirect</option>
              <option value="wait_for_selector">Wait for element</option>
              <option value="wait">Wait (delay)</option>
            </select>
            {['fill', 'click', 'wait_for_selector'].includes(step.action) && (
              <input placeholder="CSS selector, e.g. input[type='email']" value={step.selector}
                onChange={e => updateStep(i, 'selector', e.target.value)}
                style={{ ...inputStyle, padding: '0.45rem', fontSize: '0.85rem' }} />
            )}
            {step.action === 'fill' && (
              <input placeholder="Value to type" value={step.value}
                onChange={e => updateStep(i, 'value', e.target.value)}
                type={step.selector?.includes('password') ? 'password' : 'text'}
                style={{ ...inputStyle, padding: '0.45rem', fontSize: '0.85rem' }} />
            )}
            {['wait_for_navigation', 'wait_for_selector', 'wait'].includes(step.action) && (
              <input type="number" placeholder="Timeout (ms)" value={step.timeout}
                onChange={e => updateStep(i, 'timeout', parseInt(e.target.value) || 15000)}
                style={{ ...inputStyle, padding: '0.45rem', fontSize: '0.85rem', maxWidth: '160px' }} />
            )}
          </div>
          <button type="button" onClick={() => removeStep(i)} title="Remove step"
            style={{ flex: '0 0 auto', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1.1rem', padding: '0.25rem' }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={addStep}
        style={{ width: '100%', padding: '0.5rem', background: '#f3f4f6', border: '1px dashed #d1d5db', borderRadius: '6px', color: '#6b7280', cursor: 'pointer', fontSize: '0.85rem' }}>
        + Add Step
      </button>
    </div>
  );
}

function AppModal({ app, onClose, onSave }) {
  // Determine initial auth mode from existing credentials
  const existingCreds = app?.credentials || {};
  const hasLoginFlow = Array.isArray(existingCreds.login_flow) && existingCreds.login_flow.length > 0;

  const [form, setForm] = useState({
    name: app?.name || '',
    url: app?.url || '',
    username: existingCreds.username || '',
    password: existingCreds.password || '',
  });
  const [authMode, setAuthMode] = useState(hasLoginFlow ? 'sso' : existingCreds.username || existingCreds.password ? 'simple' : 'none');
  const [loginSteps, setLoginSteps] = useState(
    hasLoginFlow ? existingCreds.login_flow : []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      let credentials;
      if (authMode === 'simple' && (form.username || form.password)) {
        credentials = { username: form.username, password: form.password };
      } else if (authMode === 'sso' && loginSteps.length > 0) {
        // Clean up steps: remove empty optional fields
        const cleanedSteps = loginSteps.map(step => {
          const s = { action: step.action };
          if (step.selector) s.selector = step.selector;
          if (step.value) s.value = step.value;
          if (['wait_for_navigation', 'wait_for_selector', 'wait'].includes(step.action)) {
            s.timeout = step.timeout || 15000;
          }
          return s;
        });
        credentials = { login_flow: cleanedSteps };
      }

      const payload = { name: form.name, url: form.url, credentials };
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
      <div style={{ background: '#fff', borderRadius: '12px', padding: '2rem', width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ marginBottom: '1.5rem' }}>{app ? 'Edit App' : 'Add New App'}</h2>
        {error && <div style={{ background: '#fee2e2', color: '#dc2626', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem' }}>{error}</div>}
        <form onSubmit={handleSubmit}>
          {/* App Name */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>App Name</label>
            <input type="text" required value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="My Web App"
              style={inputStyle} />
          </div>

          {/* URL */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>URL</label>
            <input type="url" required value={form.url}
              onChange={e => setForm({ ...form, url: e.target.value })}
              placeholder="https://example.com/login"
              style={inputStyle} />
          </div>

          {/* Auth Mode Selector */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>Authentication</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {[
                { value: 'none', label: 'None' },
                { value: 'simple', label: 'Simple Login' },
                { value: 'sso', label: 'SSO / Multi-Step' },
              ].map(opt => (
                <button key={opt.value} type="button" onClick={() => setAuthMode(opt.value)}
                  style={{
                    flex: 1, padding: '0.55rem', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 500, cursor: 'pointer',
                    border: authMode === opt.value ? '2px solid #4f46e5' : '1px solid #d1d5db',
                    background: authMode === opt.value ? '#eef2ff' : '#fff',
                    color: authMode === opt.value ? '#4f46e5' : '#374151',
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Simple Login Fields */}
          {authMode === 'simple' && (
            <div style={sectionStyle}>
              <div style={{ marginBottom: '0.75rem' }}>
                <label style={labelStyle}>Username / Email</label>
                <input type="text" value={form.username}
                  onChange={e => setForm({ ...form, username: e.target.value })}
                  placeholder="user@example.com"
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Password</label>
                <input type="password" value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                  style={inputStyle} />
              </div>
            </div>
          )}

          {/* SSO / Multi-Step Login Flow */}
          {authMode === 'sso' && (
            <div style={sectionStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Login Flow Steps</label>
                <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{loginSteps.length} step(s)</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: '0.75rem' }}>
                Define each step the agent should perform to log in (e.g. fill email → click sign in → wait for IDP → fill password → submit).
              </p>
              <LoginFlowBuilder steps={loginSteps} onChange={setLoginSteps} />
            </div>
          )}

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
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null); // null | 'new' | app object

  const fetchApps = React.useCallback(() => {
    api.get('/apps')
      .then(res => { setApps(res.data.apps || []); setError(null); })
      .catch(err => setError(err.response?.data?.error || err.message || 'Failed to load apps'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(fetchApps, [fetchApps]);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this app and all its test runs?')) return;
    try {
      await api.delete(`/apps/${id}`);
      fetchApps();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete app');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Registered Apps</h1>
        <button onClick={() => setModal('new')} style={{ padding: '0.65rem 1.25rem', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 600 }}>
          + Add App
        </button>
      </div>

      {error && (
        <div style={{ background: '#fee2e2', color: '#dc2626', padding: '0.75rem 1rem', borderRadius: '8px', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button onClick={() => { setError(null); fetchApps(); }} style={{ background: 'none', border: 'none', color: '#dc2626', fontWeight: 600, cursor: 'pointer' }}>Retry</button>
        </div>
      )}

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

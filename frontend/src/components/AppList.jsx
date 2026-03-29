import React, { useEffect, useState } from 'react';
import api from '../services/api.js';

const EMPTY_STEP = { action: 'fill', selector: '', value: '', timeout: 15000 };

const inputStyle = {
  width: '100%', padding: '10px 12px',
  background: 'var(--surface-container-lowest)',
  border: '1px solid rgba(197,198,207,0.3)',
  borderRadius: '8px', fontSize: '0.875rem',
  color: 'var(--on-surface)', boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block', marginBottom: '6px',
  fontSize: '0.7rem', fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: '0.08em',
  color: 'var(--on-surface-variant)',
};

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
        <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '8px', background: 'var(--surface-container-lowest)', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(197,198,207,0.2)' }}>
          <div style={{ flex: '0 0 auto', color: 'var(--outline)', fontWeight: 700, fontSize: '0.75rem', marginTop: '8px', minWidth: '16px' }}>{i + 1}</div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <select value={step.action} onChange={e => updateStep(i, 'action', e.target.value)} className="ent-input" style={{ ...inputStyle, padding: '8px 36px 8px 12px' }}>
              <option value="fill">Fill input</option>
              <option value="click">Click element</option>
              <option value="wait_for_navigation">Wait for redirect</option>
              <option value="wait_for_selector">Wait for element</option>
              <option value="wait">Wait (delay)</option>
            </select>
            {['fill', 'click', 'wait_for_selector'].includes(step.action) && (
              <input placeholder="CSS selector, e.g. input[type='email']" value={step.selector}
                onChange={e => updateStep(i, 'selector', e.target.value)} className="ent-input" style={{ ...inputStyle, fontSize: '0.8rem' }} />
            )}
            {step.action === 'fill' && (
              <input placeholder="Value to type" value={step.value}
                onChange={e => updateStep(i, 'value', e.target.value)}
                type={step.selector?.includes('password') ? 'password' : 'text'}
                className="ent-input" style={{ ...inputStyle, fontSize: '0.8rem' }} />
            )}
            {['wait_for_navigation', 'wait_for_selector', 'wait'].includes(step.action) && (
              <input type="number" placeholder="Timeout (ms)" value={step.timeout}
                onChange={e => updateStep(i, 'timeout', parseInt(e.target.value) || 15000)}
                className="ent-input" style={{ ...inputStyle, fontSize: '0.8rem', maxWidth: '160px' }} />
            )}
          </div>
          <button type="button" onClick={() => removeStep(i)} style={{ flex: '0 0 auto', background: 'none', border: 'none', color: 'var(--error)', padding: '4px', fontSize: '18px', lineHeight: 1 }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
          </button>
        </div>
      ))}
      <button type="button" onClick={addStep} style={{ width: '100%', padding: '9px', background: 'transparent', border: '1px dashed var(--outline-variant)', borderRadius: '8px', color: 'var(--on-surface-variant)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span> Add Step
      </button>
    </div>
  );
}

function AppModal({ app, onClose, onSave }) {
  const existingCreds = app?.credentials || {};
  const hasLoginFlow = Array.isArray(existingCreds.login_flow) && existingCreds.login_flow.length > 0;
  const [form, setForm] = useState({ name: app?.name || '', url: app?.url || '', username: existingCreds.username || '', password: existingCreds.password || '' });
  const [authMode, setAuthMode] = useState(hasLoginFlow ? 'sso' : existingCreds.username || existingCreds.password ? 'simple' : 'none');
  const [loginSteps, setLoginSteps] = useState(hasLoginFlow ? existingCreds.login_flow : []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      let credentials;
      if (authMode === 'simple' && (form.username || form.password)) {
        credentials = { username: form.username, password: form.password };
      } else if (authMode === 'sso' && loginSteps.length > 0) {
        const cleanedSteps = loginSteps.map(step => {
          const s = { action: step.action };
          if (step.selector) s.selector = step.selector;
          if (step.value) s.value = step.value;
          if (['wait_for_navigation', 'wait_for_selector', 'wait'].includes(step.action)) s.timeout = step.timeout || 15000;
          return s;
        });
        credentials = { login_flow: cleanedSteps };
      }
      const payload = { name: form.name, url: form.url, credentials };
      if (app) await api.put(`/apps/${app.id}`, payload);
      else await api.post('/apps', payload);
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save app');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(25,28,30,0.3)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
      <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '14px', padding: '2rem', width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(25,28,30,0.12)' }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--primary)', marginBottom: '4px' }}>{app ? 'Edit Application' : 'Add New Application'}</h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--on-surface-variant)' }}>Configure your enterprise asset for security scanning.</p>
        </div>
        {error && <div style={{ background: 'var(--error-container)', color: 'var(--error)', padding: '10px 14px', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.875rem' }}>{error}</div>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={labelStyle}>Application Name</label>
            <input type="text" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="My Web App" className="ent-input" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>URL</label>
            <input type="url" required value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/login" className="ent-input" style={inputStyle} />
          </div>

          {/* Auth mode selector */}
          <div>
            <label style={labelStyle}>Authentication</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[{ value: 'none', label: 'None' }, { value: 'simple', label: 'Smart Login (Auto)' }, { value: 'sso', label: 'SSO / Multi-Step' }].map(opt => (
                <button key={opt.value} type="button" onClick={() => setAuthMode(opt.value)} style={{
                  flex: 1, padding: '9px 6px', borderRadius: '8px', fontSize: '0.8rem', fontWeight: 500,
                  border: authMode === opt.value ? '2px solid var(--secondary)' : '1px solid var(--outline-variant)',
                  background: authMode === opt.value ? 'rgba(0,88,190,0.06)' : 'transparent',
                  color: authMode === opt.value ? 'var(--secondary)' : 'var(--on-surface-variant)',
                }}>{opt.label}</button>
              ))}
            </div>
          </div>

          {authMode === 'simple' && (
            <div style={{ background: 'var(--surface-container-low)', borderRadius: '10px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={labelStyle}>Email</label>
                <input type="text" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} placeholder="user@example.com" className="ent-input" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Password</label>
                <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="••••••••" className="ent-input" style={inputStyle} />
              </div>
            </div>
          )}

          {authMode === 'sso' && (
            <div style={{ background: 'var(--surface-container-low)', borderRadius: '10px', padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ ...labelStyle, marginBottom: 0 }}>Login Flow Steps</label>
                <span style={{ fontSize: '0.75rem', color: 'var(--outline)' }}>{loginSteps.length} step(s)</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)', marginBottom: '10px' }}>
                Define each step the agent should perform to log in.
              </p>
              <LoginFlowBuilder steps={loginSteps} onChange={setLoginSteps} />
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '12px', border: '1px solid var(--outline-variant)', borderRadius: '8px', background: 'transparent', color: 'var(--on-surface)', fontSize: '0.875rem', fontWeight: 500 }}>Cancel</button>
            <button type="submit" disabled={loading} style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, var(--primary), var(--primary-container))', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Saving...' : 'Save Application'}
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
  const [modal, setModal] = useState(null);

  const fetchApps = React.useCallback(() => {
    api.get('/apps')
      .then(res => { setApps(res.data.apps || []); setError(null); })
      .catch(err => setError(err.response?.data?.error || err.message || 'Failed to load apps'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(fetchApps, [fetchApps]);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this app and all its test runs?')) return;
    try { await api.delete(`/apps/${id}`); fetchApps(); }
    catch (err) { setError(err.response?.data?.error || err.message || 'Failed to delete app'); }
  };

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2.5rem' }}>
        <div>
          <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--on-tertiary-container)', textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '6px' }}>Asset Management</span>
          <h2 style={{ fontSize: '2.25rem', fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--primary)' }}>Application Inventory</h2>
          <p style={{ color: 'var(--on-surface-variant)', marginTop: '6px', fontSize: '0.875rem', maxWidth: '480px' }}>Manage and monitor the security posture of your registered enterprise assets.</p>
        </div>
        <button onClick={() => setModal('new')} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 20px', background: 'linear-gradient(135deg, var(--primary), var(--primary-container))', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 500, fontSize: '0.875rem' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add_circle</span>
          Add Application
        </button>
      </div>

      {error && (
        <div style={{ background: 'var(--error-container)', color: 'var(--error)', padding: '12px 16px', borderRadius: '8px', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
          <span>{error}</span>
          <button onClick={() => { setError(null); fetchApps(); }} style={{ background: 'none', border: 'none', color: 'var(--error)', fontWeight: 600 }}>Retry</button>
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--on-surface-variant)', padding: '2rem 0' }}>
          <span className="material-symbols-outlined pulse" style={{ color: 'var(--secondary)' }}>autorenew</span> Loading...
        </div>
      ) : apps.length === 0 ? (
        <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '12px', padding: '4rem', textAlign: 'center', color: 'var(--on-surface-variant)' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--outline-variant)', display: 'block', marginBottom: '1rem' }}>apps</span>
          <p style={{ fontWeight: 500, marginBottom: '6px', color: 'var(--on-surface)' }}>No applications yet</p>
          <p style={{ fontSize: '0.875rem' }}>Add your first app to start security testing.</p>
        </div>
      ) : (
        <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '12px', overflow: 'hidden', border: '1px solid rgba(197,198,207,0.15)' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 160px 100px', padding: '14px 24px', background: 'var(--surface-container-low)', fontSize: '10px', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            <span>Application Name & URL</span>
            <span style={{ textAlign: 'center' }}>Auth</span>
            <span>Added</span>
            <span style={{ textAlign: 'right' }}>Actions</span>
          </div>

          {/* Rows */}
          <div>
            {apps.map((app, idx) => (
              <div key={app.id} className="hoverable-row" style={{ display: 'grid', gridTemplateColumns: '1fr 120px 160px 100px', alignItems: 'center', padding: '16px 24px', borderLeft: '3px solid var(--secondary)', borderBottom: idx < apps.length - 1 ? '1px solid var(--surface-container-low)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '6px', background: 'rgba(0,88,190,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--secondary)', fontSize: '18px' }}>cloud_done</span>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--primary)', marginBottom: '2px' }}>{app.name}</div>
                    <a href={app.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: 'var(--outline)', fontFamily: 'monospace' }}>{app.url}</a>
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  {app.credentials?.login_flow ? (
                    <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, background: 'rgba(176,141,91,0.1)', color: 'var(--on-tertiary-container)', textTransform: 'uppercase' }}>SSO</span>
                  ) : app.credentials?.username ? (
                    <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, background: 'rgba(0,88,190,0.08)', color: 'var(--secondary)', textTransform: 'uppercase' }}>Login</span>
                  ) : (
                    <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, background: 'var(--surface-container-high)', color: 'var(--on-surface-variant)', textTransform: 'uppercase' }}>None</span>
                  )}
                </div>
                <span style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)' }}>
                  {app.created_at ? new Date(app.created_at).toLocaleDateString() : '—'}
                </span>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button onClick={() => setModal(app)} style={{ padding: '6px', background: 'none', border: 'none', color: 'var(--on-surface-variant)' }} title="Edit">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>edit</span>
                  </button>
                  <button onClick={() => handleDelete(app.id)} style={{ padding: '6px', background: 'none', border: 'none', color: 'var(--error)' }} title="Delete">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{ padding: '12px 24px', background: 'var(--surface-container-low)', fontSize: '0.75rem', color: 'var(--on-surface-variant)' }}>
            Showing {apps.length} application{apps.length !== 1 ? 's' : ''}
          </div>
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

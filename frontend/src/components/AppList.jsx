import React, { useEffect, useState } from 'react';
import api from '../services/api.js';
import NewRunModal from './NewRunModal.jsx';

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
  const [blockedDomains, setBlockedDomains] = useState((existingCreds.blocked_domains || []).join('\n'));
  const [showAdvanced, setShowAdvanced] = useState((existingCreds.blocked_domains || []).length > 0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault(); setLoading(true); setError('');
    try {
      const parsedBlockedDomains = blockedDomains
        .split(/[\n,]+/)
        .map(d => d.trim().toLowerCase())
        .filter(Boolean);

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
      if (parsedBlockedDomains.length > 0) {
        credentials = { ...(credentials || {}), blocked_domains: parsedBlockedDomains };
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
                  background: authMode === opt.value ? 'var(--secondary-soft)' : 'transparent',
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

          {/* Advanced — blocked domains */}
          <div style={{ border: '1px solid var(--outline-variant)', borderRadius: '10px', overflow: 'hidden' }}>
            <button type="button" onClick={() => setShowAdvanced(v => !v)}
              style={{ width: '100%', padding: '10px 14px', background: 'var(--surface-container-low)', border: 'none', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: 'var(--on-surface-variant)', fontSize: '0.8rem', fontWeight: 600 }}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>tune</span>
              <span style={{ flex: 1, textAlign: 'left' }}>Advanced</span>
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>{showAdvanced ? 'expand_less' : 'expand_more'}</span>
            </button>
            {showAdvanced && (
              <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={labelStyle}>
                  Block domains (one per line or comma-separated)
                </label>
                <p style={{ fontSize: '0.72rem', color: 'var(--outline)', marginBottom: '4px', lineHeight: 1.5 }}>
                  Requests to these domains will be blocked during the test run. Useful for preventing consent banners (e.g. <code>trustarc.com</code>, <code>onetrust.com</code>) from loading.
                  Common CDNs are already blocked by default.
                </p>
                <textarea
                  value={blockedDomains}
                  onChange={e => setBlockedDomains(e.target.value)}
                  rows={3}
                  placeholder={'example.com\nanalytics.io'}
                  className="ent-input"
                  style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '0.8rem', resize: 'vertical' }}
                />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '12px', border: '1px solid var(--outline-variant)', borderRadius: '8px', background: 'transparent', color: 'var(--on-surface)', fontSize: '0.875rem', fontWeight: 500 }}>Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary" style={{ flex: 1, padding: '12px', fontSize: '0.875rem', fontWeight: 600, opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Saving...' : 'Save Application'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const SEVERITY_COLOR = { critical: '#b91c1c', high: '#c2410c', medium: '#b45309', low: '#15803d', info: '#0369a1' };
const SEVERITY_BG = { critical: 'rgba(185,28,28,0.08)', high: 'rgba(194,65,12,0.08)', medium: 'rgba(180,83,9,0.08)', low: 'rgba(21,128,61,0.08)', info: 'rgba(3,105,161,0.08)' };

function MemoryModal({ app, onClose }) {
  const [memory, setMemory] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clearing, setClearing] = useState(false);
  const [tab, setTab] = useState('overview');

  useEffect(() => {
    api.get(`/apps/${app.id}/memory`)
      .then(res => { setMemory(res.data.data); setUpdatedAt(res.data.updated_at); })
      .catch(() => setError('Failed to load memory'))
      .finally(() => setLoading(false));
  }, [app.id]);

  const handleClear = async () => {
    if (!window.confirm('Clear all agent memory for this app? The next run will start fresh.')) return;
    setClearing(true);
    try {
      await api.delete(`/apps/${app.id}/memory`);
      setMemory(null);
    } catch {
      setError('Failed to clear memory');
    } finally {
      setClearing(false);
    }
  };

  const tabs = ['overview', 'login', 'pages', 'known bugs'];

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(25,28,30,0.35)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
      <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '14px', width: '100%', maxWidth: '680px', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px rgba(25,28,30,0.15)' }}>
        {/* Header */}
        <div style={{ padding: '1.5rem 1.75rem 1rem', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span className="material-symbols-outlined" style={{ color: 'var(--secondary)', fontSize: '20px' }}>psychology</span>
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)', letterSpacing: '-0.01em' }}>Agent Memory</h2>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)' }}>{app.name}</p>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {memory && (
                <button onClick={handleClear} disabled={clearing} style={{ padding: '6px 12px', border: '1px solid var(--error)', borderRadius: '8px', background: 'transparent', color: 'var(--error)', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>delete_sweep</span>
                  {clearing ? 'Clearing…' : 'Clear Memory'}
                </button>
              )}
              <button onClick={onClose} style={{ padding: '6px', background: 'none', border: 'none', color: 'var(--on-surface-variant)', lineHeight: 1 }}>
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
              </button>
            </div>
          </div>
          {/* Tabs */}
          {memory && (
            <div style={{ display: 'flex', gap: '4px', marginTop: '1rem' }}>
              {tabs.map(t => (
                <button key={t} onClick={() => setTab(t)} style={{ padding: '6px 14px', borderRadius: '8px', border: 'none', background: tab === t ? 'var(--secondary-soft)' : 'transparent', color: tab === t ? 'var(--secondary)' : 'var(--on-surface-variant)', fontSize: '0.8rem', fontWeight: tab === t ? 700 : 400, textTransform: 'capitalize' }}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '1.25rem 1.75rem', flex: 1 }}>
          {error && <div style={{ color: 'var(--error)', fontSize: '0.875rem', padding: '10px', background: 'var(--error-container)', borderRadius: '8px' }}>{error}</div>}
          {loading && <div style={{ color: 'var(--on-surface-variant)', fontSize: '0.875rem', display: 'flex', gap: '8px', alignItems: 'center' }}><span className="material-symbols-outlined pulse" style={{ color: 'var(--secondary)' }}>autorenew</span> Loading memory…</div>}

          {!loading && !memory && !error && (
            <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--on-surface-variant)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '48px', color: 'var(--outline-variant)', display: 'block', marginBottom: '1rem' }}>psychology</span>
              <p style={{ fontWeight: 500, color: 'var(--on-surface)', marginBottom: '4px' }}>No memory yet</p>
              <p style={{ fontSize: '0.85rem' }}>Memory is built automatically after the first completed test run.</p>
            </div>
          )}

          {memory && tab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                {[
                  { label: 'Total Runs', value: memory.total_runs ?? 0, icon: 'play_circle' },
                  { label: 'Pages Tracked', value: Object.keys(memory.pages || {}).length, icon: 'article' },
                  { label: 'Known Bugs', value: (memory.known_bugs || []).length, icon: 'bug_report' },
                ].map(stat => (
                  <div key={stat.label} style={{ background: 'var(--surface-container-low)', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--secondary)', fontSize: '20px' }}>{stat.icon}</span>
                    <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--on-surface)', lineHeight: 1 }}>{stat.value}</span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--on-surface-variant)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.06em' }}>{stat.label}</span>
                  </div>
                ))}
              </div>
              {updatedAt && (
                <p style={{ fontSize: '0.78rem', color: 'var(--outline)', marginTop: '4px' }}>
                  Last updated: {new Date(updatedAt).toLocaleString()}
                </p>
              )}
              {memory.last_run_id && (
                <p style={{ fontSize: '0.78rem', color: 'var(--outline)' }}>
                  Last run ID: <code style={{ fontFamily: 'monospace' }}>{memory.last_run_id}</code>
                </p>
              )}
            </div>
          )}

          {memory && tab === 'login' && (
            <div>
              {!memory.login?.working_steps ? (
                <div style={{ color: 'var(--on-surface-variant)', fontSize: '0.875rem', padding: '2rem 0', textAlign: 'center' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '36px', color: 'var(--outline-variant)', display: 'block', marginBottom: '8px' }}>lock_open</span>
                  No stored login flow yet. The agent will use smart login on the next run and store the working steps.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: 'var(--on-surface-variant)', marginBottom: '4px' }}>
                    <span>Failure count: <strong style={{ color: (memory.login.failure_count || 0) > 0 ? 'var(--error)' : 'var(--on-surface)' }}>{memory.login.failure_count || 0}</strong></span>
                    {memory.login.last_success_run_id && <span>Last success: <code style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{memory.login.last_success_run_id}</code></span>}
                  </div>
                  {memory.login.working_steps.map((step, i) => (
                    <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', background: 'var(--surface-container-low)', borderRadius: '8px', padding: '10px 12px' }}>
                      <span style={{ flex: '0 0 auto', fontSize: '0.72rem', fontWeight: 700, color: 'var(--outline)', minWidth: '18px', marginTop: '2px' }}>{i + 1}</span>
                      <div style={{ flex: 1, fontSize: '0.82rem' }}>
                        <span style={{ fontWeight: 600, color: 'var(--secondary)', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.05em' }}>{step.action}</span>
                        {step.selector && <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--on-surface-variant)', marginTop: '2px' }}>{step.selector}</div>}
                        {step.value && (
                          <div style={{ marginTop: '2px', color: step.value === '__PASSWORD__' ? 'var(--outline)' : 'var(--on-surface)', fontStyle: step.value === '__PASSWORD__' ? 'italic' : 'normal' }}>
                            {step.value === '__PASSWORD__' ? '••••••••' : step.value === '__EMAIL__' ? '[email]' : step.value}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {memory && tab === 'pages' && (
            <div>
              {Object.keys(memory.pages || {}).length === 0 ? (
                <div style={{ color: 'var(--on-surface-variant)', fontSize: '0.875rem', padding: '2rem 0', textAlign: 'center' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '36px', color: 'var(--outline-variant)', display: 'block', marginBottom: '8px' }}>article</span>
                  No pages tracked yet.
                </div>
              ) : (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px', gap: '0', fontSize: '10px', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '6px 12px', marginBottom: '4px' }}>
                    <span>Page URL</span><span style={{ textAlign: 'center' }}>Bugs</span><span style={{ textAlign: 'center' }}>Priority</span>
                  </div>
                  {Object.entries(memory.pages)
                    .sort(([, a], [, b]) => (b.priority_score || 0) - (a.priority_score || 0))
                    .map(([url, info]) => (
                      <div key={url} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px', alignItems: 'center', padding: '10px 12px', background: 'var(--surface-container-low)', borderRadius: '8px', marginBottom: '6px', gap: '8px' }}>
                        <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--link)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={url}>{url}</a>
                        <span style={{ textAlign: 'center', fontWeight: 700, color: (info.bug_count || 0) > 2 ? 'var(--error)' : 'var(--on-surface)' }}>{info.bug_count || 0}</span>
                        <span style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--secondary)', fontWeight: 600 }}>{info.priority_score || 0}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {memory && tab === 'known bugs' && (
            <div>
              {(memory.known_bugs || []).length === 0 ? (
                <div style={{ color: 'var(--on-surface-variant)', fontSize: '0.875rem', padding: '2rem 0', textAlign: 'center' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '36px', color: 'var(--outline-variant)', display: 'block', marginBottom: '8px' }}>bug_report</span>
                  No known bugs in memory yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[...memory.known_bugs]
                    .sort((a, b) => (b.occurrence_count || 1) - (a.occurrence_count || 1))
                    .map((bug, i) => (
                      <div key={i} style={{ background: 'var(--surface-container-low)', borderRadius: '10px', padding: '12px 14px', borderLeft: `3px solid ${SEVERITY_COLOR[bug.severity] || 'var(--outline)'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--on-surface)', flex: 1 }}>{bug.title}</span>
                          <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                            <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', background: SEVERITY_BG[bug.severity] || 'var(--surface-container-high)', color: SEVERITY_COLOR[bug.severity] || 'var(--on-surface-variant)' }}>{bug.severity || 'unknown'}</span>
                            <span style={{ padding: '2px 8px', borderRadius: '999px', fontSize: '10px', fontWeight: 600, background: 'var(--surface-container-high)', color: 'var(--on-surface-variant)' }}>×{bug.occurrence_count || 1}</span>
                          </div>
                        </div>
                        {bug.page_url && <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--outline)', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bug.page_url}</div>}
                        <div style={{ fontSize: '0.72rem', color: 'var(--on-surface-variant)', display: 'flex', gap: '12px' }}>
                          {bug.first_seen_run_id && <span>First seen: <code style={{ fontFamily: 'monospace' }}>{bug.first_seen_run_id.slice(0, 8)}…</code></span>}
                          {bug.last_seen_run_id && <span>Last seen: <code style={{ fontFamily: 'monospace' }}>{bug.last_seen_run_id.slice(0, 8)}…</code></span>}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AppList() {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [memoryApp, setMemoryApp] = useState(null);
  const [runApp, setRunApp] = useState(null);

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: '6px' }}>Asset management</span>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--primary)' }}>Applications</h1>
          <p style={{ color: 'var(--on-surface-variant)', marginTop: '6px', fontSize: '0.875rem', maxWidth: '480px' }}>Manage and monitor the security posture of your registered enterprise assets.</p>
        </div>
        <button type="button" onClick={() => setModal('new')} className="btn-primary">
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add</span>
          Add application
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
        <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 160px 140px', padding: '14px 24px', background: 'var(--table-header-bg)', fontSize: '10px', fontWeight: 700, color: 'var(--on-surface)', textTransform: 'uppercase', letterSpacing: '0.12em', borderBottom: '1px solid var(--border-subtle)' }}>
            <span>Application Name & URL</span>
            <span style={{ textAlign: 'center' }}>Auth</span>
            <span>Added</span>
            <span style={{ textAlign: 'right' }}>Actions</span>
          </div>

          {/* Rows */}
          <div>
            {apps.map((app, idx) => (
              <div key={app.id} className="hoverable-row" style={{ display: 'grid', gridTemplateColumns: '1fr 120px 160px 140px', alignItems: 'center', padding: '16px 24px', borderLeft: '3px solid var(--secondary)', borderBottom: idx < apps.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '6px', background: 'var(--secondary-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--secondary)', fontSize: '18px' }}>cloud_done</span>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--link)', marginBottom: '2px' }}>{app.name}</div>
                    <a href={app.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.75rem', color: 'var(--outline)', fontFamily: 'monospace' }}>{app.url}</a>
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  {app.credentials?.login_flow ? (
                    <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, background: 'rgba(176,141,91,0.1)', color: 'var(--on-tertiary-container)', textTransform: 'uppercase' }}>SSO</span>
                  ) : app.credentials?.username ? (
                    <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, background: 'var(--secondary-soft)', color: 'var(--secondary)', textTransform: 'uppercase' }}>Login</span>
                  ) : (
                    <span style={{ padding: '3px 10px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, background: 'var(--surface-container-high)', color: 'var(--on-surface-variant)', textTransform: 'uppercase' }}>None</span>
                  )}
                </div>
                <span style={{ fontSize: '0.8rem', color: 'var(--on-surface-variant)' }}>
                  {app.created_at ? new Date(app.created_at).toLocaleDateString() : '—'}
                </span>
                <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', alignItems: 'center' }}>
                  <button onClick={() => setRunApp(app)}
                    style={{ padding: '5px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px', background: 'var(--primary-button)', color: '#fff', border: 'none', cursor: 'pointer' }}
                    title="Start test run">
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>play_arrow</span>
                    Run
                  </button>
                  <button onClick={() => setMemoryApp(app)} style={{ padding: '6px', background: 'none', border: 'none', color: 'var(--secondary)' }} title="View agent memory">
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>psychology</span>
                  </button>
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
          <div style={{ padding: '12px 24px', background: 'var(--surface-container-low)', fontSize: '0.75rem', color: 'var(--on-surface-variant)', borderTop: '1px solid var(--border-subtle)' }}>
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
      {memoryApp && <MemoryModal app={memoryApp} onClose={() => setMemoryApp(null)} />}
      {runApp && (
        <NewRunModal
          defaultAppId={runApp.id}
          onClose={() => setRunApp(null)}
          onCreated={() => setRunApp(null)}
        />
      )}
    </div>
  );
}

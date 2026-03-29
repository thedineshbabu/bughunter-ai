import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';

const inputStyle = {
  width: '100%', padding: '10px 12px',
  background: 'var(--surface-container-lowest)',
  border: '1px solid rgba(197,198,207,0.3)',
  borderRadius: '8px', fontSize: '0.875rem',
  color: 'var(--on-surface)', boxSizing: 'border-box',
};

export default function NewRunModal({ onClose, onCreated }) {
  const [apps, setApps] = useState([]);
  const [appId, setAppId] = useState('');
  const [notes, setNotes] = useState('');
  const [maxPages, setMaxPages] = useState(5);
  const [instructions, setInstructions] = useState('');
  const [focusAreas, setFocusAreas] = useState('');
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
    setLoading(true); setError('');
    try {
      const test_config = {
        max_pages: maxPages,
        instructions: instructions.trim(),
        focus_areas: focusAreas.trim(),
      };
      const res = await api.post('/runs', { app_id: appId, notes, test_config });
      onCreated?.();
      navigate(`/runs/${res.data.run.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create run');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(25,28,30,0.3)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
      <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '14px', padding: '2rem', width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 40px rgba(25,28,30,0.12)' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--primary)', marginBottom: '4px' }}>Start New Test Run</h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--on-surface-variant)' }}>The AI agent will autonomously explore and test your app.</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--outline)', padding: '2px' }}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {error && (
          <div style={{ background: 'var(--error-container)', color: 'var(--error)', padding: '10px 14px', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.875rem' }}>{error}</div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* App selector */}
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--on-surface-variant)' }}>Select Application</label>
            {apps.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--on-surface-variant)', padding: '10px', background: 'var(--surface-container-low)', borderRadius: '8px' }}>
                No apps registered.{' '}
                <a href="/apps" style={{ color: 'var(--secondary)', fontWeight: 500 }}>Add one first →</a>
              </p>
            ) : (
              <select value={appId} onChange={e => setAppId(e.target.value)} className="ent-input" style={{ ...inputStyle, paddingRight: '36px' }}>
                {apps.map(app => (
                  <option key={app.id} value={app.id}>{app.name} — {app.url}</option>
                ))}
              </select>
            )}
          </div>

          {/* Test configuration */}
          <div style={{ background: 'var(--surface-container-low)', borderRadius: '10px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--on-surface-variant)', marginBottom: '2px' }}>Test Configuration</div>

            {/* Instructions */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--on-surface-variant)' }}>
                What to test <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <textarea value={instructions} onChange={e => setInstructions(e.target.value)} rows={3}
                placeholder="e.g. Test the client listing page, verify search and filters work, check pagination..."
                className="ent-input" style={{ ...inputStyle, resize: 'vertical' }} />
            </div>

            {/* Focus areas */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--on-surface-variant)' }}>
                Focus areas <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <input type="text" value={focusAreas} onChange={e => setFocusAreas(e.target.value)}
                placeholder="e.g. authentication, forms, navigation, data display"
                className="ent-input" style={inputStyle} />
            </div>

            {/* Max pages */}
            <div>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--on-surface-variant)' }}>
                Pages to explore
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <input type="range" min={1} max={20} value={maxPages} onChange={e => setMaxPages(Number(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--secondary)' }} />
                <span style={{ minWidth: '32px', textAlign: 'center', fontWeight: 700, fontSize: '0.9rem', color: 'var(--secondary)' }}>{maxPages}</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--outline)', marginTop: '4px' }}>
                More pages = deeper coverage but longer run time
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--on-surface-variant)' }}>Notes <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="e.g. Run after deployment, slow network conditions..."
              className="ent-input" style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '10px', paddingTop: '4px' }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '12px', border: '1px solid var(--outline-variant)', borderRadius: '8px', background: 'transparent', color: 'var(--on-surface)', fontSize: '0.875rem', fontWeight: 500 }}>
              Cancel
            </button>
            <button type="submit" disabled={loading || apps.length === 0} style={{ flex: 2, padding: '12px', background: 'linear-gradient(135deg, var(--primary), var(--primary-container))', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', opacity: loading || apps.length === 0 ? 0.7 : 1 }}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>play_arrow</span>
              {loading ? 'Starting...' : 'Start Test Run'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

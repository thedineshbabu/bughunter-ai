import React from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './components/Dashboard.jsx';
import AppList from './components/AppList.jsx';
import TestRuns from './components/TestRuns.jsx';
import BugReports from './components/BugReports.jsx';

// ── Shared input style ───────────────────────────────────────────────────────
const inputStyle = {
  width: '100%', padding: '11px 12px 11px 44px',
  background: 'var(--surface-container-lowest)',
  border: '1px solid rgba(197,198,207,0.3)',
  borderRadius: '8px', fontSize: '0.9rem',
  color: 'var(--on-surface)', boxSizing: 'border-box',
};

// ── Auth Page Shell ──────────────────────────────────────────────────────────
function AuthShell({ children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem', background: 'var(--surface)', position: 'relative', overflow: 'hidden' }}>
      {/* Background orbs */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-96px', left: '-96px', width: '384px', height: '384px', background: '#d8e2ff', opacity: 0.12, borderRadius: '50%', filter: 'blur(64px)' }} />
        <div style={{ position: 'absolute', bottom: 0, right: 0, width: '500px', height: '500px', background: '#d8e2ff', opacity: 0.06, borderRadius: '50%', filter: 'blur(100px)' }} />
      </div>
      <main style={{ position: 'relative', width: '100%', maxWidth: '440px', zIndex: 10 }}>
        {/* Brand header */}
        <header style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '12px', marginBottom: '1rem' }}>
            <div style={{ width: '40px', height: '40px', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px' }}>
              <span className="material-symbols-outlined" style={{ color: '#fff', fontVariationSettings: "'FILL' 1" }}>security</span>
            </div>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--primary)' }}>BugHunter.AI</span>
          </div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--on-surface)', marginBottom: '6px' }}>Precision Security Audit</h1>
          <p style={{ color: 'var(--on-surface-variant)', fontSize: '0.875rem' }}>Access your enterprise testing environment.</p>
        </header>
        {children}
        <footer style={{ marginTop: '2.5rem', textAlign: 'center', fontSize: '0.75rem', color: 'var(--outline)' }}>
          <p>© 2024 BugHunter.AI. All rights reserved.</p>
        </footer>
      </main>
    </div>
  );
}

// ── Error Banner ─────────────────────────────────────────────────────────────
function ErrorBanner({ msg }) {
  return (
    <div style={{ background: 'var(--error-container)', color: 'var(--error)', padding: '10px 14px', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.875rem' }}>
      {msg}
    </div>
  );
}

// ── Login Page ───────────────────────────────────────────────────────────────
function Login() {
  const { user, login } = useAuth();
  const [form, setForm] = React.useState({ email: '', password: '' });
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try { await login(form.email, form.password); }
    catch (err) { setError(err.response?.data?.error || err.message || 'Login failed'); }
    finally { setLoading(false); }
  };

  return (
    <AuthShell>
      <div className="glass-card" style={{ borderRadius: '12px', padding: '2rem 2.5rem', borderLeft: '3px solid var(--primary)' }}>
        {error && <ErrorBanner msg={error} />}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Email */}
          <div>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--on-surface)' }}>Email Address</label>
            <div style={{ position: 'relative' }}>
              <span className="material-symbols-outlined" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--outline)', fontSize: '20px' }}>mail</span>
              <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="name@enterprise.com" className="ent-input" style={inputStyle} />
            </div>
          </div>
          {/* Password */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <label style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--on-surface)' }}>Password</label>
            </div>
            <div style={{ position: 'relative' }}>
              <span className="material-symbols-outlined" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--outline)', fontSize: '20px' }}>lock</span>
              <input type="password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••" className="ent-input" style={inputStyle} />
            </div>
          </div>
          {/* CTA */}
          <div style={{ paddingTop: '4px' }}>
            <button type="submit" disabled={loading} style={{ width: '100%', padding: '14px', background: 'linear-gradient(135deg, var(--primary), var(--primary-container))', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.95rem', fontWeight: 500, opacity: loading ? 0.7 : 1, letterSpacing: '0.01em' }}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </div>
        </form>
        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.875rem', color: 'var(--outline)' }}>
          Don't have an account?{' '}
          <Link to="/register" style={{ color: 'var(--secondary)', fontWeight: 500 }}>Create one</Link>
        </p>
      </div>
    </AuthShell>
  );
}

// ── Register Page ────────────────────────────────────────────────────────────
function Register() {
  const { user, register } = useAuth();
  const [form, setForm] = React.useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault(); setError('');
    if (form.password !== form.confirm) return setError('Passwords do not match');
    if (form.password.length < 8) return setError('Password must be at least 8 characters');
    setLoading(true);
    try { await register(form.email, form.password, form.name); }
    catch (err) { setError(err.response?.data?.error || err.message || 'Registration failed'); }
    finally { setLoading(false); }
  };

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const baseInput = { ...inputStyle, paddingLeft: '12px' };

  return (
    <AuthShell>
      <div className="glass-card" style={{ borderRadius: '12px', padding: '2rem 2.5rem', borderLeft: '3px solid var(--primary)' }}>
        {error && <ErrorBanner msg={error} />}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {[
            { field: 'name',     label: 'Full Name',        type: 'text',     ph: 'Your name' },
            { field: 'email',    label: 'Email Address',    type: 'email',    ph: 'name@enterprise.com' },
            { field: 'password', label: 'Password',         type: 'password', ph: 'Min. 8 characters' },
            { field: 'confirm',  label: 'Confirm Password', type: 'password', ph: 'Re-enter password' },
          ].map(({ field, label, type, ph }) => (
            <div key={field}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--on-surface)' }}>{label}</label>
              <input type={type} required value={form[field]} onChange={set(field)} placeholder={ph}
                className="ent-input" style={baseInput} />
            </div>
          ))}
          <div style={{ paddingTop: '4px' }}>
            <button type="submit" disabled={loading} style={{ width: '100%', padding: '14px', background: 'linear-gradient(135deg, var(--primary), var(--primary-container))', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '0.95rem', fontWeight: 500, opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Creating account...' : 'Create Account'}
            </button>
          </div>
        </form>
        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.875rem', color: 'var(--outline)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--secondary)', fontWeight: 500 }}>Sign in</Link>
        </p>
      </div>
    </AuthShell>
  );
}

// ── Protected Route ──────────────────────────────────────────────────────────
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--on-surface-variant)', fontSize: '0.875rem', gap: '8px' }}>
      <span className="material-symbols-outlined" style={{ color: 'var(--secondary)' }}>autorenew</span>
      Loading...
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;
  return (
    <div style={{ minHeight: '100vh', background: 'var(--surface)' }}>
      <Sidebar />
      <main style={{ marginLeft: '256px', minHeight: '100vh', padding: '2rem 2.5rem', overflowY: 'auto' }}>
        {children}
      </main>
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <Routes>
      <Route path="/login"    element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/"         element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/apps"     element={<ProtectedRoute><AppList /></ProtectedRoute>} />
      <Route path="/runs"     element={<ProtectedRoute><TestRuns /></ProtectedRoute>} />
      <Route path="/runs/:id" element={<ProtectedRoute><BugReports /></ProtectedRoute>} />
      <Route path="*"         element={<Navigate to="/" replace />} />
    </Routes>
  );
}

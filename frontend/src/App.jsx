import React from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Sidebar from './components/Sidebar.jsx';
import Dashboard from './components/Dashboard.jsx';
import AppList from './components/AppList.jsx';
import TestRuns from './components/TestRuns.jsx';
import BugReports from './components/BugReports.jsx';

// ── Shared styles ───────────────────────────────────────────────────────────
const authCard = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f9fafb',
};

const cardBox = {
  background: '#fff',
  padding: '2rem',
  borderRadius: '12px',
  boxShadow: '0 4px 24px rgba(0,0,0,0.1)',
  width: '100%',
  maxWidth: '400px',
};

const inputStyle = {
  width: '100%',
  padding: '0.75rem',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  fontSize: '1rem',
  boxSizing: 'border-box',
};

const btnPrimary = {
  width: '100%',
  padding: '0.75rem',
  background: '#4f46e5',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  fontSize: '1rem',
  fontWeight: 600,
  cursor: 'pointer',
};

const errorBox = {
  background: '#fee2e2',
  color: '#dc2626',
  padding: '0.75rem',
  borderRadius: '6px',
  marginBottom: '1rem',
  fontSize: '0.9rem',
};

const switchLink = {
  marginTop: '1.25rem',
  textAlign: 'center',
  fontSize: '0.9rem',
  color: '#6b7280',
};

// ── Login Page ──────────────────────────────────────────────────────────────
function Login() {
  const { login } = useAuth();
  const [form, setForm] = React.useState({ email: '', password: '' });
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(form.email, form.password);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={authCard}>
      <div style={cardBox}>
        <h1 style={{ marginBottom: '0.5rem', textAlign: 'center', fontSize: '1.5rem' }}>🐛 BugHunter.AI</h1>
        <p style={{ textAlign: 'center', color: '#6b7280', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          Sign in to your account
        </p>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Email</label>
            <input type="email" required value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              placeholder="you@example.com"
              style={inputStyle} />
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Password</label>
            <input type="password" required value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
              style={inputStyle} />
          </div>
          <button type="submit" disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
        <div style={switchLink}>
          Don't have an account?{' '}
          <Link to="/register" style={{ color: '#4f46e5', fontWeight: 500 }}>Create one</Link>
        </div>
      </div>
    </div>
  );
}

// ── Register Page ───────────────────────────────────────────────────────────
function Register() {
  const { register } = useAuth();
  const [form, setForm] = React.useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.password !== form.confirm) {
      return setError('Passwords do not match');
    }
    if (form.password.length < 8) {
      return setError('Password must be at least 8 characters');
    }

    setLoading(true);
    try {
      await register(form.email, form.password, form.name);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  return (
    <div style={authCard}>
      <div style={cardBox}>
        <h1 style={{ marginBottom: '0.5rem', textAlign: 'center', fontSize: '1.5rem' }}>🐛 BugHunter.AI</h1>
        <p style={{ textAlign: 'center', color: '#6b7280', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
          Create your account
        </p>
        {error && <div style={errorBox}>{error}</div>}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Name</label>
            <input type="text" required value={form.name}
              onChange={set('name')}
              placeholder="Your name"
              style={inputStyle} />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Email</label>
            <input type="email" required value={form.email}
              onChange={set('email')}
              placeholder="you@example.com"
              style={inputStyle} />
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Password</label>
            <input type="password" required value={form.password}
              onChange={set('password')}
              placeholder="Min. 8 characters"
              style={inputStyle} />
          </div>
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Confirm Password</label>
            <input type="password" required value={form.confirm}
              onChange={set('confirm')}
              placeholder="Re-enter password"
              style={inputStyle} />
          </div>
          <button type="submit" disabled={loading} style={{ ...btnPrimary, opacity: loading ? 0.7 : 1 }}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>
        <div style={switchLink}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: '#4f46e5', fontWeight: 500 }}>Sign in</Link>
        </div>
      </div>
    </div>
  );
}

// ── Protected Route ─────────────────────────────────────────────────────────
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: '2rem' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar />
      <main style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>{children}</main>
    </div>
  );
}

// ── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/apps" element={<ProtectedRoute><AppList /></ProtectedRoute>} />
      <Route path="/runs" element={<ProtectedRoute><TestRuns /></ProtectedRoute>} />
      <Route path="/runs/:id" element={<ProtectedRoute><BugReports /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

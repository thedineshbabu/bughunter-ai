import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const inputStyle = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--surface-container-lowest)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '6px',
  fontSize: '0.875rem',
  color: 'var(--on-surface)',
  boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block',
  marginBottom: '6px',
  fontSize: '0.7rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--on-surface-variant)',
};

export default function UserProfile() {
  const { user, updateProfile } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [initialEmail, setInitialEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setEmail(user.email || '');
      setInitialEmail(user.email || '');
    }
  }, [user]);

  const emailChanged = email.trim().toLowerCase() !== initialEmail.trim().toLowerCase();
  const wantsPasswordChange = newPassword.length > 0 || confirmPassword.length > 0;
  const needsCurrentPassword = emailChanged || wantsPasswordChange;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (wantsPasswordChange) {
      if (newPassword.length < 8) {
        setError('New password must be at least 8 characters');
        return;
      }
      if (newPassword !== confirmPassword) {
        setError('New passwords do not match');
        return;
      }
    }

    if (needsCurrentPassword && !currentPassword) {
      setError('Enter your current password to change email or password');
      return;
    }

    const payload = {};
    if (name.trim() !== (user?.name || '')) payload.name = name.trim();
    if (emailChanged) payload.email = email.trim();
    if (needsCurrentPassword) payload.current_password = currentPassword;
    if (wantsPasswordChange) payload.new_password = newPassword;

    if (Object.keys(payload).length === 0) {
      setMessage('Nothing to save');
      return;
    }

    setSaving(true);
    try {
      await updateProfile(payload);
      setInitialEmail(email.trim());
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage('Profile updated');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '1.5rem' }}>
        <Link to="/" style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--link)', display: 'inline-flex', alignItems: 'center', gap: '4px', marginBottom: '12px' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_back</span>
          Back to dashboard
        </Link>
        <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'var(--on-surface-variant)', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: '6px' }}>Account</span>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--primary)' }}>Profile</h1>
        <p style={{ color: 'var(--on-surface-variant)', fontSize: '0.875rem', marginTop: '6px', maxWidth: '520px' }}>
          Update your name, email, or password. Changing email or password requires your current password.
        </p>
      </div>

      {message && (
        <div style={{ background: '#f0fdf4', color: '#166534', padding: '10px 14px', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.875rem', border: '1px solid #bbf7d0' }}>
          {message}
        </div>
      )}
      {error && (
        <div style={{ background: 'var(--error-container)', color: 'var(--error)', padding: '10px 14px', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ maxWidth: '560px' }}>
        <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '8px', padding: '1.5rem', border: '1px solid var(--border-subtle)', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '1rem' }}>Profile details</h2>
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>Full name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="ent-input" style={inputStyle} autoComplete="name" />
          </div>
          <div>
            <label style={labelStyle}>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="ent-input" style={inputStyle} autoComplete="email" />
          </div>
        </div>

        <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '8px', padding: '1.5rem', border: '1px solid var(--border-subtle)', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '0.5rem' }}>Change password</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--outline)', marginBottom: '1rem' }}>Leave blank to keep your current password.</p>
          <div style={{ marginBottom: '1rem' }}>
            <label style={labelStyle}>New password</label>
            <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="ent-input" style={inputStyle} autoComplete="new-password" placeholder="Min. 8 characters" />
          </div>
          <div>
            <label style={labelStyle}>Confirm new password</label>
            <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="ent-input" style={inputStyle} autoComplete="new-password" />
          </div>
        </div>

        <div style={{ background: 'var(--surface-container-lowest)', borderRadius: '8px', padding: '1.5rem', border: '1px solid var(--border-subtle)', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '0.5rem' }}>Verify</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--outline)', marginBottom: '1rem' }}>
            {needsCurrentPassword
              ? 'Enter your current password to apply these changes.'
              : 'Required only when you change email or password.'}
          </p>
          <div>
            <label style={labelStyle}>Current password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="ent-input"
              style={inputStyle}
              autoComplete="current-password"
              placeholder={needsCurrentPassword ? 'Required' : 'If changing email or password'}
            />
          </div>
        </div>

        <button type="submit" disabled={saving} className="btn-primary" style={{ padding: '12px 24px', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </div>
  );
}

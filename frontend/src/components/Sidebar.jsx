import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const NAV_ITEMS = [
  { to: '/',      label: '📊 Dashboard' },
  { to: '/apps',  label: '🗂️ Apps' },
  { to: '/runs',  label: '▶️  Test Runs' },
];

const styles = {
  sidebar: {
    width: '220px', minHeight: '100vh', background: '#1e1b4b', color: '#e0e7ff',
    display: 'flex', flexDirection: 'column', padding: '1.5rem 0',
    flexShrink: 0,
  },
  brand: { padding: '0 1.5rem 1.5rem', fontSize: '1.1rem', fontWeight: 700, color: '#fff' },
  nav: { flex: 1 },
  link: {
    display: 'block', padding: '0.75rem 1.5rem', color: '#c7d2fe',
    transition: 'background 0.15s', borderLeft: '3px solid transparent',
  },
  activeLink: {
    background: 'rgba(99,102,241,0.3)', color: '#fff',
    borderLeft: '3px solid #818cf8',
  },
  footer: { padding: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)' },
  userName: { fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' },
  userEmail: { fontSize: '0.75rem', color: '#a5b4fc', marginBottom: '0.75rem' },
  logoutBtn: {
    width: '100%', padding: '0.5rem', background: 'rgba(239,68,68,0.2)',
    border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5',
    borderRadius: '6px', fontSize: '0.85rem',
  },
};

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside style={styles.sidebar}>
      <div style={styles.brand}>🐛 BugHunter.AI</div>
      <nav style={styles.nav}>
        {NAV_ITEMS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={({ isActive }) => ({ ...styles.link, ...(isActive ? styles.activeLink : {}) })}
          >
            {label}
          </NavLink>
        ))}
      </nav>
      {user && (
        <div style={styles.footer}>
          <div style={styles.userName}>{user.name || 'User'}</div>
          <div style={styles.userEmail}>{user.email}</div>
          <button style={styles.logoutBtn} onClick={handleLogout}>Sign Out</button>
        </div>
      )}
    </aside>
  );
}

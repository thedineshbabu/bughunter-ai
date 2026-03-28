import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const NAV_ITEMS = [
  { to: '/',        label: 'Dashboard',   icon: 'dashboard' },
  { to: '/apps',    label: 'Apps',        icon: 'apps' },
  { to: '/runs',    label: 'Test Runs',   icon: 'flaky' },
  { to: '/apitest', label: 'API Testing', icon: 'api' },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <aside style={{
      position: 'fixed', left: 0, top: 0, height: '100vh', width: '256px',
      display: 'flex', flexDirection: 'column',
      background: 'var(--surface-container-low)',
      borderRight: '1px solid var(--outline-variant)',
      zIndex: 50,
    }}>
      {/* Brand */}
      <div style={{ padding: '2rem 1.5rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '32px', height: '32px', borderRadius: '6px',
            background: 'var(--primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <span className="material-symbols-outlined" style={{ color: '#fff', fontSize: '18px', fontVariationSettings: "'FILL' 1" }}>bug_report</span>
          </div>
          <div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary)', letterSpacing: '-0.02em' }}>BugHunter.AI</div>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--outline)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Enterprise Audit</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, marginTop: '8px' }}>
        {NAV_ITEMS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{icon}</span>
            <span style={{ letterSpacing: '0.01em' }}>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div style={{ padding: '1.5rem', borderTop: '1px solid var(--outline-variant)' }}>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1.25rem' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '50%',
              background: 'var(--primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: '0.75rem', fontWeight: 700, flexShrink: 0,
            }}>
              {(user.name || user.email || 'U').charAt(0).toUpperCase()}
            </div>
            <div style={{ overflow: 'hidden', flex: 1 }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.name || 'User'}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--outline)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <a className="footer-link" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 4px', fontSize: '0.8rem', color: 'var(--on-surface-variant)', borderRadius: '6px', cursor: 'pointer' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>menu_book</span>
            Documentation
          </a>
          <button
            onClick={() => { logout(); navigate('/login'); }}
            className="footer-link-danger"
            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 4px', fontSize: '0.8rem', color: 'var(--on-surface-variant)', background: 'none', border: 'none', borderRadius: '6px', textAlign: 'left' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>logout</span>
            Log out
          </button>
        </div>
      </div>
    </aside>
  );
}

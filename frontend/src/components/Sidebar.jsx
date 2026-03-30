import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSidebar } from '../context/SidebarContext.jsx';

const NAV_ITEMS = [
  { to: '/',        label: 'Dashboard',   icon: 'dashboard' },
  { to: '/apps',    label: 'Apps',        icon: 'apps' },
  { to: '/runs',    label: 'Test Runs',   icon: 'flaky' },
  { to: '/bugs',    label: 'Bug Reports', icon: 'bug_report' },
  { to: '/agents',  label: 'AI Agents',   icon: 'smart_toy' },
  { to: '/apitest', label: 'API Testing', icon: 'api' },
  { to: '/profile', label: 'Profile',     icon: 'person' },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const { collapsed } = useSidebar();
  const navigate = useNavigate();

  return (
    <aside className={`app-sidebar${collapsed ? ' app-sidebar--collapsed' : ''}`}>
      <p className="app-sidebar__label">Navigation</p>
      <nav className="app-sidebar__nav">
        {NAV_ITEMS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
            title={label}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>{icon}</span>
            <span className="nav-link__text" style={{ letterSpacing: '0.01em' }}>{label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="app-sidebar__footer">
        {user && (
          <div className="app-sidebar__user">
            <div className="app-sidebar__user-avatar">
              {(user.name || user.email || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="app-sidebar__user-meta">
              <div className="app-sidebar__user-name">{user.name || 'User'}</div>
              <div className="app-sidebar__user-email">{user.email}</div>
            </div>
          </div>
        )}
        <div className="app-sidebar__actions">
          <button
            type="button"
            onClick={() => { logout(); navigate('/login'); }}
            className="footer-link-danger app-sidebar__action"
            title="Log out"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>logout</span>
            <span className="app-sidebar__action-text">Log out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useSidebar } from '../context/SidebarContext.jsx';

export default function AppHeader() {
  const { user } = useAuth();
  const { collapsed, toggle } = useSidebar();
  const initials = (user?.name || user?.email || 'U')
    .split(/\s+/)
    .map((s) => s[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="app-header">
      <div className="app-header__left">
        <button
          type="button"
          className="app-header__icon-btn"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!collapsed}
          onClick={toggle}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>menu</span>
        </button>
        <div className="app-header__brand">
          <span className="app-header__brand-title">BugHunter.AI</span>
          <span className="app-header__brand-sub">Enterprise audit</span>
        </div>
      </div>
      <div className="app-header__right">
        <button type="button" className="app-header__icon-btn" aria-label="Help">
          <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>help</span>
        </button>
        <Link
          to="/profile"
          className="app-header__user"
          title="Profile and account settings"
          aria-label="Open profile"
        >
          <div className="app-header__avatar">{initials}</div>
          <span className="material-symbols-outlined app-header__chevron" style={{ fontSize: '18px' }}>expand_more</span>
        </Link>
      </div>
    </header>
  );
}

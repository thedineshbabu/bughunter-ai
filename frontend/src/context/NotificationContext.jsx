import React, { createContext, useCallback, useContext, useState } from 'react';

const NotificationContext = createContext(null);

let nextId = 0;

const ICONS = {
  success: 'check_circle',
  error: 'error',
  warning: 'warning',
  info: 'info',
};

const COLORS = {
  success: 'var(--success, #4caf50)',
  error: 'var(--error, #ef4444)',
  warning: 'var(--warning, #f59e0b)',
  info: 'var(--link, #6c8eff)',
};

export function NotificationProvider({ children }) {
  const [notifications, setNotifications] = useState([]);

  const removeNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const addNotification = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++nextId;
    setNotifications((prev) => [...prev, { id, message, type }]);
    if (duration > 0) {
      setTimeout(() => removeNotification(id), duration);
    }
    return id;
  }, [removeNotification]);

  const notify = {
    success: (msg, dur) => addNotification(msg, 'success', dur),
    error: (msg, dur) => addNotification(msg, 'error', dur ?? 6000),
    warning: (msg, dur) => addNotification(msg, 'warning', dur),
    info: (msg, dur) => addNotification(msg, 'info', dur),
  };

  return (
    <NotificationContext.Provider value={notify}>
      {children}
      {/* Toast container */}
      <div style={{
        position: 'fixed', top: '1rem', right: '1rem', zIndex: 10000,
        display: 'flex', flexDirection: 'column', gap: '0.5rem',
        pointerEvents: 'none', maxWidth: '400px',
      }}>
        {notifications.map((n) => (
          <div key={n.id} style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '12px 16px', borderRadius: '8px',
            background: 'var(--surface-container, #1e1e2e)',
            border: `1px solid ${COLORS[n.type]}33`,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            color: 'var(--on-surface, #e0e0e0)',
            fontSize: '0.875rem', pointerEvents: 'auto',
            animation: 'slideIn 0.2s ease-out',
          }}>
            <span className="material-symbols-outlined" style={{
              color: COLORS[n.type], fontSize: '20px', flexShrink: 0,
              fontVariationSettings: "'FILL' 1",
            }}>
              {ICONS[n.type]}
            </span>
            <span style={{ flex: 1 }}>{n.message}</span>
            <button onClick={() => removeNotification(n.id)} style={{
              background: 'none', border: 'none', color: 'var(--outline, #999)',
              cursor: 'pointer', padding: '2px', lineHeight: 1, flexShrink: 0,
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
            </button>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotification must be used within NotificationProvider');
  return ctx;
}

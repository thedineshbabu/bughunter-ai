import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: '60vh', padding: '2rem',
        }}>
          <div className="glass-card" style={{
            padding: '2.5rem', borderRadius: '12px', textAlign: 'center',
            maxWidth: '480px', width: '100%',
            border: '1px solid var(--border-subtle)',
            borderLeft: '4px solid var(--error)',
          }}>
            <span className="material-symbols-outlined" style={{
              fontSize: '48px', color: 'var(--error)', marginBottom: '1rem', display: 'block',
            }}>error</span>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--on-surface)', marginBottom: '0.5rem' }}>
              Something went wrong
            </h2>
            <p style={{ color: 'var(--on-surface-variant)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button onClick={this.handleReset} className="btn-primary" style={{ padding: '10px 24px', fontSize: '0.875rem' }}>
                Try Again
              </button>
              <button onClick={() => window.location.reload()} style={{
                padding: '10px 24px', fontSize: '0.875rem', background: 'transparent',
                border: '1px solid var(--border-subtle)', borderRadius: '8px',
                color: 'var(--on-surface)', cursor: 'pointer',
              }}>
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

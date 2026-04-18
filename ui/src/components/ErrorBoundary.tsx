import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '../lib/logger';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error('error', 'react_crash', { message: error.message, stack: error.stack?.slice(0, 500), componentStack: info.componentStack?.slice(0, 500) });
    console.error('[ErrorBoundary]', error, info.componentStack);
    // Post crash info to backend so it appears in terminal logs
    fetch('/api/ui-crash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: error.message, stack: error.stack?.slice(0, 2000), componentStack: info.componentStack?.slice(0, 2000) }),
    }).catch(() => {});
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', maxWidth: 600, margin: '4rem auto', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>出错了</h1>
          <p style={{ color: '#888', marginBottom: '1rem' }}>
            应用遇到意外错误，请刷新页面重试。
          </p>
          <pre style={{
            background: '#1e1e2e', color: '#f38ba8', padding: '1rem',
            borderRadius: 8, fontSize: '0.8rem', textAlign: 'left',
            overflow: 'auto', maxHeight: 200,
          }}>
            {this.state.error.message}
          </pre>
          <pre style={{
            background: '#1e1e2e', color: '#89b4fa', padding: '1rem',
            borderRadius: 8, fontSize: '0.7rem', textAlign: 'left',
            overflow: 'auto', maxHeight: 300, marginTop: '0.5rem',
          }}>
            {this.state.error.stack}
          </pre>
          <button
            style={{
              marginTop: '1rem', padding: '0.5rem 1.5rem',
              background: '#7c3aed', color: '#fff', border: 'none',
              borderRadius: 6, cursor: 'pointer',
            }}
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

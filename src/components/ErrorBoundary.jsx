import { Component } from 'react';

/**
 * ErrorBoundary — catches render errors so the whole app doesn't vanish
 * into a blank page (React has no built-in boundary; without one, any
 * uncaught render error unmounts the entire tree).
 *
 * Shows a minimal recoverable UI with a "重新加载" button instead of
 * forcing the user to manually refresh the browser.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Render error caught by ErrorBoundary:', error, info);
  }

  handleReload = () => {
    this.setState({ error: null });
    // Hard reload to get a clean state
    window.location.reload();
  };

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', gap: 12, padding: 24,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          color: '#1d1d1f', textAlign: 'center',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>页面渲染出错</div>
          <div style={{ fontSize: 13, color: '#86868b', maxWidth: 420, lineHeight: 1.5 }}>
            {String(this.state.error?.message || this.state.error)}
          </div>
          <button
            onClick={this.handleReload}
            style={{
              marginTop: 4, padding: '7px 18px', fontSize: 13, fontWeight: 500,
              border: 'none', borderRadius: 8, background: '#0071e3', color: '#fff',
              cursor: 'pointer',
            }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

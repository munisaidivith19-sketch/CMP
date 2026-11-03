import { Component } from 'react';

/** A bug in one screen must not blank the gate: show a way back and keep the details in Diagnostics. */
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    try {
      window.gate?.diag?.record({ event: 'ui_error', message: String(error?.message || error).slice(0, 200) });
    } catch {
      /* diagnostics unavailable */
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-screen items-center justify-center p-6">
        <div className="card max-w-md text-center">
          <p className="text-lg font-extrabold">Something went wrong on this screen</p>
          <p className="mt-2 text-sm muted">Your sign-in and every recorded scan are safe on the server. Reload to carry on scanning.</p>
          <button type="button" className="btn btn-primary mt-4" onClick={() => window.location.reload()}>
            Reload the Gate Scanner
          </button>
        </div>
      </div>
    );
  }
}

import { Component } from 'react';
import { reportClientError } from '../services/errorReporter';

/**
 * Catches render crashes below it, shows a recovery screen instead of a
 * blank page, and reports the crash to the Super Admin SOC. `resetKey`
 * (the current path) clears the error when the user navigates away.
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
    reportClientError({ kind: 'render', message: error?.message, name: error?.name, stack: error?.stack, componentStack: info?.componentStack });
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="card mx-auto my-10 max-w-md text-center">
        <p className="text-lg font-extrabold">This part of VEXON hit a problem</p>
        <p className="mt-2 text-sm muted">The error was reported automatically. You can try again, or go to another page.</p>
        <button type="button" className="btn btn-primary mt-4" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto mt-16 max-w-lg rounded-xl border border-red-300 bg-red-50 p-6">
        <h1 className="text-lg font-semibold text-red-900">Something went wrong</h1>
        <p className="mt-1 text-sm text-red-900">{this.state.error.message}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white">
          Reload
        </button>
      </div>
    );
  }
}

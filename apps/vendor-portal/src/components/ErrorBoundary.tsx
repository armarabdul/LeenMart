import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

interface State {
  readonly error: Error | null;
}

/** Route-level error boundary — mirrors `customer-pwa`'s own `ErrorBoundary` exactly (SDD 17.2). */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.error('Unhandled render error', error, info.componentStack);
    }
  }

  private readonly handleReset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    const { children, fallback } = this.props;

    if (!error) return children;
    if (fallback) return fallback;

    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
        <p className="max-w-md text-sm text-slate-600">
          The page could not be displayed. Try again, and if the problem persists please contact
          support.
        </p>
        {import.meta.env.DEV && (
          <pre className="max-w-full overflow-auto rounded bg-slate-100 p-4 text-left text-xs text-red-700">
            {error.stack ?? error.message}
          </pre>
        )}
        <button
          type="button"
          onClick={this.handleReset}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }
}

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Alert, Button } from '@leen-mart/ui';

interface Props {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}

interface State {
  readonly error: Error | null;
}

/**
 * Route-level error boundary (SDD 17.2).
 *
 * A render error in one route must not blank the whole application. In
 * production this is where the error would be forwarded to Sentry; the internal
 * detail is shown only in development.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Replaced by the error-reporting adapter once observability is wired up.
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
        <h1 className="font-display text-xl font-semibold text-text">Something went wrong</h1>
        <Alert tone="danger" className="max-w-md text-left">
          The page could not be displayed. Try again, and if the problem persists please contact
          support.
        </Alert>
        {import.meta.env.DEV && (
          <pre className="max-w-full overflow-auto rounded bg-surface-alt p-4 text-left text-xs text-danger">
            {error.stack ?? error.message}
          </pre>
        )}
        <Button type="button" onClick={this.handleReset}>
          Try again
        </Button>
      </div>
    );
  }
}

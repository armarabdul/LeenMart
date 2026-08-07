import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const Explode = (): never => {
  throw new Error('render blew up');
};

describe('ErrorBoundary', () => {
  it('renders children when nothing goes wrong', () => {
    render(
      <ErrorBoundary>
        <p>all good</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('contains a render error instead of blanking the application', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <Explode />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('renders a supplied fallback', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary fallback={<p>custom fallback</p>}>
        <Explode />
      </ErrorBoundary>,
    );

    expect(screen.getByText('custom fallback')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});

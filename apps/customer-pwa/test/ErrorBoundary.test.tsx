import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '@/components/ErrorBoundary';

const Explode = (): never => {
  throw new Error('render blew up');
};

/** Throws until `shouldThrow` is flipped from outside — lets a test drive recovery. */
let shouldThrow = true;
const ToggleBomb = (): JSX.Element => {
  if (shouldThrow) throw new Error('render blew up');
  return <p>recovered content</p>;
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

  it('surfaces the error message as an accessible alert', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <Explode />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The page could not be displayed. Try again, and if the problem persists please contact support.',
    );
    consoleError.mockRestore();
  });

  it('recovers and renders the children again once "Try again" is clicked', () => {
    shouldThrow = true;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <ToggleBomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.getByText('recovered content')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('shows the internal error detail in development', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const originalDev = import.meta.env.DEV;
    import.meta.env.DEV = true;

    render(
      <ErrorBoundary>
        <Explode />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/render blew up/)).toBeInTheDocument();

    import.meta.env.DEV = originalDev;
    consoleError.mockRestore();
  });

  it('never exposes internal error detail outside development', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const originalDev = import.meta.env.DEV;
    import.meta.env.DEV = false;

    render(
      <ErrorBoundary>
        <Explode />
      </ErrorBoundary>,
    );

    expect(screen.queryByText(/render blew up/)).not.toBeInTheDocument();

    import.meta.env.DEV = originalDev;
    consoleError.mockRestore();
  });
});

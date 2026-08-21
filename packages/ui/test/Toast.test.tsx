import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from '../src/components/Toast.js';

const Trigger = ({ duration }: { readonly duration?: number } = {}): JSX.Element => {
  const { show } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        show({
          title: 'Review submitted',
          tone: 'success',
          ...(duration === undefined ? {} : { duration }),
        })
      }
    >
      Submit
    </button>
  );
};

describe('ToastProvider / useToast', () => {
  it('shows a toast fired via useToast()', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(screen.getByText('Review submitted')).toBeInTheDocument();
  });

  it('dismisses immediately when its close button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText('Review submitted')).not.toBeInTheDocument();
  });

  it('auto-dismisses after its duration', async () => {
    // Fake timers make this deterministic: `setTimeout(..., 30)` inside
    // `ToastProvider` was racing against the test's own real-clock overhead,
    // so on a loaded machine the dismiss could fire before the "still
    // visible" assertion below ever ran. Advancing time ourselves removes
    // that race instead of just widening it with a bigger duration.
    //
    // `fireEvent.click` rather than `userEvent.click` here specifically:
    // user-event's own internal event-dispatch delays need fake timers
    // advanced *while* `click()` is still in flight (via its `advanceTimers`
    // setup option) or the awaited call never resolves. `fireEvent` has no
    // such internal delay, so it needs no special fake-timer wiring at all.
    vi.useFakeTimers();
    try {
      render(
        <ToastProvider>
          <Trigger duration={30} />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
      expect(screen.getByText('Review submitted')).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30);
      });

      expect(screen.queryByText('Review submitted')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws when used outside a ToastProvider — a toast fired into nothing is a bug', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Trigger />)).toThrow(/ToastProvider/);
    consoleError.mockRestore();
  });
});

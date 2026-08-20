import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <Trigger duration={30} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(screen.getByText('Review submitted')).toBeInTheDocument();

    await waitFor(() => expect(screen.queryByText('Review submitted')).not.toBeInTheDocument());
  });

  it('throws when used outside a ToastProvider — a toast fired into nothing is a bug', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Trigger />)).toThrow(/ToastProvider/);
    consoleError.mockRestore();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createStore } from '@/app/store';
import { VendorStatusActionPanel } from '@/features/vendor-management/components/VendorStatusActionPanel';
import {
  useReinstateVendorMutation,
  useSuspendVendorMutation,
} from '@/features/vendor-management/vendor-management.api';

vi.mock('@/features/vendor-management/vendor-management.api', () => ({
  useSuspendVendorMutation: vi.fn(),
  useReinstateVendorMutation: vi.fn(),
}));

const mockedUseSuspendVendorMutation = vi.mocked(useSuspendVendorMutation);
const mockedUseReinstateVendorMutation = vi.mocked(useReinstateVendorMutation);

const mockSuspend = vi.fn();
const mockReinstate = vi.fn();

const stubMutations = (
  options: {
    isSuspending?: boolean;
    suspendError?: unknown;
    isReinstating?: boolean;
    reinstateError?: unknown;
    suspendResult?: unknown;
    reinstateResult?: unknown;
  } = {},
): void => {
  mockSuspend.mockReset();
  mockReinstate.mockReset();
  mockSuspend.mockReturnValue({ unwrap: () => Promise.resolve(options.suspendResult ?? {}) });
  mockReinstate.mockReturnValue({ unwrap: () => Promise.resolve(options.reinstateResult ?? {}) });

  mockedUseSuspendVendorMutation.mockReturnValue([
    mockSuspend,
    { isLoading: options.isSuspending ?? false, error: options.suspendError },
  ] as unknown as ReturnType<typeof useSuspendVendorMutation>);
  mockedUseReinstateVendorMutation.mockReturnValue([
    mockReinstate,
    { isLoading: options.isReinstating ?? false, error: options.reinstateError },
  ] as unknown as ReturnType<typeof useReinstateVendorMutation>);
};

const renderPanel = (status: 'ACTIVE' | 'SUSPENDED'): void => {
  render(
    <Provider store={createStore()}>
      <VendorStatusActionPanel vendorId="vendor-1" status={status} />
    </Provider>,
  );
};

// Split into several top-level `describe`s rather than one nesting them all,
// purely to stay under this repository's max-lines-per-function budget —
// each one is independently well under it.

describe('VendorStatusActionPanel status rendering', () => {
  it('shows a Suspend action for an ACTIVE vendor', () => {
    stubMutations();
    renderPanel('ACTIVE');

    expect(screen.getByRole('button', { name: 'Suspend vendor' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reinstate vendor' })).not.toBeInTheDocument();
  });

  it('shows a Reinstate action for a SUSPENDED vendor', () => {
    stubMutations();
    renderPanel('SUSPENDED');

    expect(screen.getByRole('button', { name: 'Reinstate vendor' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend vendor' })).not.toBeInTheDocument();
  });
});

describe('VendorStatusActionPanel suspend confirmation', () => {
  it('reveals a reason-required confirmation form on click', () => {
    stubMutations();
    renderPanel('ACTIVE');

    fireEvent.click(screen.getByRole('button', { name: 'Suspend vendor' }));

    expect(screen.getByLabelText('Reason (required)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm suspension' })).toBeInTheDocument();
  });

  it('an empty reason cannot submit', () => {
    stubMutations();
    renderPanel('ACTIVE');
    fireEvent.click(screen.getByRole('button', { name: 'Suspend vendor' }));

    expect(screen.getByRole('button', { name: 'Confirm suspension' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm suspension' }));
    expect(mockSuspend).not.toHaveBeenCalled();
  });

  it('a whitespace-only reason cannot submit', () => {
    stubMutations();
    renderPanel('ACTIVE');
    fireEvent.click(screen.getByRole('button', { name: 'Suspend vendor' }));

    fireEvent.change(screen.getByLabelText('Reason (required)'), {
      target: { value: '   ' },
    });

    expect(screen.getByRole('button', { name: 'Confirm suspension' })).toBeDisabled();
  });

  it('a valid reason submits, sending the trimmed reason to the vendor id', async () => {
    stubMutations();
    renderPanel('ACTIVE');
    fireEvent.click(screen.getByRole('button', { name: 'Suspend vendor' }));

    fireEvent.change(screen.getByLabelText('Reason (required)'), {
      target: { value: '  Repeated late fulfilment  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm suspension' }));

    await waitFor(() =>
      expect(mockSuspend).toHaveBeenCalledWith({
        vendorId: 'vendor-1',
        body: { reason: 'Repeated late fulfilment' },
      }),
    );
  });

  it('Cancel closes the form without submitting', () => {
    stubMutations();
    renderPanel('ACTIVE');
    fireEvent.click(screen.getByRole('button', { name: 'Suspend vendor' }));
    fireEvent.change(screen.getByLabelText('Reason (required)'), {
      target: { value: 'a reason' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockSuspend).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Suspend vendor' })).toBeInTheDocument();
  });
});

describe('VendorStatusActionPanel reinstate flow', () => {
  it('reveals an optional-reason confirmation form on click', () => {
    stubMutations();
    renderPanel('SUSPENDED');

    fireEvent.click(screen.getByRole('button', { name: 'Reinstate vendor' }));

    expect(screen.getByLabelText('Reason (optional)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm reinstatement' })).not.toBeDisabled();
  });

  it('submits with no reason at all — reinstatement does not require one', async () => {
    stubMutations();
    renderPanel('SUSPENDED');
    fireEvent.click(screen.getByRole('button', { name: 'Reinstate vendor' }));

    fireEvent.click(screen.getByRole('button', { name: 'Confirm reinstatement' }));

    await waitFor(() =>
      expect(mockReinstate).toHaveBeenCalledWith({ vendorId: 'vendor-1', body: {} }),
    );
  });

  it('submits a supplied reason when one is given', async () => {
    stubMutations();
    renderPanel('SUSPENDED');
    fireEvent.click(screen.getByRole('button', { name: 'Reinstate vendor' }));

    fireEvent.change(screen.getByLabelText('Reason (optional)'), {
      target: { value: 'Appeal upheld' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm reinstatement' }));

    await waitFor(() =>
      expect(mockReinstate).toHaveBeenCalledWith({
        vendorId: 'vendor-1',
        body: { reason: 'Appeal upheld' },
      }),
    );
  });
});

describe('VendorStatusActionPanel loading and error states', () => {
  it('disables Confirm and Cancel while a suspension is in flight', () => {
    stubMutations({ isSuspending: true });
    renderPanel('ACTIVE');
    fireEvent.click(screen.getByRole('button', { name: 'Suspend vendor' }));

    expect(screen.getByRole('button', { name: 'Confirm suspension' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });

  it('shows the API error message for a failed suspension', () => {
    stubMutations({
      suspendError: {
        status: 500,
        data: { error: { code: 'INTERNAL', message: 'Server exploded' } },
      },
    });
    renderPanel('ACTIVE');
    fireEvent.click(screen.getByRole('button', { name: 'Suspend vendor' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Server exploded');
  });

  it('shows a clean, generic message for a 403 — never a raw permission error', () => {
    stubMutations({
      suspendError: { status: 403, data: { error: { code: 'UNAUTHORIZED', message: 'nope' } } },
    });
    renderPanel('ACTIVE');
    fireEvent.click(screen.getByRole('button', { name: 'Suspend vendor' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'You do not have permission to perform this action.',
    );
  });

  it('closes and resets the confirmation form after a successful suspension', async () => {
    stubMutations();
    renderPanel('ACTIVE');
    fireEvent.click(screen.getByRole('button', { name: 'Suspend vendor' }));
    fireEvent.change(screen.getByLabelText('Reason (required)'), {
      target: { value: 'a reason' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm suspension' }));

    expect(await screen.findByRole('button', { name: 'Suspend vendor' })).toBeInTheDocument();
  });
});

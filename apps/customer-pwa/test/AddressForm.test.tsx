import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AddressForm } from '@/features/address/components/AddressForm';
import { useAddAddressMutation } from '@/features/address/address.api';

vi.mock('@/features/address/address.api', () => ({
  useAddAddressMutation: vi.fn(),
}));

const mockedUseAddAddressMutation = vi.mocked(useAddAddressMutation);
const mockAddAddress = vi.fn();

interface StubOptions {
  readonly isLoading?: boolean;
  readonly error?: unknown;
}

const stubAddAddress = (options: StubOptions = {}): void => {
  mockAddAddress.mockReset();
  mockAddAddress.mockReturnValue({ unwrap: () => Promise.resolve({ id: 'address-new' }) });
  mockedUseAddAddressMutation.mockReturnValue([
    mockAddAddress,
    { isLoading: options.isLoading ?? false, error: options.error },
  ] as unknown as ReturnType<typeof useAddAddressMutation>);
};

const renderForm = (): {
  onAdded: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
} => {
  const onAdded = vi.fn();
  const onCancel = vi.fn();
  render(<AddressForm onAdded={onAdded} onCancel={onCancel} />);
  return { onAdded, onCancel };
};

const fillValid = (): void => {
  fireEvent.change(screen.getByLabelText('Recipient name'), { target: { value: 'Asha Rao' } });
  fireEvent.change(screen.getByLabelText('Phone (+91XXXXXXXXXX)'), {
    target: { value: '+919876543210' },
  });
  fireEvent.change(screen.getByLabelText('Address line 1'), {
    target: { value: '221B Baker Street' },
  });
  fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Bengaluru' } });
  fireEvent.change(screen.getByLabelText('State'), { target: { value: 'Karnataka' } });
  fireEvent.change(screen.getByLabelText('PIN code'), { target: { value: '560001' } });
  fireEvent.change(screen.getByLabelText('Label (e.g. Home, Office)'), {
    target: { value: 'Home' },
  });
};

describe('AddressForm field validation (Phase H)', () => {
  it('reports every empty required field inline and does not call the API', () => {
    stubAddAddress();
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    expect(screen.getAllByText('String must contain at least 1 character(s)')).toHaveLength(5);
    expect(
      screen.getByText('Must be a valid Indian mobile number in E.164 format (+91XXXXXXXXXX)'),
    ).toBeInTheDocument();
    expect(screen.getByText('Must be a valid 6-digit PIN code')).toBeInTheDocument();
    expect(mockAddAddress).not.toHaveBeenCalled();
  });

  it('does not require the two optional fields', () => {
    stubAddAddress();
    renderForm();
    fillValid();

    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    expect(screen.queryByLabelText('Address line 2 (optional)')).not.toHaveAttribute(
      'aria-invalid',
    );
    expect(screen.queryByLabelText('Landmark (optional)')).not.toHaveAttribute('aria-invalid');
  });

  it('reports a malformed phone number using the real E.164 rule', () => {
    stubAddAddress();
    renderForm();

    const phone = screen.getByLabelText('Phone (+91XXXXXXXXXX)');
    fireEvent.change(phone, { target: { value: '12345' } });
    fireEvent.blur(phone);

    expect(
      screen.getByText('Must be a valid Indian mobile number in E.164 format (+91XXXXXXXXXX)'),
    ).toBeInTheDocument();
    expect(phone).toHaveAttribute('aria-invalid', 'true');
  });

  it('reports a malformed PIN code using the real 6-digit rule', () => {
    stubAddAddress();
    renderForm();

    const pincode = screen.getByLabelText('PIN code');
    fireEvent.change(pincode, { target: { value: '12' } });
    fireEvent.blur(pincode);

    expect(screen.getByText('Must be a valid 6-digit PIN code')).toBeInTheDocument();
  });

  it('clears the phone error once the value becomes a valid number', () => {
    stubAddAddress();
    renderForm();

    const phone = screen.getByLabelText('Phone (+91XXXXXXXXXX)');
    fireEvent.change(phone, { target: { value: '12345' } });
    fireEvent.blur(phone);
    expect(
      screen.getByText('Must be a valid Indian mobile number in E.164 format (+91XXXXXXXXXX)'),
    ).toBeInTheDocument();

    fireEvent.change(phone, { target: { value: '+919876543210' } });
    expect(
      screen.queryByText('Must be a valid Indian mobile number in E.164 format (+91XXXXXXXXXX)'),
    ).not.toBeInTheDocument();
  });

  it('submits the exact valid payload once every field is correct', async () => {
    stubAddAddress();
    const { onAdded } = renderForm();
    fillValid();

    fireEvent.click(screen.getByRole('button', { name: 'Save address' }));

    await vi.waitFor(() =>
      expect(mockAddAddress).toHaveBeenCalledWith({
        recipientName: 'Asha Rao',
        phone: '+919876543210',
        line1: '221B Baker Street',
        line2: '',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        landmark: '',
        label: 'Home',
      }),
    );
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledWith('address-new'));
  });

  it('does not submit while a save is already in flight', () => {
    stubAddAddress({ isLoading: true });
    renderForm();
    fillValid();

    const form = screen.getByRole('button', { name: 'Saving…' }).closest('form');
    if (form) fireEvent.submit(form);

    expect(mockAddAddress).not.toHaveBeenCalled();
  });
});

describe('AddressForm server-side error presentation (Phase H)', () => {
  it('maps a field-scoped validation error from the API onto that field', () => {
    stubAddAddress({
      error: {
        status: 400,
        data: {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'The request payload failed validation.',
            details: [{ field: 'body.pincode', issue: 'Must be a valid 6-digit PIN code' }],
            requestId: 'req-1',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });
    renderForm();

    expect(screen.getByText('Must be a valid 6-digit PIN code')).toBeInTheDocument();
    // Mapped to the field — the generic envelope message is not repeated as
    // a separate form-level banner alongside it.
    expect(screen.queryByText('The request payload failed validation.')).not.toBeInTheDocument();
  });

  it('falls back to a form-level alert when the error cannot be mapped to a field', () => {
    stubAddAddress({
      error: {
        status: 500,
        data: {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred.',
            requestId: 'req-2',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });
    renderForm();

    expect(screen.getByRole('alert')).toHaveTextContent('An unexpected error occurred.');
  });
});

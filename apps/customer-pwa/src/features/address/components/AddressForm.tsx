import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { AddAddressRequest } from '@leen-mart/contracts';
import { Alert, Button, Input } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { useAddAddressMutation } from '../address.api';

interface AddressFormProps {
  readonly onAdded: (addressId: string) => void;
  readonly onCancel: () => void;
}

const EMPTY_FORM: AddAddressRequest = {
  recipientName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  pincode: '',
  landmark: '',
  label: '',
};

/** A new-address form, used inline within checkout's address step — there is no standalone address-book page in S3-3A. */
export const AddressForm = ({ onAdded, onCancel }: AddressFormProps): JSX.Element => {
  const [form, setForm] = useState<AddAddressRequest>(EMPTY_FORM);
  const [addAddress, { isLoading, error }] = useAddAddressMutation();

  const set =
    (field: keyof AddAddressRequest) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      setForm((current) => ({ ...current, [field]: event.target.value }));
    };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    try {
      const created = await addAddress(form).unwrap();
      onAdded(created.id);
    } catch {
      // Surfaced below via `error`; nothing further to do here.
    }
  };

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input
          label="Recipient name"
          required
          value={form.recipientName}
          onChange={set('recipientName')}
        />
        <Input label="Phone (+91XXXXXXXXXX)" required value={form.phone} onChange={set('phone')} />
      </div>

      <Input label="Address line 1" required value={form.line1} onChange={set('line1')} />
      <Input label="Address line 2 (optional)" value={form.line2 ?? ''} onChange={set('line2')} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Input label="City" required value={form.city} onChange={set('city')} />
        <Input label="State" required value={form.state} onChange={set('state')} />
        <Input label="PIN code" required value={form.pincode} onChange={set('pincode')} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Landmark (optional)" value={form.landmark ?? ''} onChange={set('landmark')} />
        <Input
          label="Label (e.g. Home, Office)"
          required
          value={form.label}
          onChange={set('label')}
        />
      </div>

      {error !== undefined && <Alert tone="danger">{apiErrorMessage(error)}</Alert>}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isLoading}>
          {isLoading ? 'Saving…' : 'Save address'}
        </Button>
      </div>
    </form>
  );
};

import { useState, type ChangeEvent, type FormEvent } from 'react';
import type { AddAddressRequest } from '@leen-mart/contracts';
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

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

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
      className="flex flex-col gap-3 rounded-md border border-slate-200 p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Recipient name
          <input
            required
            value={form.recipientName}
            onChange={set('recipientName')}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Phone (+91XXXXXXXXXX)
          <input required value={form.phone} onChange={set('phone')} className={inputClass} />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Address line 1
        <input required value={form.line1} onChange={set('line1')} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        Address line 2 (optional)
        <input value={form.line2 ?? ''} onChange={set('line2')} className={inputClass} />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          City
          <input required value={form.city} onChange={set('city')} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          State
          <input required value={form.state} onChange={set('state')} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          PIN code
          <input required value={form.pincode} onChange={set('pincode')} className={inputClass} />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Landmark (optional)
          <input value={form.landmark ?? ''} onChange={set('landmark')} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-700">
          Label (e.g. Home, Office)
          <input required value={form.label} onChange={set('label')} className={inputClass} />
        </label>
      </div>

      {error !== undefined && (
        <p role="alert" className="text-sm text-red-700">
          {apiErrorMessage(error)}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {isLoading ? 'Saving…' : 'Save address'}
        </button>
      </div>
    </form>
  );
};

import { useRef, useState, type ChangeEvent, type FormEvent, type RefObject } from 'react';
import { addAddressRequestSchema, type AddAddressRequest } from '@leen-mart/contracts';
import { Alert, Button, Input } from '@leen-mart/ui';
import { apiErrorMessage, apiFieldErrors } from '@/shared/api/base-api';
import { validateWithSchema } from '@/shared/lib/validate-with-schema';
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

type FieldName = keyof AddAddressRequest;
/** Top-to-bottom visual order — also the order the first invalid field is chosen from on a blocked submit. */
const FIELD_ORDER: readonly FieldName[] = [
  'recipientName',
  'phone',
  'line1',
  'line2',
  'city',
  'state',
  'pincode',
  'landmark',
  'label',
];

interface FieldGroupProps {
  readonly form: AddAddressRequest;
  readonly fieldRefs: Record<FieldName, RefObject<HTMLInputElement>>;
  readonly set: (field: FieldName) => (event: ChangeEvent<HTMLInputElement>) => void;
  readonly markTouched: (field: FieldName) => () => void;
  readonly fieldError: (field: FieldName) => string | undefined;
}

const NameAndPhoneFields = ({
  form,
  fieldRefs,
  set,
  markTouched,
  fieldError,
}: FieldGroupProps): JSX.Element => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <Input
      ref={fieldRefs.recipientName}
      label="Recipient name"
      required
      maxLength={100}
      value={form.recipientName}
      onChange={set('recipientName')}
      onBlur={markTouched('recipientName')}
      error={fieldError('recipientName')}
    />
    <Input
      ref={fieldRefs.phone}
      label="Phone (+91XXXXXXXXXX)"
      required
      inputMode="tel"
      maxLength={13}
      value={form.phone}
      onChange={set('phone')}
      onBlur={markTouched('phone')}
      error={fieldError('phone')}
    />
  </div>
);

const AddressLineFields = ({
  form,
  fieldRefs,
  set,
  markTouched,
  fieldError,
}: FieldGroupProps): JSX.Element => (
  <>
    <Input
      ref={fieldRefs.line1}
      label="Address line 1"
      required
      maxLength={200}
      value={form.line1}
      onChange={set('line1')}
      onBlur={markTouched('line1')}
      error={fieldError('line1')}
    />
    <Input
      ref={fieldRefs.line2}
      label="Address line 2 (optional)"
      maxLength={200}
      value={form.line2 ?? ''}
      onChange={set('line2')}
      onBlur={markTouched('line2')}
      error={fieldError('line2')}
    />
  </>
);

const CityStatePincodeFields = ({
  form,
  fieldRefs,
  set,
  markTouched,
  fieldError,
}: FieldGroupProps): JSX.Element => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
    <Input
      ref={fieldRefs.city}
      label="City"
      required
      maxLength={100}
      value={form.city}
      onChange={set('city')}
      onBlur={markTouched('city')}
      error={fieldError('city')}
    />
    <Input
      ref={fieldRefs.state}
      label="State"
      required
      maxLength={100}
      value={form.state}
      onChange={set('state')}
      onBlur={markTouched('state')}
      error={fieldError('state')}
    />
    <Input
      ref={fieldRefs.pincode}
      label="PIN code"
      required
      inputMode="numeric"
      maxLength={6}
      value={form.pincode}
      onChange={set('pincode')}
      onBlur={markTouched('pincode')}
      error={fieldError('pincode')}
    />
  </div>
);

const LandmarkAndLabelFields = ({
  form,
  fieldRefs,
  set,
  markTouched,
  fieldError,
}: FieldGroupProps): JSX.Element => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <Input
      ref={fieldRefs.landmark}
      label="Landmark (optional)"
      maxLength={200}
      value={form.landmark ?? ''}
      onChange={set('landmark')}
      onBlur={markTouched('landmark')}
      error={fieldError('landmark')}
    />
    <Input
      ref={fieldRefs.label}
      label="Label (e.g. Home, Office)"
      required
      maxLength={50}
      value={form.label}
      onChange={set('label')}
      onBlur={markTouched('label')}
      error={fieldError('label')}
    />
  </div>
);

/** A new-address form, used inline within checkout's address step — there is no standalone address-book page in S3-3A. */
export const AddressForm = ({ onAdded, onCancel }: AddressFormProps): JSX.Element => {
  const [form, setForm] = useState<AddAddressRequest>(EMPTY_FORM);
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [addAddress, { isLoading, error }] = useAddAddressMutation();

  // One `useRef` per field, written out rather than built from `FIELD_ORDER`
  // in a loop — hooks must be called the same way on every render, and a
  // loop over an array (even a static one) is exactly the shape the rules
  // of hooks exist to catch, so this stays explicit instead.
  const recipientNameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const line1Ref = useRef<HTMLInputElement>(null);
  const line2Ref = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLInputElement>(null);
  const pincodeRef = useRef<HTMLInputElement>(null);
  const landmarkRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLInputElement>(null);
  const fieldRefs: Record<FieldName, RefObject<HTMLInputElement>> = {
    recipientName: recipientNameRef,
    phone: phoneRef,
    line1: line1Ref,
    line2: line2Ref,
    city: cityRef,
    state: stateRef,
    pincode: pincodeRef,
    landmark: landmarkRef,
    label: labelRef,
  };

  // `addAddressRequestSchema` is the exact schema the API validates the
  // request body with (Phase H) — this can never quietly drift from what
  // the server actually requires, the same reasoning `validateWithSchema`'s
  // own doc comment gives.
  const localErrors = validateWithSchema(addAddressRequestSchema, form);
  const serverFieldErrors = apiFieldErrors(error);
  const hasMappedServerError = Object.keys(serverFieldErrors).length > 0;
  const fieldError = (field: FieldName): string | undefined =>
    (touched[field] ? localErrors[field] : undefined) ?? serverFieldErrors[field];

  const set =
    (field: FieldName) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      setForm((current) => ({ ...current, [field]: event.target.value }));
    };

  const markTouched = (field: FieldName) => (): void => {
    setTouched((current) => ({ ...current, [field]: true }));
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (isLoading) return;

    setTouched(Object.fromEntries(FIELD_ORDER.map((field) => [field, true])));
    if (Object.keys(localErrors).length > 0) {
      const firstInvalid = FIELD_ORDER.find((field) => localErrors[field]);
      if (firstInvalid) fieldRefs[firstInvalid].current?.focus();
      return;
    }

    try {
      const created = await addAddress(form).unwrap();
      onAdded(created.id);
    } catch {
      // Surfaced below via `error`; nothing further to do here.
    }
  };

  const fieldGroupProps: FieldGroupProps = { form, fieldRefs, set, markTouched, fieldError };

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
      noValidate
    >
      <NameAndPhoneFields {...fieldGroupProps} />
      <AddressLineFields {...fieldGroupProps} />
      <CityStatePincodeFields {...fieldGroupProps} />
      <LandmarkAndLabelFields {...fieldGroupProps} />

      {error !== undefined && !hasMappedServerError && (
        <Alert tone="danger">{apiErrorMessage(error)}</Alert>
      )}

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

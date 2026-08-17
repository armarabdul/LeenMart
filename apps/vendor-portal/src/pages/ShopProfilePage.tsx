import { useEffect, useState } from 'react';
import type { SetVendorShopAddressRequest, VendorShopAddressResponse } from '@leen-mart/contracts';
import { apiErrorMessage } from '@/shared/api/base-api';
import {
  useGetServiceablePincodesQuery,
  useGetShopProfileQuery,
  useSetServiceablePincodesMutation,
  useSetShopAddressMutation,
} from '@/features/shop-profile/shop-profile.api';

const ProfileSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4">
    {Array.from({ length: 3 }, (_, index) => (
      <div key={index} className="h-20 w-full animate-pulse rounded-md bg-slate-100" />
    ))}
  </div>
);

interface AddressForm {
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}

const EMPTY_FORM: AddressForm = { line1: '', line2: '', city: '', state: '', pincode: '' };

const FIELDS: readonly {
  readonly name: keyof AddressForm;
  readonly label: string;
  readonly optional?: boolean;
  readonly maxLength: number;
}[] = [
  { name: 'line1', label: 'Address line 1', maxLength: 200 },
  { name: 'line2', label: 'Address line 2', optional: true, maxLength: 200 },
  { name: 'city', label: 'City', maxLength: 100 },
  { name: 'state', label: 'State', maxLength: 100 },
  { name: 'pincode', label: 'Pincode', maxLength: 6 },
];

/** Accepts commas, spaces and newlines so a vendor can paste a list from anywhere. */
const parsePincodes = (raw: string): readonly string[] =>
  raw
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

/**
 * Delivery serviceability (S4-SERV, locked decision D1).
 *
 * Lives on the shop-profile page rather than in a page of its own — it is
 * another self-service vendor setting, and S4-ADDR already established this
 * page as where those live.
 *
 * The empty state is stated explicitly rather than left to inference: an empty
 * list means "delivers everywhere" (locked decision D7), and a vendor seeing a
 * blank box could reasonably read the opposite.
 */
const ServiceablePincodesSection = (): JSX.Element => {
  const { data, isLoading, isError, error } = useGetServiceablePincodesQuery();
  const [setServiceablePincodes, { isLoading: isSaving, error: saveError }] =
    useSetServiceablePincodesMutation();
  const [raw, setRaw] = useState('');
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!data) return;
    setRaw(data.pincodes.join('\n'));
  }, [data]);

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setSaved(false);
    setFailed(false);
    try {
      await setServiceablePincodes({ pincodes: [...parsePincodes(raw)] }).unwrap();
      setSaved(true);
    } catch {
      setFailed(true);
    }
  };

  if (isLoading) return <ProfileSkeleton />;

  if (isError || !data) {
    return (
      <p
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
      >
        {apiErrorMessage(error, 'Your delivery areas could not be loaded.')}
      </p>
    );
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      {!data.configured && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          You have not set any delivery areas, so you currently receive delivery orders from
          everywhere. Adding pincodes below will limit deliveries to only those areas.
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm text-slate-700">
        <span>Delivery pincodes</span>
        <span className="text-xs text-slate-500">
          One per line, or separated by commas. Pickup orders are never affected by this list.
        </span>
        <textarea
          name="pincodes"
          value={raw}
          onChange={(event) => {
            setSaved(false);
            setFailed(false);
            setRaw(event.target.value);
          }}
          rows={6}
          className="rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
        />
      </label>

      {failed && (
        <p role="alert" className="text-sm text-red-700">
          {apiErrorMessage(saveError, 'Your delivery areas could not be saved.')}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-green-700">
          Delivery areas saved.
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save delivery areas'}
        </button>
      </div>
    </form>
  );
};

/**
 * The shop-address form (S4-ADDR). Split out of `ShopProfilePage` when
 * S4-SERV added a second section, so neither the page nor either section
 * exceeds this repository's function-length budget.
 */
const ShopAddressForm = ({
  profile,
}: {
  readonly profile: VendorShopAddressResponse;
}): JSX.Element => {
  const [setShopAddress, { isLoading: isSaving, error: saveError }] = useSetShopAddressMutation();
  const [form, setForm] = useState<AddressForm>(EMPTY_FORM);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  // Seeds the form from the server's copy once it arrives, and re-seeds after
  // a save so the fields always show what is actually stored rather than what
  // was last typed.
  useEffect(() => {
    if (!profile?.shopAddress) return;
    const { line1, line2, city, state, pincode } = profile.shopAddress;
    setForm({ line1, line2: line2 ?? '', city, state, pincode });
  }, [profile]);

  const update =
    (name: keyof AddressForm) =>
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      setSaved(false);
      setFailed(false);
      setForm((current) => ({ ...current, [name]: event.target.value }));
    };

  const handleSubmit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setSaved(false);
    setFailed(false);
    // `line2` is the only optional part; an empty box means "no second line",
    // which the contract expresses as null rather than an empty string.
    const body: SetVendorShopAddressRequest = {
      line1: form.line1.trim(),
      line2: form.line2.trim() === '' ? null : form.line2.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      pincode: form.pincode.trim(),
    };
    try {
      await setShopAddress(body).unwrap();
      setSaved(true);
    } catch {
      setFailed(true);
    }
  };

  return (
    <>
      <p className="text-sm text-slate-600">
        Customers who choose pickup see this address on their order. Changing it here does not
        affect orders that have already been placed.
      </p>

      <form
        onSubmit={(event) => void handleSubmit(event)}
        className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        {FIELDS.map((field) => (
          <label key={field.name} className="flex flex-col gap-1 text-sm text-slate-700">
            <span>
              {field.label}
              {field.optional ? <span className="text-slate-400"> (optional)</span> : ''}
            </span>
            <input
              type="text"
              name={field.name}
              value={form[field.name]}
              onChange={update(field.name)}
              required={!field.optional}
              maxLength={field.maxLength}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        ))}

        {failed && (
          <p role="alert" className="text-sm text-red-700">
            {apiErrorMessage(saveError, 'Your shop address could not be saved.')}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-green-700">
            Shop address saved.
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Save shop address'}
          </button>
        </div>
      </form>
    </>
  );
};

/**
 * "Shop profile" — the vendor's own self-service settings surface.
 *
 * Created in S4-ADDR for the shop address (the portal had no shop-profile
 * surface at all; shop name and pickup capability were API-only), and extended
 * in S4-SERV with delivery areas rather than growing a competing page.
 */
export const ShopProfilePage = (): JSX.Element => {
  const { data: profile, isLoading, isError, error } = useGetShopProfileQuery();

  if (isLoading) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Shop profile</h1>
        <ProfileSkeleton />
      </main>
    );
  }

  if (isError || !profile) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Shop profile</h1>
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {apiErrorMessage(error, 'Your shop profile could not be loaded.')}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <header>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Shop profile</h1>
        <p className="text-sm text-slate-600">
          {profile.shopName ?? 'No shop name set'} —{' '}
          {profile.supportsPickup ? 'pickup enabled' : 'delivery only'}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Shop address
        </h2>
        <ShopAddressForm profile={profile} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Delivery areas
        </h2>
        <ServiceablePincodesSection />
      </section>
    </main>
  );
};

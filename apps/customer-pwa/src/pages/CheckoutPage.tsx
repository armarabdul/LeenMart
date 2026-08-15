import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CartItemResponse } from '@leen-mart/contracts';
import { useAppSelector } from '@/app/hooks';
import { apiErrorMessage } from '@/shared/api/base-api';
import { selectKnownVariants, type KnownVariantSummary } from '@/shared/state/known-variants.slice';
import { formatMoney } from '@/shared/lib/format-money';
import { useGetCartQuery } from '@/features/cart/cart.api';
import { AddressSelector } from '@/features/address/components/AddressSelector';
import { usePlaceOrderMutation } from '@/features/checkout/checkout.api';

const CheckoutSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4">
    {Array.from({ length: 3 }, (_, index) => (
      <div key={index} className="h-16 w-full animate-pulse rounded-md bg-slate-100" />
    ))}
  </div>
);

/** `null` when any line's price could not be resolved — never a partial total (matches `CartPage`'s own `useCartTotal`). */
const useCheckoutSubtotal = (
  items: readonly CartItemResponse[],
  knownVariants: Readonly<Record<string, KnownVariantSummary>>,
): string | null =>
  useMemo(() => {
    if (items.length === 0) return null;
    let totalMinor = 0;
    for (const item of items) {
      const known = knownVariants[item.variantId];
      if (!known) return null;
      totalMinor += Number(known.price.amount) * item.quantity;
    }
    return formatMoney({ amount: String(totalMinor), currency: 'INR' });
  }, [items, knownVariants]);

const CheckoutItemRow = ({
  item,
  known,
}: {
  readonly item: CartItemResponse;
  readonly known: KnownVariantSummary | undefined;
}): JSX.Element => (
  <li className="flex items-center justify-between text-sm">
    <span className="text-slate-700">
      {known ? `${known.productName} — ${known.variantName}` : 'Item unavailable'}{' '}
      <span className="text-slate-400">× {item.quantity}</span>
    </span>
    <span className="font-medium text-slate-900">
      {known
        ? formatMoney({
            amount: String(Number(known.price.amount) * item.quantity),
            currency: 'INR',
          })
        : '—'}
    </span>
  </li>
);

const OrderReviewSection = ({
  items,
  knownVariants,
  subtotal,
}: {
  readonly items: readonly CartItemResponse[];
  readonly knownVariants: Readonly<Record<string, KnownVariantSummary>>;
  readonly subtotal: string | null;
}): JSX.Element => (
  <section className="flex flex-col gap-3">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Order review</h2>
    <ul className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4">
      {items.map((item) => (
        <CheckoutItemRow key={item.id} item={item} known={knownVariants[item.variantId]} />
      ))}
    </ul>

    {subtotal !== null ? (
      <p className="text-right text-lg font-semibold text-slate-900">Subtotal: {subtotal}</p>
    ) : (
      <p className="text-right text-sm text-slate-500">
        Subtotal unavailable — some items&apos; pricing could not be resolved.
      </p>
    )}
    <p className="text-xs text-slate-500">
      Applicable taxes are calculated when your order is placed and will appear on your order
      confirmation — GST to be confirmed.
    </p>
  </section>
);

/**
 * A single, linear page — address, review, and the (test-mode) payment step
 * all live here rather than behind a wizard, matching the honest scope of
 * S3-3A: there is no real payment gateway to justify a multi-screen flow
 * around one.
 */
export const CheckoutPage = (): JSX.Element => {
  const {
    data: cart,
    isLoading: isCartLoading,
    isError: isCartError,
    error: cartError,
  } = useGetCartQuery();
  const knownVariants = useAppSelector(selectKnownVariants);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [placeOrder, { isLoading: isPlacing, error: placeError }] = usePlaceOrderMutation();
  const navigate = useNavigate();

  // One idempotency key per checkout attempt on this page — a duplicate
  // submit (double-click, retry after a network hiccup) reuses it and
  // replays the same result rather than placing a second order.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const items = useMemo(() => cart?.items ?? [], [cart]);
  const subtotal = useCheckoutSubtotal(items, knownVariants);

  const handlePlaceOrder = async (): Promise<void> => {
    if (!selectedAddressId) return;
    try {
      const order = await placeOrder({
        addressId: selectedAddressId,
        paymentMethod: 'ONLINE',
        idempotencyKey,
      }).unwrap();
      void navigate(`/orders/${order.id}`, { replace: true });
    } catch {
      // Surfaced below via `placeError`.
    }
  };

  if (isCartLoading) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Checkout</h1>
        <CheckoutSkeleton />
      </main>
    );
  }

  if (isCartError || !cart) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Checkout</h1>
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {apiErrorMessage(cartError, 'Your cart could not be loaded. Please try again.')}
        </p>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Your cart is empty</h1>
        <p className="text-sm text-slate-600">Add something to your cart before checking out.</p>
        <Link
          to="/catalogue"
          className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Go to catalogue
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">Checkout</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Delivery address
        </h2>
        <AddressSelector selectedAddressId={selectedAddressId} onSelect={setSelectedAddressId} />
      </section>

      <OrderReviewSection items={items} knownVariants={knownVariants} subtotal={subtotal} />

      <section className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">
          Payment (test mode)
        </h2>
        <p className="text-sm text-amber-800">
          This is a test environment. Placing your order does not process a real payment — your
          order will show as payment pending until a real payment step is added.
        </p>
      </section>

      {placeError !== undefined && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {apiErrorMessage(placeError, 'Your order could not be placed. Please try again.')}
        </p>
      )}

      <button
        type="button"
        onClick={() => void handlePlaceOrder()}
        disabled={!selectedAddressId || isPlacing}
        className="rounded-md bg-brand-700 px-4 py-3 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {isPlacing ? 'Placing order…' : 'Place order (test payment)'}
      </button>
    </main>
  );
};

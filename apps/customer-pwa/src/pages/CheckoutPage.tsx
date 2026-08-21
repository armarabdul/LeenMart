import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { CartItemResponse } from '@leen-mart/contracts';
import { Alert, Button, Card, EmptyState, Skeleton } from '@leen-mart/ui';
import { useAppSelector } from '@/app/hooks';
import { apiErrorMessage, isApiError } from '@/shared/api/base-api';
import { selectKnownVariants, type KnownVariantSummary } from '@/shared/state/known-variants.slice';
import { formatMoney } from '@/shared/lib/format-money';
import { PageContainer } from '@/components/PageContainer';
import { useGetCartQuery } from '@/features/cart/cart.api';
import { AddressSelector } from '@/features/address/components/AddressSelector';
import { FulfilmentModeSelector } from '@/features/checkout/components/FulfilmentModeSelector';
import { groupCartByVendor } from '@/features/checkout/lib/group-cart-by-vendor';
import { SlotSelector, type SlotChoice } from '@/features/checkout/components/SlotSelector';
import {
  useGetSlotAvailabilityQuery,
  usePlaceOrderMutation,
} from '@/features/checkout/checkout.api';

/**
 * S4-SERV. Switched on `error.code`, never on the message — the code is the
 * contract and the wording is not (see `apiErrorMessage`'s own doc comment).
 * The backend's message is accurate but says nothing about what to do next;
 * this adds the two actions that actually resolve it.
 */
const isNotServiceable = (error: unknown): boolean =>
  isApiError(error) && error.data.error.code === 'ORDER_ADDRESS_NOT_SERVICEABLE';

/**
 * S4-HOURS. Same convention: switched on `error.code`, never the message. The
 * backend's wording is accurate but says nothing about what to do next, and
 * "try later or switch to pickup" are the two actions that resolve it.
 */
const isVendorClosed = (error: unknown): boolean =>
  isApiError(error) && error.data.error.code === 'ORDER_VENDOR_CLOSED';

/**
 * S4-SLOTS. Three codes, one message class: the slot the customer chose can no
 * longer be honoured, and the action is the same in every case — choose
 * another. The server never substitutes one, so the customer must.
 */
const isSlotProblem = (error: unknown): boolean =>
  isApiError(error) &&
  ['ORDER_SLOT_REQUIRED', 'ORDER_SLOT_INVALID', 'ORDER_SLOT_UNAVAILABLE'].includes(
    error.data.error.code,
  );

/**
 * The placement failure, in words the customer can act on.
 *
 * Every branch switches on `error.code` — the contract — never on the server's
 * wording, and each adds the next step the code itself does not state. Anything
 * unrecognised falls through to the server's own message rather than being
 * flattened into a generic apology.
 */
const PlacementError = ({ error }: { readonly error: unknown }): JSX.Element => {
  const message = isNotServiceable(error)
    ? 'One or more sellers in your cart do not deliver to this address. Choose a different delivery address, or remove those items to continue.'
    : isVendorClosed(error)
      ? 'One or more sellers in your cart are closed for delivery right now. Try again during their opening hours, or choose pickup where it is offered.'
      : isSlotProblem(error)
        ? 'Please choose an available time slot for every seller in your cart. A slot you picked may have just been taken.'
        : apiErrorMessage(error, 'Your order could not be placed. Please try again.');

  return (
    <Alert tone="danger" title="Your order couldn’t be placed">
      {message}
    </Alert>
  );
};

/**
 * S3-3A's honest disclosure: there is no real gateway behind this checkout.
 *
 * Deliberately *not* an `Alert`: this is a permanent property of the
 * environment, not an event, and `Alert`'s `warning` tone carries
 * `role="alert"` — an assertive live region that would interrupt a screen
 * reader on every render and compete with the real placement error below it.
 */
const TestPaymentNotice = (): JSX.Element => (
  <section
    aria-labelledby="checkout-payment-mode"
    className="rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-text"
  >
    <h2 id="checkout-payment-mode" className="font-semibold">
      Payment — TEST / DEMO mode
    </h2>
    <p className="mt-0.5 text-text-muted">
      This is a test environment — no real payment provider is contacted. After you place your order
      you&apos;ll complete a simulated test payment on the next screen.
    </p>
  </section>
);

const CheckoutSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading checkout">
    {Array.from({ length: 3 }, (_, index) => (
      <Skeleton key={index} shape="rect" className="h-20 w-full" />
    ))}
  </div>
);

/**
 * A titled step of the single-page checkout.
 *
 * Leen Mart's checkout genuinely is one page — there is no server-side wizard
 * and no partial-order state to resume — so this gives each part its own card
 * and heading rather than dressing the flow up as a multi-step form it is not.
 */
const CheckoutSection = ({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}): JSX.Element => (
  <Card className="flex flex-col gap-3 p-4">
    <h2 className="text-sm font-semibold text-text">{title}</h2>
    {children}
  </Card>
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
  <li className="flex items-start justify-between gap-3 text-sm">
    <span className="min-w-0 text-text-muted">
      {known ? `${known.productName} — ${known.variantName}` : 'Item unavailable'}{' '}
      <span className="text-text-faint">× {item.quantity}</span>
    </span>
    <span className="shrink-0 font-medium text-text">
      {known
        ? formatMoney({
            amount: String(Number(known.price.amount) * item.quantity),
            currency: 'INR',
          })
        : '—'}
    </span>
  </li>
);

/**
 * What the customer is paying, and what is still to be determined.
 *
 * The subtotal is the only figure this application can state before placement.
 * Tax is resolved server-side per line and can legitimately come back
 * unresolved (`orderItemTaxSchema`), and there is no delivery charge or
 * discount anywhere in the domain — so this shows one line plus an honest
 * note, never a fabricated breakdown.
 */
const CheckoutSummary = ({
  subtotal,
  itemCount,
  canPlace,
  isPlacing,
  onPlaceOrder,
}: {
  readonly subtotal: string | null;
  readonly itemCount: number;
  readonly canPlace: boolean;
  readonly isPlacing: boolean;
  readonly onPlaceOrder: () => void;
}): JSX.Element => (
  <Card className="flex flex-col gap-4 p-4">
    <h2 className="text-sm font-semibold text-text">Order summary</h2>

    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-text-muted">
        Subtotal ({itemCount} {itemCount === 1 ? 'item' : 'items'})
      </span>
      {subtotal !== null ? (
        <span className="text-lg font-semibold text-text">{subtotal}</span>
      ) : (
        <span className="text-sm text-text-muted">&mdash;</span>
      )}
    </div>

    {subtotal === null && (
      <p className="text-xs text-text-muted">
        Subtotal unavailable &mdash; some items&apos; pricing could not be resolved.
      </p>
    )}

    <p className="text-xs text-text-muted">
      Applicable taxes are calculated when your order is placed and will appear on your order
      confirmation — GST to be confirmed.
    </p>

    <Button
      type="button"
      size="lg"
      onClick={onPlaceOrder}
      disabled={!canPlace || isPlacing}
      loading={isPlacing}
      className="w-full"
    >
      Place order (test payment)
    </Button>

    {!canPlace && (
      <p className="text-center text-xs text-text-muted">Choose a delivery address to continue.</p>
    )}
  </Card>
);

/** Nothing to check out — routed here directly, or the cart emptied in another tab. */
const EmptyCartState = (): JSX.Element => (
  <main>
    <PageContainer>
      <div className="py-12 sm:py-16">
        <EmptyState
          title="Your cart is empty"
          description="Add something to your cart before checking out."
          action={
            <Link
              to="/catalogue"
              className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              Go to catalogue
            </Link>
          }
        />
      </div>
    </PageContainer>
  </main>
);

/** Decisions on the left, money and the commit action on the right from `lg` up. */
const CheckoutLayout = ({ children }: { readonly children: React.ReactNode }): JSX.Element => (
  <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
    {children}
  </div>
);

const CheckoutShell = ({ children }: { readonly children: React.ReactNode }): JSX.Element => (
  <main>
    <PageContainer>
      <div className="flex flex-col gap-6 py-6 sm:py-8">
        <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
          Checkout
        </h1>
        {children}
      </div>
    </PageContainer>
  </main>
);

/**
 * A single, linear page — address, review, and the (test-mode) payment step
 * all live here rather than behind a wizard, matching the honest scope of
 * S3-3A: there is no real payment gateway to justify a multi-screen flow
 * around one.
 *
 * **Phase E layout.** Two zones from `lg` up: the decisions on the left, the
 * money and the final action on the right where they stay in view while the
 * customer works down the page. Below `lg` the same order stacks, so the
 * summary and the commit button are the last things read — which is the right
 * order for a screen whose last action spends money.
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
  // S4-QR: DELIVERY is the default, so this starts empty and only ever holds
  // vendors the customer explicitly chose to pick up from.
  const [pickupVendorIds, setPickupVendorIds] = useState<readonly string[]>([]);
  // S4-SLOTS. Scoped server-side to this cart's vendors; no vendor id is sent.
  const {
    data: slotAvailability,
    isError: isSlotAvailabilityError,
    error: slotAvailabilityError,
    refetch: refetchSlotAvailability,
  } = useGetSlotAvailabilityQuery();
  const [slotSelections, setSlotSelections] = useState<readonly SlotChoice[]>([]);
  const [placeOrder, { isLoading: isPlacing, error: placeError }] = usePlaceOrderMutation();
  const navigate = useNavigate();

  // One idempotency key per checkout attempt on this page — a duplicate
  // submit (double-click, retry after a network hiccup) reuses it and
  // replays the same result rather than placing a second order.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const items = useMemo(() => cart?.items ?? [], [cart]);
  const subtotal = useCheckoutSubtotal(items, knownVariants);
  const vendors = useMemo(() => groupCartByVendor(items), [items]);

  const togglePickup = (vendorId: string, pickup: boolean): void => {
    setPickupVendorIds((current) =>
      pickup
        ? [...current.filter((id) => id !== vendorId), vendorId]
        : current.filter((id) => id !== vendorId),
    );
  };

  const selectSlot = (choice: SlotChoice): void => {
    setSlotSelections((current) => [
      ...current.filter((existing) => existing.vendorId !== choice.vendorId),
      choice,
    ]);
  };

  const handlePlaceOrder = async (): Promise<void> => {
    if (!selectedAddressId) return;
    try {
      const order = await placeOrder({
        addressId: selectedAddressId,
        paymentMethod: 'ONLINE',
        idempotencyKey,
        // Omitted entirely when empty, so an all-delivery checkout sends
        // exactly the request shape it did before S4-QR.
        ...(pickupVendorIds.length > 0 ? { pickupVendorIds: [...pickupVendorIds] } : {}),
        // Omitted entirely when empty, so a cart whose vendors offer no
        // windows sends exactly the request shape it did before S4-SLOTS.
        ...(slotSelections.length > 0 ? { slotSelections: [...slotSelections] } : {}),
      }).unwrap();
      void navigate(`/orders/${order.id}`, { replace: true });
    } catch {
      // Surfaced below via `placeError`.
    }
  };

  if (isCartLoading) {
    return (
      <CheckoutShell>
        <CheckoutSkeleton />
      </CheckoutShell>
    );
  }

  if (isCartError || !cart) {
    return (
      <CheckoutShell>
        <Alert tone="danger" title="Your cart couldn’t be loaded">
          {apiErrorMessage(cartError, 'Your cart could not be loaded. Please try again.')}
        </Alert>
      </CheckoutShell>
    );
  }

  if (items.length === 0) {
    return <EmptyCartState />;
  }

  return (
    <CheckoutShell>
      <CheckoutLayout>
        <div className="flex min-w-0 flex-col gap-4">
          <CheckoutSection title="Delivery address">
            <AddressSelector
              selectedAddressId={selectedAddressId}
              onSelect={setSelectedAddressId}
            />
          </CheckoutSection>

          <FulfilmentModeSelector
            vendors={vendors}
            pickupVendorIds={pickupVendorIds}
            onToggle={togglePickup}
          />

          <SlotSelector
            availability={slotAvailability}
            isError={isSlotAvailabilityError}
            error={slotAvailabilityError}
            onRetry={() => void refetchSlotAvailability()}
            selections={slotSelections}
            onSelect={selectSlot}
          />

          <CheckoutSection title="Order review">
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <CheckoutItemRow key={item.id} item={item} known={knownVariants[item.variantId]} />
              ))}
            </ul>
          </CheckoutSection>

          <TestPaymentNotice />

          {placeError !== undefined && <PlacementError error={placeError} />}
        </div>

        <div className="lg:sticky lg:top-24">
          <CheckoutSummary
            subtotal={subtotal}
            itemCount={items.length}
            canPlace={selectedAddressId !== null}
            isPlacing={isPlacing}
            onPlaceOrder={() => void handlePlaceOrder()}
          />
        </div>
      </CheckoutLayout>
    </CheckoutShell>
  );
};

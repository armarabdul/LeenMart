import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Card, EmptyState, Skeleton } from '@leen-mart/ui';
import { useAppSelector } from '@/app/hooks';
import { apiErrorMessage } from '@/shared/api/base-api';
import { selectKnownVariants } from '@/shared/state/known-variants.slice';
import { formatMoney } from '@/shared/lib/format-money';
import { PageContainer } from '@/components/PageContainer';
import { CartItemRow } from '@/features/cart/components/CartItemRow';
import {
  groupCartItemsByVendor,
  type CartVendorSection,
} from '@/features/cart/lib/group-cart-items-by-vendor';
import { useClearCartMutation, useGetCartQuery } from '@/features/cart/cart.api';

const CartIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-8 w-8 text-text-faint">
    <path
      d="M3 4h2l2.4 10.4a2 2 0 0 0 2 1.6h7.3a2 2 0 0 0 2-1.55L20.5 8H6"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="10" cy="20" r="1.4" fill="currentColor" />
    <circle cx="17" cy="20" r="1.4" fill="currentColor" />
  </svg>
);

const CartSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading your cart">
    {Array.from({ length: 3 }, (_, index) => (
      <Skeleton key={index} shape="rect" className="h-24 w-full" />
    ))}
  </div>
);

/**
 * Whether every line item resolved against `knownVariants` (see
 * `known-variants.slice.ts`) — the only condition under which a subtotal is
 * shown at all. A single unresolved item is enough to withhold the total
 * rather than publish a number that silently excludes it.
 */
const useCartTotal = (
  items: readonly { readonly variantId: string; readonly quantity: number }[],
): string | null => {
  const knownVariants = useAppSelector(selectKnownVariants);
  if (items.length === 0) return null;

  let totalMinor = 0;
  for (const item of items) {
    const known = knownVariants[item.variantId];
    if (!known) return null;
    totalMinor += Number(known.price.amount) * item.quantity;
  }
  return formatMoney({ amount: String(totalMinor), currency: 'INR' });
};

/**
 * One shop's lines.
 *
 * A Leen Mart cart fans out into one sub-order per vendor at checkout, so
 * grouping here is not decoration — it is the shape the order will actually
 * take, and the customer should recognise it before they pay rather than
 * first meeting it on the confirmation screen.
 */
const VendorSection = ({ section }: { readonly section: CartVendorSection }): JSX.Element => (
  <Card className="p-0">
    <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-text">
      Sold by {section.vendorShopName}
    </h2>
    <ul className="divide-y divide-border px-4">
      {section.items.map((item) => (
        <CartItemRow key={item.id} item={item} />
      ))}
    </ul>
  </Card>
);

/**
 * The money column.
 *
 * Only a subtotal is ever shown. Taxes are resolved server-side when the
 * order is placed (`orderItemTaxSchema` can come back unresolved), and the
 * application calculates no delivery charge, discount or saving anywhere —
 * so this deliberately shows a single line and says what is still to come,
 * rather than inventing a breakdown that would look more complete than it is.
 */
const OrderSummary = ({
  total,
  itemCount,
}: {
  readonly total: string | null;
  readonly itemCount: number;
}): JSX.Element => (
  <Card className="flex flex-col gap-4 p-4">
    <h2 className="text-sm font-semibold text-text">Order summary</h2>

    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm text-text-muted">
        Subtotal ({itemCount} {itemCount === 1 ? 'item' : 'items'})
      </span>
      {total !== null ? (
        <span className="text-lg font-semibold text-text">{total}</span>
      ) : (
        <span className="text-sm text-text-muted">&mdash;</span>
      )}
    </div>

    {total === null && (
      <p className="text-xs text-text-muted">
        Cart total unavailable &mdash; some items&apos; pricing could not be resolved. You can still
        continue; the order total is confirmed when you place the order.
      </p>
    )}

    <p className="text-xs text-text-muted">
      Taxes are calculated when your order is placed and appear on your order confirmation.
    </p>
  </Card>
);

/** Title, live item count, and the destructive action kept visually quiet. */
const CartHeader = ({
  itemCount,
  isClearing,
  onClear,
}: {
  readonly itemCount: number;
  readonly isClearing: boolean;
  readonly onClear: () => void;
}): JSX.Element => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex items-center gap-3">
      <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
        Your cart
      </h1>
      <Badge tone="neutral">
        {itemCount} {itemCount === 1 ? 'item' : 'items'}
      </Badge>
    </div>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClear}
      disabled={isClearing}
      loading={isClearing}
      className="min-h-11 text-danger hover:bg-danger/10"
    >
      Clear cart
    </Button>
  </div>
);

/**
 * The phone's checkout action, pinned above the fold.
 *
 * `env(safe-area-inset-bottom)` keeps it clear of the home indicator, and the
 * page reserves matching bottom padding so the bar never covers the last
 * row's quantity controls.
 */
const MobileCheckoutBar = ({ total }: { readonly total: string | null }): JSX.Element => (
  <div
    className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface px-4 pt-3 lg:hidden"
    style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
  >
    <div className="mx-auto flex max-w-3xl items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-text-muted">Subtotal</p>
        <p className="truncate text-sm font-semibold text-text">{total ?? '—'}</p>
      </div>
      <Link
        to="/checkout"
        className="inline-flex h-11 shrink-0 items-center rounded-md bg-primary px-5 text-sm font-medium text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
      >
        Proceed to checkout
      </Link>
    </div>
  </div>
);

export const CartPage = (): JSX.Element => {
  const { data: cart, isLoading, isError, error } = useGetCartQuery();
  const [clearCart, { isLoading: isClearing, error: clearCartError }] = useClearCartMutation();
  const items = cart?.items ?? [];
  const total = useCartTotal(items);

  if (isLoading) {
    return (
      <main>
        <PageContainer>
          <div className="flex flex-col gap-6 py-6 sm:py-8">
            <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
              Your cart
            </h1>
            <CartSkeleton />
          </div>
        </PageContainer>
      </main>
    );
  }

  if (isError || !cart) {
    return (
      <main>
        <PageContainer>
          <div className="flex flex-col gap-6 py-6 sm:py-8">
            <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
              Your cart
            </h1>
            <Alert tone="danger" title="Your cart couldn’t be loaded">
              {apiErrorMessage(error, 'Your cart could not be loaded. Please try again.')}
            </Alert>
          </div>
        </PageContainer>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main>
        <PageContainer>
          <div className="py-12 sm:py-16">
            <EmptyState
              icon={<CartIcon />}
              title="Your cart is empty"
              description="Browse the catalogue to find something you like."
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
  }

  const sections = groupCartItemsByVendor(items);

  return (
    <main>
      <PageContainer>
        {/* Bottom padding on mobile keeps the sticky checkout bar from ever
            covering the last row's controls. */}
        <div className="flex flex-col gap-6 py-6 pb-28 sm:py-8 lg:pb-8">
          <CartHeader
            itemCount={items.length}
            isClearing={isClearing}
            onClear={() => void clearCart()}
          />

          {/* Phase I: "Clear cart" failing must not look the same as it
              succeeding — without this the button just stops spinning and
              the cart silently stays exactly as it was. */}
          {clearCartError !== undefined && (
            <Alert tone="danger">
              {apiErrorMessage(clearCartError, 'Your cart could not be cleared. Please try again.')}
            </Alert>
          )}

          <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
            <div className="flex min-w-0 flex-col gap-4">
              {sections.map((section) => (
                <VendorSection key={section.vendorId} section={section} />
              ))}
            </div>

            <div className="flex flex-col gap-3 lg:sticky lg:top-24">
              <OrderSummary total={total} itemCount={items.length} />
              <Link
                to="/checkout"
                className="hidden h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 lg:inline-flex"
              >
                Proceed to checkout
              </Link>
              <Link
                to="/catalogue"
                className="hidden text-center text-sm font-medium text-primary hover:text-primary-hover lg:block"
              >
                Continue shopping
              </Link>
            </div>
          </div>
        </div>
      </PageContainer>

      <MobileCheckoutBar total={total} />
    </main>
  );
};

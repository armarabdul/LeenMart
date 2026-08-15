import { Link } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';
import { apiErrorMessage } from '@/shared/api/base-api';
import { selectKnownVariants } from '@/shared/state/known-variants.slice';
import { formatMoney } from '@/shared/lib/format-money';
import { CartItemRow } from '@/features/cart/components/CartItemRow';
import { useClearCartMutation, useGetCartQuery } from '@/features/cart/cart.api';

const CartSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4">
    {Array.from({ length: 3 }, (_, index) => (
      <div key={index} className="h-20 w-full animate-pulse rounded-md bg-slate-100" />
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

export const CartPage = (): JSX.Element => {
  const { data: cart, isLoading, isError, error } = useGetCartQuery();
  const [clearCart, { isLoading: isClearing }] = useClearCartMutation();
  const total = useCartTotal(cart?.items ?? []);

  if (isLoading) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Your cart</h1>
        <CartSkeleton />
      </main>
    );
  }

  if (isError || !cart) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Your cart</h1>
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {apiErrorMessage(error, 'Your cart could not be loaded. Please try again.')}
        </p>
      </main>
    );
  }

  if (cart.items.length === 0) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col items-center gap-4 px-4 py-16 text-center">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Your cart is empty</h1>
        <p className="text-sm text-slate-600">Browse the catalogue to find something you like.</p>
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
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Your cart</h1>
        <button
          type="button"
          onClick={() => void clearCart()}
          disabled={isClearing}
          className="text-sm font-medium text-red-700 hover:text-red-800 disabled:opacity-50"
        >
          {isClearing ? 'Clearing…' : 'Clear cart'}
        </button>
      </div>

      <ul className="rounded-lg border border-slate-200 bg-white px-4">
        {cart.items.map((item) => (
          <CartItemRow key={item.id} item={item} />
        ))}
      </ul>

      <div className="flex justify-end">
        {total !== null ? (
          <p className="text-lg font-semibold text-slate-900">Total: {total}</p>
        ) : (
          <p className="text-sm text-slate-500">
            Cart total unavailable — some items&apos; pricing could not be resolved.
          </p>
        )}
      </div>
    </main>
  );
};

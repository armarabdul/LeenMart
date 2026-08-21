import type { CartItemResponse } from '@leen-mart/contracts';
import { Alert, Button } from '@leen-mart/ui';
import { useAppSelector } from '@/app/hooks';
import { apiErrorMessage } from '@/shared/api/base-api';
import { selectKnownVariant, type KnownVariantSummary } from '@/shared/state/known-variants.slice';
import { QuantityControl } from '@/shared/components/QuantityControl';
import { formatMoney } from '@/shared/lib/format-money';
import { useRemoveCartItemMutation, useUpdateCartItemMutation } from '../cart.api';

/** The name/variant/unit-price block, or an honest fallback when the variant was never observed. */
const LineDetails = ({
  known,
}: {
  readonly known: KnownVariantSummary | undefined;
}): JSX.Element => (
  <div className="flex min-w-0 flex-col gap-0.5">
    {known ? (
      <>
        <p className="truncate text-sm font-medium text-text">{known.productName}</p>
        <p className="truncate text-xs text-text-muted">{known.variantName}</p>
        <p className="text-xs text-text-muted">
          {formatMoney(known.price)} / {known.unitOfMeasure}
        </p>
      </>
    ) : (
      <p className="text-sm text-text-muted">Product information unavailable</p>
    )}
  </div>
);

interface CartItemRowProps {
  readonly item: CartItemResponse;
}

/**
 * Renders one cart line two different ways depending on whether this
 * session ever observed the variant's product detail (see
 * `known-variants.slice.ts` for why that's the only source of display data
 * — no endpoint resolves `variantId` on its own). Either way, quantity
 * update and remove work: both only need `item.id`.
 *
 * `known.available`/`known.quantityStep` are a snapshot from whenever the
 * product page was last viewed, not a live read — the backend re-validates
 * every write regardless, exactly the "frontend is a UX layer only"
 * discipline `QuantityControl` itself documents.
 *
 * **Phase E layout.** The line total is computed here rather than only in the
 * cart's summary, because a shopper checking a cart is usually checking one
 * line, not the total. It is plain arithmetic over the same observed price
 * the subtotal already uses — never a figure the API did not provide. When
 * the variant is unresolved the row still renders and still works; it just
 * says so, and shows no price at all rather than a zero.
 */
export const CartItemRow = ({ item }: CartItemRowProps): JSX.Element => {
  const known = useAppSelector(selectKnownVariant(item.variantId));
  const [updateCartItem, { isLoading: isUpdating, error: updateError }] =
    useUpdateCartItemMutation();
  const [removeCartItem, { isLoading: isRemoving, error: removeError }] =
    useRemoveCartItemMutation();

  const busy = isUpdating || isRemoving;
  const lineTotal = known
    ? formatMoney({ amount: String(Number(known.price.amount) * item.quantity), currency: 'INR' })
    : null;

  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex items-start justify-between gap-3">
        <LineDetails known={known} />

        {/* The line total is the number the shopper is scanning for, so it
            anchors the right edge and never wraps under the name. */}
        {lineTotal !== null && (
          <p className="shrink-0 text-sm font-semibold text-text">{lineTotal}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <QuantityControl
          quantity={item.quantity}
          quantityStep={known?.quantityStep}
          available={known?.available}
          onChange={(quantity) => void updateCartItem({ itemId: item.id, quantity })}
          disabled={busy}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 text-danger hover:bg-danger/10"
          onClick={() => void removeCartItem(item.id)}
          disabled={busy}
          loading={isRemoving}
          aria-label={known ? `Remove ${known.productName}` : 'Remove item'}
        >
          Remove
        </Button>
      </div>

      {(updateError ?? removeError) && (
        <Alert tone="danger">{apiErrorMessage(updateError ?? removeError)}</Alert>
      )}
    </li>
  );
};

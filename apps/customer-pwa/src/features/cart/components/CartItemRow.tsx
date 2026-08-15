import type { CartItemResponse } from '@leen-mart/contracts';
import { useAppSelector } from '@/app/hooks';
import { apiErrorMessage } from '@/shared/api/base-api';
import { selectKnownVariant } from '@/shared/state/known-variants.slice';
import { QuantityControl } from '@/shared/components/QuantityControl';
import { formatMoney } from '@/shared/lib/format-money';
import { useRemoveCartItemMutation, useUpdateCartItemMutation } from '../cart.api';

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
 */
export const CartItemRow = ({ item }: CartItemRowProps): JSX.Element => {
  const known = useAppSelector(selectKnownVariant(item.variantId));
  const [updateCartItem, { isLoading: isUpdating, error: updateError }] =
    useUpdateCartItemMutation();
  const [removeCartItem, { isLoading: isRemoving, error: removeError }] =
    useRemoveCartItemMutation();

  const busy = isUpdating || isRemoving;

  const handleQuantityChange = (quantity: number): void => {
    void updateCartItem({ itemId: item.id, quantity });
  };

  const handleRemove = (): void => {
    void removeCartItem(item.id);
  };

  return (
    <li className="flex flex-col gap-3 border-b border-slate-200 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        {known ? (
          <>
            <p className="text-sm font-medium text-slate-900">{known.productName}</p>
            <p className="text-xs text-slate-500">{known.variantName}</p>
            <p className="text-sm text-slate-700">
              {formatMoney(known.price)}
              <span className="ml-1 text-xs text-slate-500">/ {known.unitOfMeasure}</span>
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-500">Product information unavailable</p>
        )}
        {(updateError ?? removeError) && (
          <p role="alert" className="text-xs text-red-700">
            {apiErrorMessage(updateError ?? removeError)}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <QuantityControl
          quantity={item.quantity}
          quantityStep={known?.quantityStep}
          available={known?.available}
          onChange={handleQuantityChange}
          disabled={busy}
        />
        <button
          type="button"
          onClick={handleRemove}
          disabled={busy}
          className="text-sm font-medium text-red-700 hover:text-red-800 disabled:opacity-50"
        >
          {isRemoving ? 'Removing…' : 'Remove'}
        </button>
      </div>
    </li>
  );
};

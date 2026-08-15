interface QuantityBounds {
  readonly outOfStock: boolean;
  readonly atMin: boolean;
  readonly atMax: boolean;
  readonly previousQuantity: number;
  readonly nextQuantity: number;
}

const computeBounds = (
  quantity: number,
  quantityStep: number,
  available: number | undefined,
): QuantityBounds => {
  const maxQuantity =
    available === undefined ? undefined : Math.floor(available / quantityStep) * quantityStep;

  return {
    outOfStock: available !== undefined && available < quantityStep,
    atMin: quantity <= quantityStep,
    atMax: maxQuantity !== undefined && quantity >= maxQuantity,
    previousQuantity: Math.max(quantityStep, quantity - quantityStep),
    nextQuantity:
      maxQuantity === undefined
        ? quantity + quantityStep
        : Math.min(maxQuantity, quantity + quantityStep),
  };
};

interface QuantityControlProps {
  readonly quantity: number;
  /**
   * Omit only when the caller genuinely doesn't know it (an unresolved cart
   * line — see `known-variants.slice.ts`). Every real `ProductVariant`
   * carries a positive integer step; defaulting to `1` here is always a
   * subset of what the backend would accept, never a value it could reject
   * that a known step wouldn't already have rejected too.
   */
  readonly quantityStep?: number | undefined;
  /** Omit when unknown — no client-side upper bound is enforced in that case; the backend remains authoritative. */
  readonly available?: number | undefined;
  readonly onChange: (quantity: number) => void;
  readonly disabled?: boolean | undefined;
}

/**
 * A quantityStep-aware stepper, shared by Product Detail's "Add to Cart" and
 * the Cart page's quantity update — genuinely stateless UI with no
 * product/cart-specific knowledge, so it lives in `shared/` rather than
 * either feature (SDD 25.3: a feature may import from `shared/`, never from
 * another feature).
 *
 * Never lets the caller reach zero, a negative number, or a non-multiple of
 * `quantityStep` — the frontend is a UX layer only; the backend still
 * validates every write independently (`AddCartItemUseCase`/
 * `UpdateCartItemQuantityUseCase` reject anything this control shouldn't
 * have produced in the first place).
 */
export const QuantityControl = ({
  quantity,
  quantityStep = 1,
  available,
  onChange,
  disabled = false,
}: QuantityControlProps): JSX.Element => {
  const bounds = computeBounds(quantity, quantityStep, available);
  const showStepHint = quantityStep > 1 && !bounds.outOfStock;

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(bounds.previousQuantity)}
        disabled={disabled || bounds.outOfStock || bounds.atMin}
        aria-label="Decrease quantity"
        className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
      >
        −
      </button>
      <span
        className="min-w-[2ch] text-center text-sm font-medium text-slate-900"
        aria-live="polite"
      >
        {bounds.outOfStock ? 0 : quantity}
      </span>
      <button
        type="button"
        onClick={() => onChange(bounds.nextQuantity)}
        disabled={disabled || bounds.outOfStock || bounds.atMax}
        aria-label="Increase quantity"
        className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
      >
        +
      </button>
      {showStepHint && (
        <span className="text-xs text-slate-500">Sold in steps of {quantityStep}</span>
      )}
    </div>
  );
};

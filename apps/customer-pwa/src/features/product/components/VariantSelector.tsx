import type { PublicProductVariant } from '@leen-mart/contracts';
import { formatMoney } from '@/shared/lib/format-money';

interface VariantSelectorProps {
  readonly variants: readonly PublicProductVariant[];
  readonly selectedVariantId: string | undefined;
  readonly onSelect: (variantId: string) => void;
}

/**
 * Renders nothing for a single-variant product — there is nothing to choose,
 * and `ProductDetailPage` already auto-selects the one variant that exists.
 */
export const VariantSelector = ({
  variants,
  selectedVariantId,
  onSelect,
}: VariantSelectorProps): JSX.Element | null => {
  if (variants.length <= 1) return null;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-text">Choose an option</legend>
      <div className="flex flex-wrap gap-2">
        {variants.map((variant) => {
          const isSelected = variant.id === selectedVariantId;
          const isUnavailable = variant.available <= 0;
          return (
            <button
              key={variant.id}
              type="button"
              onClick={() => onSelect(variant.id)}
              disabled={isUnavailable}
              aria-pressed={isSelected}
              className={`flex min-h-11 flex-col items-start justify-center rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 ${
                isSelected
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border-strong text-text hover:bg-surface-alt'
              }`}
            >
              <span className="font-medium">{variant.name}</span>
              <span className="text-xs text-text-muted">
                {formatMoney(variant.price)}
                {isUnavailable ? ' · Out of stock' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
};

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
      <legend className="text-sm font-medium text-slate-700">Choose an option</legend>
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
              className={`flex flex-col items-start rounded-md border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                isSelected
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="font-medium">{variant.name}</span>
              <span className="text-xs text-slate-500">
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

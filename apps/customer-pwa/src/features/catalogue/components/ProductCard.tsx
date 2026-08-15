import type { PublicProductSearchResult } from '@leen-mart/contracts';

interface ProductCardProps {
  readonly product: PublicProductSearchResult;
}

/**
 * Deliberately not a link. There is no customer-facing product-detail route
 * (Phase 3 is explicitly deferred — the public search contract carries no
 * variant, price, or availability data for a detail page to show), so this
 * card only ever presents what `publicProductSearchResultSchema` actually
 * returns. No price, no real image (only `mediaCount` exists publicly — the
 * media-delivery surface itself, S2-6c, isn't built) — a labelled
 * placeholder is shown instead of pretending to have one.
 */
export const ProductCard = ({ product }: ProductCardProps): JSX.Element => (
  <article className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
    <div className="flex aspect-square items-center justify-center bg-slate-50 text-xs text-slate-400">
      {product.mediaCount > 0
        ? `${product.mediaCount} photo${product.mediaCount === 1 ? '' : 's'}`
        : 'No photo'}
    </div>
    <div className="flex flex-1 flex-col gap-1 p-3">
      <h3 className="line-clamp-2 text-sm font-medium text-slate-900">{product.name}</h3>
      {product.brand && <p className="text-xs text-slate-500">{product.brand}</p>}
      {product.description && (
        <p className="line-clamp-2 text-xs text-slate-500">{product.description}</p>
      )}
    </div>
  </article>
);

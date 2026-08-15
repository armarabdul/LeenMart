import { Link } from 'react-router-dom';
import type { PublicProductSearchResult } from '@leen-mart/contracts';

interface ProductCardProps {
  readonly product: PublicProductSearchResult;
}

/**
 * Links to `/products/:id` — now that a product-detail route exists, this
 * card is the entry point to it. Still shows only what
 * `publicProductSearchResultSchema` actually returns: no price (the search
 * contract deliberately carries none), no real image (only `mediaCount`
 * exists publicly — the media-delivery surface, S2-6c, isn't built).
 */
export const ProductCard = ({ product }: ProductCardProps): JSX.Element => (
  <Link
    to={`/products/${product.id}`}
    className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm hover:border-brand-300 hover:shadow-md"
  >
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
  </Link>
);

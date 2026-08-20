import { Link } from 'react-router-dom';
import type { PublicProductSearchResult } from '@leen-mart/contracts';

interface ProductCardProps {
  readonly product: PublicProductSearchResult;
}

/**
 * The media well.
 *
 * **There is no image to show.** `publicProductSearchResultSchema` carries
 * `mediaCount` and nothing else — no object key, no CDN URL — because the
 * media-delivery surface (S2-6c) is still deferred. So this reserves the
 * space an image will occupy, at a fixed aspect ratio so a grid of cards
 * stays aligned, and says plainly how many photos exist rather than showing
 * a stock illustration that would imply a picture the product does not have.
 */
const MediaWell = ({ mediaCount }: { readonly mediaCount: number }): JSX.Element => (
  <div className="relative aspect-square w-full overflow-hidden bg-surface-alt">
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-text-faint">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-7 w-7">
        <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="8.5" cy="10" r="1.5" fill="currentColor" />
        <path
          d="m4 17 4.5-4.5 3 3L15 12l5 5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[11px]">
        {mediaCount > 0 ? `${mediaCount} photo${mediaCount === 1 ? '' : 's'}` : 'No photo'}
      </span>
    </div>
  </div>
);

/**
 * The card every product grid is built from — Home, Catalogue and Search all
 * render this one component, so a product looks identical wherever it appears.
 *
 * **What it deliberately does not show.** A marketplace card would normally
 * carry a price, a shop name and a rating. None of the three is available
 * here: `publicProductSearchResultSchema` is product-level only ("decision L"
 * in its own doc comment), so it returns no variant, no price, no inventory
 * and no `vendorId`, and the public review summary is a per-product endpoint
 * that a grid cannot call once per card without an N+1. Inventing any of them
 * — a "from ₹—" placeholder, a shop name, a star row — would be fabricating
 * commercial information. The card therefore shows exactly what is real and
 * routes to the detail page, which does have prices, stock and reviews.
 *
 * The whole card is one link rather than a link per element: a shopper aiming
 * at a card on a phone should not have to hit the title precisely.
 */
export const ProductCard = ({ product }: ProductCardProps): JSX.Element => (
  <Link
    to={`/products/${product.id}`}
    className="group flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface transition-shadow hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
  >
    <MediaWell mediaCount={product.mediaCount} />

    <div className="flex flex-1 flex-col gap-1 p-3">
      {/* Brand above the name, the way a marketplace card reads: the shopper
          scans for who makes it, then what it is. Only rendered when the
          product actually has one. */}
      {product.brand && (
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {product.brand}
        </p>
      )}

      <h3 className="line-clamp-2 text-sm font-medium text-text group-hover:text-primary">
        {product.name}
      </h3>

      {/* Net quantity is the one commercial-adjacent fact the search contract
          does return, and it is what distinguishes "1 kg" from "500 g" in a
          grid of otherwise identical produce. */}
      {product.netQuantity && (
        <p className="mt-auto pt-1 text-xs text-text-muted">{product.netQuantity}</p>
      )}
    </div>
  </Link>
);

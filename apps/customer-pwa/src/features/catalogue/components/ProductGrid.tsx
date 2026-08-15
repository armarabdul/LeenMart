import type { PublicProductSearchResult } from '@leen-mart/contracts';
import { ProductCard } from './ProductCard';

interface ProductGridProps {
  readonly items: readonly PublicProductSearchResult[];
  /** Initial fetch — renders skeletons in place of the whole grid. */
  readonly isLoading: boolean;
  /** A subsequent fetch (e.g. "Load more") — keeps existing items visible instead of blanking the grid. */
  readonly isFetching?: boolean;
  readonly isError: boolean;
  readonly errorMessage?: string;
  readonly hasMore?: boolean;
  readonly onLoadMore?: () => void;
}

const SKELETON_COUNT = 8;

const CardSkeleton = (): JSX.Element => (
  <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
    <div className="aspect-square animate-pulse bg-slate-100" />
    <div className="flex flex-col gap-2 p-3">
      <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
    </div>
  </div>
);

/**
 * Loading/empty/error states are handled here once (Phase 6) rather than in
 * every page that lists products — `CataloguePage` and `SearchPage` both
 * render the same shape of result and should look and behave identically.
 */
export const ProductGrid = ({
  items,
  isLoading,
  isFetching = false,
  isError,
  errorMessage,
  hasMore = false,
  onLoadMore,
}: ProductGridProps): JSX.Element => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: SKELETON_COUNT }, (_, index) => (
          <CardSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
      >
        {errorMessage ?? 'Something went wrong loading products. Please try again.'}
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="rounded-md border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
        No products found.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
      {hasMore && onLoadMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isFetching}
          className="mx-auto rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
        >
          {isFetching ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
};

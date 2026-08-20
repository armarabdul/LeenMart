import type { PublicProductSearchResult } from '@leen-mart/contracts';
import { Alert, Button, EmptyState, Skeleton } from '@leen-mart/ui';
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
  /** Replaces the default "no products" copy where a page can say something more useful. */
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
  readonly emptyAction?: JSX.Element;
}

const SKELETON_COUNT = 8;

/**
 * Two columns on the narrowest phone, four on a wide desktop.
 *
 * Two rather than one at 320px is deliberate: a single-column grid of
 * square-media cards shows barely one product per screen and turns browsing
 * into scrolling. Two columns at 320px leaves ~140px per card, which is still
 * wide enough for a two-line title.
 *
 * The third column waits for `lg`, not `md`. Measured at 768px, the catalogue's
 * sticky category rail plus a third column left each card 139px — narrower than
 * the same card at 320px, which is the wrong direction for a wider screen. The
 * rail and the third column cannot both have that space at `md`, so the grid
 * yields and takes its third column once `lg` has paid for it.
 */
const GRID_CLASSES = 'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4';

const CardSkeleton = (): JSX.Element => (
  <div className="flex flex-col overflow-hidden rounded-card border border-border bg-surface">
    <Skeleton shape="rect" className="aspect-square w-full rounded-none" />
    <div className="flex flex-col gap-2 p-3">
      <Skeleton shape="text" className="w-3/4" />
      <Skeleton shape="text" className="w-1/2" />
    </div>
  </div>
);

/** The three states that are not "here are the products", resolved in one place. */
const GridState = ({
  isLoading,
  isError,
  errorMessage,
  isEmpty,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly errorMessage: string | undefined;
  readonly isEmpty: boolean;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly emptyAction: JSX.Element | undefined;
}): JSX.Element | null => {
  if (isLoading) {
    return (
      // Announced rather than silent: a screen reader otherwise hears nothing
      // at all while the grid is loading.
      <div className={GRID_CLASSES} aria-busy="true" aria-label="Loading products">
        {Array.from({ length: SKELETON_COUNT }, (_, index) => (
          <CardSkeleton key={index} />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <Alert tone="danger" title="Products couldn’t be loaded">
        {errorMessage ?? 'Something went wrong loading products. Please try again.'}
      </Alert>
    );
  }
  if (isEmpty) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }
  return null;
};

/**
 * Loading/empty/error states are handled here once rather than in every page
 * that lists products — `HomePage`, `CataloguePage` and `SearchPage` all
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
  emptyTitle = 'No products found',
  emptyDescription = 'Try a different category or search term.',
  emptyAction,
}: ProductGridProps): JSX.Element => {
  const state = (
    <GridState
      isLoading={isLoading}
      isError={isError}
      errorMessage={errorMessage}
      isEmpty={items.length === 0}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      emptyAction={emptyAction}
    />
  );
  if (isLoading || isError || items.length === 0) return state;

  return (
    <div className="flex flex-col gap-6">
      <div className={GRID_CLASSES}>
        {items.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
      {hasMore && onLoadMore && (
        <Button
          type="button"
          variant="secondary"
          onClick={onLoadMore}
          loading={isFetching}
          className="mx-auto"
        >
          Load more
        </Button>
      )}
    </div>
  );
};

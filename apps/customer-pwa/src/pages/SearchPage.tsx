import { Link, useSearchParams } from 'react-router-dom';
import { Badge, EmptyState } from '@leen-mart/ui';
import { useProductSearch } from '@/features/catalogue/hooks/useProductSearch';
import { ProductGrid } from '@/features/catalogue/components/ProductGrid';
import { SearchBar } from '@/features/catalogue/components/SearchBar';
import { PageContainer } from '@/components/PageContainer';

const SearchIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-8 w-8 text-text-faint">
    <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" />
    <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/**
 * How many products are on screen — never a total.
 *
 * The search endpoint is cursor-paginated and returns no count, so "48
 * results" would be a number the API never produced. `12+ products shown` is
 * the honest version of the same reassurance.
 */
const ResultCount = ({
  shownCount,
  hasMore,
}: {
  readonly shownCount: number;
  readonly hasMore: boolean;
}): JSX.Element | null => {
  if (shownCount === 0) return null;
  return (
    <p className="text-sm text-text-muted">
      <Badge tone="neutral">
        {shownCount}
        {hasMore ? '+' : ''}
      </Badge>{' '}
      {shownCount === 1 && !hasMore ? 'product' : 'products'} shown
    </p>
  );
};

/**
 * Search results (Phase D).
 *
 * The query is restated in the heading and the field is repeated on the page
 * rather than only living in the header: on a phone the header's field is one
 * tap away behind the fold once results scroll, and refining a search is the
 * single most likely next action on this screen.
 */
export const SearchPage = (): JSX.Element => {
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';

  const { items, isLoading, isFetchingMore, isError, hasMore, loadMore } = useProductSearch({
    q: q || undefined,
  });

  return (
    <main>
      <PageContainer>
        <div className="flex flex-col gap-6 py-6 sm:py-8">
          <div className="flex flex-col gap-4">
            <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
              {q ? (
                <>
                  Results for <span className="text-primary">“{q}”</span>
                </>
              ) : (
                'Search'
              )}
            </h1>

            {/* Repeating the field here is the point of the page, so it gets
                real width rather than the header's compressed slot. */}
            <div className="max-w-xl">
              <SearchBar />
            </div>

            <ResultCount
              shownCount={q && !isLoading && !isError ? items.length : 0}
              hasMore={hasMore}
            />
          </div>

          {q ? (
            <ProductGrid
              items={items}
              isLoading={isLoading}
              isFetching={isFetchingMore}
              isError={isError}
              hasMore={hasMore}
              onLoadMore={loadMore}
              emptyTitle={`No products match “${q}”`}
              emptyDescription="Check the spelling, try a broader term, or browse by category."
              emptyAction={
                <Link
                  to="/catalogue"
                  className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  Browse the catalogue
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={<SearchIcon />}
              title="Search the marketplace"
              description="Enter a product name or brand to find what you’re looking for."
              action={
                <Link
                  to="/catalogue"
                  className="inline-flex h-10 items-center rounded-md border border-border-strong px-4 text-sm font-medium text-text hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Browse all products
                </Link>
              }
            />
          )}
        </div>
      </PageContainer>
    </main>
  );
};
